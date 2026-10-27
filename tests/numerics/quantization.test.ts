import { describe, expect, it } from 'vitest';
import { detectOutliers } from '@/engine/calibration/outliers';
import { RoundFlag } from '@/engine/float/round';
import { computeErrorMetrics } from '@/engine/metrics/error';
import { percentile } from '@/engine/metrics/stats';
import { computeLayout } from '@/engine/quant/layout';
import { quantizeTensor, storeScale } from '@/engine/quant/quantize';
import { estimateStorage } from '@/engine/quant/storage';
import { makeQuantConfig, QuantConfigError, validateQuantConfig } from '@/engine/quant/types';
import { generate } from '@/engine/random/distributions';
import { hexToDouble, loadFixture } from './helpers';

interface IntCase {
  bits: number;
  narrow: boolean;
  scheme: 'symmetric' | 'asymmetric';
  granularity: 'tensor' | 'channel' | 'group';
  groupSize: number;
  shape: [number, number];
  x: string[];
  q: number[];
  recon: string[];
  scales: string[];
  zeroPoints: number[];
}

describe('affine integer quantization matches an independent NumPy implementation', () => {
  const fx = loadFixture<{ cases: IntCase[]; percentiles: { x: string[]; p: number[]; expected: string[] }[] }>('integer-quantization.json');
  fx.cases.forEach((c, idx) => {
    it(`case ${idx}: INT${c.bits} ${c.scheme} ${c.granularity}${c.narrow ? ' narrow' : ''}`, () => {
      const cfg = makeQuantConfig({
        format: c.bits === 8 ? 'int8' : 'int4',
        scheme: c.scheme,
        granularity: c.granularity,
        axis: 0,
        groupSize: c.groupSize,
        narrowRange: c.narrow,
        scaleFormat: 'fp32',
        calibration: 'minmax',
      });
      const r = quantizeTensor(c.x.map(hexToDouble), c.shape, cfg);
      expect(Array.from(r.q)).toEqual(c.q);
      expect(Array.from(r.recon)).toEqual(c.recon.map(hexToDouble));
      expect(r.params.map((p) => p.scale)).toEqual(c.scales.map(hexToDouble));
      expect(r.params.map((p) => p.zeroPoint)).toEqual(c.zeroPoints);
    });
  });
  it('percentiles match numpy.percentile (linear)', () => {
    for (const pc of fx.percentiles) {
      const x = pc.x.map(hexToDouble);
      pc.p.forEach((p, i) => {
        expect(percentile(x, p)).toBeCloseTo(hexToDouble(pc.expected[i]!), 12);
      });
    }
  });
});

describe('hand-computed affine quantization examples', () => {
  it('symmetric INT8 per-tensor', () => {
    // amax = 2.54 → s = 0.02; 1.0/0.02 = 50; −2.54 → −127; 0.011/0.02 = 0.55 → 1
    const r = quantizeTensor([1, -2.54, 0.011, 0], [1, 4], makeQuantConfig({ format: 'int8', scaleFormat: 'fp64' }));
    expect(r.params[0]!.scale).toBeCloseTo(0.02, 15);
    expect(Array.from(r.q)).toEqual([50, -127, 1, 0]);
  });
  it('asymmetric INT8 maps [0, 2.55] onto [−128, 127] with zero-point −128', () => {
    const r = quantizeTensor([0, 2.55, 1.275], [1, 3], makeQuantConfig({ format: 'int8', scheme: 'asymmetric', scaleFormat: 'fp64' }));
    expect(r.params[0]!.scale).toBeCloseTo(0.01, 15);
    expect(r.params[0]!.zeroPoint).toBe(-128);
    expect(Array.from(r.q)).toEqual([-128, 127, 0]); // 127.5 → ties to even → 128 → −128 + 128 = 0
    expect(r.recon[0]).toBe(0);
  });
  it('zero is exactly representable in asymmetric schemes', () => {
    const x = generate({ kind: 'uniform', params: { low: 0.3, high: 5 }, rows: 1, cols: 64, seed: 1 });
    x[10] = 0;
    const r = quantizeTensor(x, [1, 64], makeQuantConfig({ format: 'int4', scheme: 'asymmetric' }));
    expect(r.recon[10]).toBe(0);
  });
  it('INT4 symmetric narrow range never produces −8', () => {
    const x = generate({ kind: 'normal', params: {}, rows: 4, cols: 64, seed: 2 });
    const r = quantizeTensor(x, [4, 64], makeQuantConfig({ format: 'int4', narrowRange: true }));
    expect(Math.min(...r.q)).toBeGreaterThanOrEqual(-7);
  });
});

