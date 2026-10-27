import { describe, expect, it } from 'vitest';
import { forward, prepareNetwork, validateNetwork, validateNetworkQuant, type NetworkDef, type NetworkQuant } from '@/engine/nn/network';
import { makeQuantConfig } from '@/engine/quant/types';
import trained from '@/data/networks/trained.json';
import { hexToDouble, loadFixture } from './helpers';

interface Preset { id: string; network: NetworkDef; samples: number[][]; labels: number[] }
const presets = Object.fromEntries((trained.presets as unknown as Preset[]).map((p) => [p.id, p]));
const fx = loadFixture<{ cases: { preset: string; sample: number; fp64: string[]; w8pc_a8: string[]; w4pt: string[] }[] }>('nn-forward.json');

const allLayers = (net: NetworkDef, f: (i: number) => NetworkQuant['layers'][number]): NetworkQuant => ({
  layers: net.layers.map((_, i) => f(i)),
  activationCalibration: 'dynamic',
});

function closeTo(a: ArrayLike<number>, b: number[], rel: number) {
  for (let i = 0; i < b.length; i++) {
    const tol = rel * Math.max(1, Math.abs(b[i]!));
    if (Math.abs(a[i]! - b[i]!) > tol) throw new Error(`index ${i}: ${a[i]} vs ${b[i]}`);
  }
}

describe('forward passes match an independent NumPy implementation', () => {
  for (const c of fx.cases) {
    it(`${c.preset} sample ${c.sample}`, () => {
      const p = presets[c.preset]!;
      const x = p.samples[c.sample]!;
      // FP64 baseline (tolerance covers BLAS summation order and tanh last-ulp differences)
      const base = forward(prepareNetwork(p.network, null), x);
      closeTo(base.layers.at(-1)!.preact, c.fp64.map(hexToDouble), 1e-12);
      // INT8 per-channel weights + INT8 dynamic per-tensor activations
      const q8 = allLayers(p.network, () => ({
        weight: makeQuantConfig({ format: 'int8', granularity: 'channel', axis: 0 }),
        activation: makeQuantConfig({ format: 'int8' }),
        arith: null,
      }));
      closeTo(forward(prepareNetwork(p.network, q8), x).layers.at(-1)!.preact, c.w8pc_a8.map(hexToDouble), 1e-9);
      // INT4 per-tensor weights only
      const q4 = allLayers(p.network, () => ({ weight: makeQuantConfig({ format: 'int4' }), activation: null, arith: null }));
      closeTo(forward(prepareNetwork(p.network, q4), x).layers.at(-1)!.preact, c.w4pt.map(hexToDouble), 1e-12);
    });
  }
});

describe('network semantics', () => {
  const moons = presets.moons!;
  it('trained presets reach their recorded accuracy in FP64', () => {
    const prep = prepareNetwork(moons.network, null);
    const acc = moons.samples.filter((x, i) => forward(prep, x).prediction === moons.labels[i]).length / moons.samples.length;
    expect(acc).toBeCloseTo((trained.presets[0] as { training: { evalAccuracy: number } }).training.evalAccuracy, 10);
  });
  it('weight and activation quantization are applied where configured', () => {
    const q: NetworkQuant = {
      layers: moons.network.layers.map((_, i) => ({ weight: i === 1 ? makeQuantConfig({ format: 'int4' }) : null, activation: i === 2 ? makeQuantConfig({ format: 'int4' }) : null, arith: null })),
      activationCalibration: 'dynamic',
    };
    const prep = prepareNetwork(moons.network, q);
    expect(prep.weightResults.map((r) => r !== null)).toEqual([false, true, false]);
    const t = forward(prep, moons.samples[0]!);
    expect(Array.from(t.layers[0]!.inputUsed)).toEqual(moons.samples[0]);
    expect(t.layers[2]!.activationParams).not.toBeNull();
    expect(Array.from(t.layers[2]!.inputUsed)).not.toEqual(Array.from(t.layers[2]!.input));
    expect(Array.from(prep.weights[0]!)).toEqual(moons.network.layers[0]!.weights);
  });
  it('static calibration fixes activation scales across inputs', () => {
    const q: NetworkQuant = { layers: moons.network.layers.map(() => ({ weight: null, activation: makeQuantConfig({ format: 'int8' }), arith: null })), activationCalibration: 'static' };
    const prep = prepareNetwork(moons.network, q, moons.samples.slice(0, 50));
    const a = forward(prep, moons.samples[0]!);
    const b = forward(prep, moons.samples[1]!);
    expect(a.layers[1]!.activationParams![0]!.scale).toBe(b.layers[1]!.activationParams![0]!.scale);
    expect(() => prepareNetwork(moons.network, q, [])).toThrow();
  });
  it('reduced-precision arithmetic changes the logits', () => {
    const q: NetworkQuant = { layers: moons.network.layers.map(() => ({ weight: null, activation: null, arith: { productFormat: 'bf16', accumulatorFormat: 'bf16', outputFormat: 'bf16', rounding: 'nearest-even', order: 'sequential', blockSize: 32, outerFormat: 'fp32', overflow: 'nonsaturate', ftz: false, seed: 1 } })), activationCalibration: 'dynamic' };
    const base = forward(prepareNetwork(moons.network, null), moons.samples[3]!);
    const low = forward(prepareNetwork(moons.network, q), moons.samples[3]!);
    expect(Array.from(low.output)).not.toEqual(Array.from(base.output));
  });
  it('invalid networks and quant settings are reported', () => {
    const bad: NetworkDef = { ...moons.network, layers: [{ ...moons.network.layers[0]!, weights: [1, 2, 3] }] };
    expect(validateNetwork(bad).length).toBeGreaterThan(0);
    expect(() => prepareNetwork(bad, null)).toThrow();
    const q: NetworkQuant = { layers: [{ weight: null, activation: makeQuantConfig({ format: 'int8', granularity: 'channel', axis: 0 }), arith: null }], activationCalibration: 'dynamic' };
    expect(validateNetworkQuant(moons.network, q).length).toBeGreaterThan(0);
    expect(() => forward(prepareNetwork(moons.network, null), [1])).toThrow();
  });
});