describe('degenerate inputs', () => {
  it('all-zero tensor: no division by zero, exact zeros', () => {
    for (const scheme of ['symmetric', 'asymmetric'] as const) {
      const r = quantizeTensor(new Float64Array(8), [2, 4], makeQuantConfig({ format: 'int8', scheme }));
      expect(r.params[0]!.degenerate).toBe(true);
      expect(Array.from(r.recon).every((v) => v === 0)).toBe(true);
    }
  });
  it('constant tensor reconstructs exactly with min/max', () => {
    for (const scheme of ['symmetric', 'asymmetric'] as const) {
      const r = quantizeTensor(new Float64Array(6).fill(3.7), [1, 6], makeQuantConfig({ format: 'int8', scheme, scaleFormat: 'fp64' }));
      for (const v of r.recon) expect(v).toBeCloseTo(3.7, 13);
    }
  });
  it('NaN and ±Inf inputs are flagged, not silently dropped', () => {
    const r = quantizeTensor([1, NaN, Infinity, -2], [1, 4], makeQuantConfig({ format: 'int8' }));
    expect(r.flags[1]! & RoundFlag.Invalid).toBeTruthy();
    expect(r.flags[2]! & RoundFlag.Saturated).toBeTruthy();
    expect(r.q[2]).toBe(127);
    expect(r.params[0]!.scale).toBeCloseTo(2 / 127, 7); // calibration ignores non-finite values
  });
  it('single-element tensor', () => {
    const r = quantizeTensor([-5], [1, 1], makeQuantConfig({ format: 'int4' }));
    expect(r.recon[0]).toBeCloseTo(-5, 6);
  });
});

describe('validation reports problems instead of altering the configuration', () => {
  it('rejects asymmetric FP, unscaled INT, bad manual scale and zero-point', () => {
    expect(validateQuantConfig(makeQuantConfig({ format: 'fp8_e4m3', scheme: 'asymmetric' })).some((i) => i.field === 'scheme')).toBe(true);
    expect(validateQuantConfig(makeQuantConfig({ format: 'int8', scaling: 'none' })).some((i) => i.field === 'scaling')).toBe(true);
    expect(validateQuantConfig(makeQuantConfig({ calibration: 'manual', manualScale: 0 })).some((i) => i.field === 'manualScale')).toBe(true);
    expect(validateQuantConfig(makeQuantConfig({ calibration: 'manual', scheme: 'asymmetric', manualZeroPoint: 200 })).some((i) => i.field === 'manualZeroPoint')).toBe(true);
    expect(validateQuantConfig(makeQuantConfig({ calibration: 'manual', scheme: 'asymmetric', manualZeroPoint: 1.5 })).some((i) => i.field === 'manualZeroPoint')).toBe(true);
    expect(validateQuantConfig(makeQuantConfig({ granularity: 'group', groupSize: 0 })).some((i) => i.field === 'groupSize')).toBe(true);
    expect(validateQuantConfig(makeQuantConfig({ calibration: 'percentile', percentile: 0 })).some((i) => i.field === 'percentile')).toBe(true);
    expect(() => quantizeTensor([1], [1, 1], makeQuantConfig({ calibration: 'manual', manualScale: -1 }))).toThrow(QuantConfigError);
  });
  it('warns (but accepts) uneven group sizes', () => {
    const issues = validateQuantConfig(makeQuantConfig({ granularity: 'group', groupSize: 5 }), [2, 12]);
    expect(issues.every((i) => i.severity === 'warning')).toBe(true);
    expect(issues.length).toBe(1);
  });
});

describe('granularity layouts', () => {
  it('per-channel axis 0 / axis 1 and groups', () => {
    expect(computeLayout([2, 3], 'channel', 0, 1).blockOf).toEqual(Int32Array.from([0, 0, 0, 1, 1, 1]));
    expect(computeLayout([2, 3], 'channel', 1, 1).blockOf).toEqual(Int32Array.from([0, 1, 2, 0, 1, 2]));
    const g = computeLayout([2, 5], 'group', 0, 2);
    expect(g.blockOf).toEqual(Int32Array.from([0, 0, 1, 1, 2, 3, 3, 4, 4, 5]));
    expect(Array.from(g.blockSizes)).toEqual([2, 2, 1, 2, 2, 1]);
    const g1 = computeLayout([4, 2], 'group', 1, 2);
    expect(g1.blockOf).toEqual(Int32Array.from([0, 2, 0, 2, 1, 3, 1, 3]));
  });
  it('finer granularity never increases MSE on an outlier-row matrix (min/max)', () => {
    const x = generate({ kind: 'model-weights', params: { outlierRows: 0.2, rowScale: 20 }, rows: 16, cols: 64, seed: 4 });
    const mse = (cfg: Parameters<typeof makeQuantConfig>[0]) =>
      computeErrorMetrics(x, quantizeTensor(x, [16, 64], makeQuantConfig({ format: 'int4', scaleFormat: 'fp64', ...cfg })).recon).mse;
    const t = mse({ granularity: 'tensor' });
    const ch = mse({ granularity: 'channel', axis: 0 });
    const gr = mse({ granularity: 'group', axis: 0, groupSize: 16 });
    expect(ch).toBeLessThan(t);
    expect(gr).toBeLessThanOrEqual(ch * 1.05);
  });
});

describe('calibration methods', () => {
  const x = generate({ kind: 'outliers', params: { std: 1, fraction: 0.0005, magnitude: 20 }, rows: 1, cols: 4096, seed: 8 });
  const shape: [number, number] = [1, 4096];
  it('percentile clipping beats min/max when a handful of outliers dominate the range (INT4)', () => {
    const mm = quantizeTensor(x, shape, makeQuantConfig({ format: 'int4', calibration: 'minmax' }));
    const pc = quantizeTensor(x, shape, makeQuantConfig({ format: 'int4', calibration: 'percentile', percentile: 99.9 }));
    expect(computeErrorMetrics(x, pc.recon).mse).toBeLessThan(computeErrorMetrics(x, mm.recon).mse);
    expect(pc.params[0]!.saturated).toBeGreaterThan(0);
  });
  it('MSE search returns the best candidate on its grid (and includes α = 1)', () => {
    const r = quantizeTensor(x, shape, makeQuantConfig({ format: 'int4', calibration: 'mse', mseCandidates: 50, mseMinRatio: 0.1 }));
    const p = r.params[0]!;
    expect(p.search).toHaveLength(50);
    expect(p.search![p.search!.length - 1]!.ratio).toBe(1);
    const best = Math.min(...p.search!.map((s) => s.mse));
    expect(p.search!.find((s) => s.ratio === p.chosenRatio)!.mse).toBe(best);
    // The reported MSE of the chosen candidate equals the actual MSE of the result.
    expect(computeErrorMetrics(x, r.recon).mse).toBeCloseTo(best, 12);
    const mm = quantizeTensor(x, shape, makeQuantConfig({ format: 'int4', calibration: 'minmax' }));
    expect(computeErrorMetrics(x, r.recon).mse).toBeLessThanOrEqual(computeErrorMetrics(x, mm.recon).mse);
  });
  it('manual scale and zero-point are applied verbatim', () => {
    const r = quantizeTensor([0.5, 1, 100], [1, 3], makeQuantConfig({ format: 'int8', scheme: 'asymmetric', calibration: 'manual', manualScale: 0.25, manualZeroPoint: 10 }));
    expect(Array.from(r.q)).toEqual([12, 14, 127]);
    expect(r.params[0]!.scale).toBe(0.25);
    expect(r.flags[2]! & RoundFlag.Saturated).toBeTruthy();
  });
});

describe('floating-point targets', () => {
  it('direct cast (no scale) equals element-wise conversion', () => {
    const r = quantizeTensor([0.1, 1000, -3], [1, 3], makeQuantConfig({ format: 'fp8_e4m3', scaling: 'none', overflow: 'saturate' }));
    expect(Array.from(r.recon)).toEqual([0.1015625, 448, -3]);
    expect(r.flags[1]! & RoundFlag.Saturated).toBeTruthy();
  });
  it('scaled FP8 maps amax onto the format max', () => {
    const r = quantizeTensor([10, -5, 2.5], [1, 3], makeQuantConfig({ format: 'fp8_e4m3', scaleFormat: 'fp64' }));
    expect(r.params[0]!.scale).toBe(10 / 448);
    expect(r.recon[0]).toBeCloseTo(10, 12);
  });
  it('MX §6.3 power-of-two scale: MXFP4 block of 32', () => {
    // max |V| = 13 → largest power of two ≤ 13 is 8 = 2^3; FP4 emax = 2 → X = 2^(3−2) = 2
    const v = Array.from({ length: 32 }, (_, i) => (i === 5 ? 13 : (i % 7) * 0.5));
    const r = quantizeTensor(v, [1, 32], makeQuantConfig({ format: 'fp4_e2m1', granularity: 'group', groupSize: 32, calibration: 'pow2-mx', scaleFormat: 'e8m0' }));
    expect(r.params[0]!.scale).toBe(2);
    // 13 / 2 = 6.5 exceeds FP4 max 6 → clamped to 6 → reconstructs 12
    expect(r.q[5]).toBe(6);
    expect(r.recon[5]).toBe(12);
    // MXFP8 E4M3: X = 2^(3 − 8) = 1/32
    const r8 = quantizeTensor(v, [1, 32], makeQuantConfig({ format: 'fp8_e4m3', granularity: 'group', groupSize: 32, calibration: 'pow2-mx', scaleFormat: 'e8m0' }));
    expect(r8.params[0]!.scale).toBe(1 / 32);
  });
  it('scale storage rounding: E8M0 rounds up to a power of two, FP16 can underflow', () => {
    expect(storeScale(0.3, 'e8m0').scale).toBe(0.5);
    expect(storeScale(0.25, 'e8m0').scale).toBe(0.25);
    expect(storeScale(1e-12, 'fp16')).toMatchObject({ scale: 2 ** -24, underflow: true });
    expect(storeScale(1e9, 'fp16')).toMatchObject({ scale: 65504, overflow: true });
    expect(storeScale(0.1, 'bf16').scale).toBe(0.10009765625);
  });
});

describe('stochastic rounding in quantization is reproducible', () => {
  it('same seed → identical codes; different seed → different codes', () => {
    const x = generate({ kind: 'normal', params: {}, rows: 8, cols: 64, seed: 3 });
    const cfg = makeQuantConfig({ format: 'int4', rounding: 'stochastic', seed: 77 });
    const a = quantizeTensor(x, [8, 64], cfg);
    const b = quantizeTensor(x, [8, 64], cfg);
    const c = quantizeTensor(x, [8, 64], { ...cfg, seed: 78 });
    expect(Array.from(a.q)).toEqual(Array.from(b.q));
    expect(Array.from(a.q)).not.toEqual(Array.from(c.q));
  });
});

describe('storage accounting', () => {
  it('INT4 group-32 asymmetric with FP16 scales', () => {
    const s = estimateStorage(makeQuantConfig({ format: 'int4', scheme: 'asymmetric', granularity: 'group', groupSize: 32, scaleFormat: 'fp16' }), 4096, 128);
    expect(s.totalBits).toBe(4096 * 4 + 128 * 16 + 128 * 4);
    expect(s.bitsPerElement).toBe(4 + 0.5 + 0.125);
    expect(s.totalBytes).toBe(Math.ceil(s.totalBits / 8));
  });
  it('MXFP4 is 4.25 bits per element', () => {
    const s = estimateStorage(makeQuantConfig({ format: 'fp4_e2m1', granularity: 'group', groupSize: 32, calibration: 'pow2-mx', scaleFormat: 'e8m0' }), 1024, 32);
    expect(s.bitsPerElement).toBe(4.25);
  });
  it('unscaled cast has no metadata', () => {
    const s = estimateStorage(makeQuantConfig({ format: 'bf16', scaling: 'none' }), 100, 1);
    expect(s.totalBits).toBe(1600);
    expect(s.compressionVsFp32).toBe(2);
  });
});

describe('outlier detection', () => {
  it('finds planted outliers with each method', () => {
    const x = Array.from(generate({ kind: 'normal', params: {}, rows: 1, cols: 1000, seed: 5 }));
    x[3] = 40;
    x[500] = -55;
    for (const m of ['zscore', 'iqr', 'mad', 'ratio'] as const) {
      const r = detectOutliers(x, m, m === 'iqr' ? 3 : m === 'ratio' ? 20 : 6);
      expect(r.mask[3]).toBe(1);
      expect(r.mask[500]).toBe(1);
      expect(r.count).toBeLessThan(20);
    }
  });
});
