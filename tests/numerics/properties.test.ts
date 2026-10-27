/**
 * Property-based tests (fast-check). Each property states which rounding
 * modes / value classes it applies to; not every property holds for every
 * mode (e.g. stochastic rounding is not monotone per sample).
 */
import fc from 'fast-check';
import { describe, it } from 'vitest';
import { decode, encode } from '@/engine/float/codec';
import { doubleToRational, roundParsed } from '@/engine/float/rational';
import { roundFloat } from '@/engine/float/round';
import { characteristics, FLOAT_FORMATS } from '@/engine/formats/registry';
import type { FloatFormatId } from '@/engine/formats/types';
import { computeErrorMetrics } from '@/engine/metrics/error';
import { quantizeTensor } from '@/engine/quant/quantize';
import { makeQuantConfig } from '@/engine/quant/types';
import type { RoundingMode } from '@/engine/rounding';
import { sameValue } from './helpers';

const FORMAT_IDS = Object.keys(FLOAT_FORMATS) as FloatFormatId[];
const DET_MODES: RoundingMode[] = ['nearest-even', 'nearest-away', 'toward-zero', 'toward-positive', 'toward-negative'];
const fmtArb = fc.constantFrom(...FORMAT_IDS).map((id) => FLOAT_FORMATS[id]);
const modeArb = fc.constantFrom(...DET_MODES);
const finiteDouble = fc.double({ noNaN: true, noDefaultInfinity: true });

describe('conversion properties', () => {
  it('monotone: x ≤ y ⇒ round(x) ≤ round(y) (deterministic modes, saturating overflow)', () => {
    fc.assert(
      fc.property(fmtArb, modeArb, finiteDouble, finiteDouble, (fmt, mode, x, y) => {
        const [lo, hi] = x <= y ? [x, y] : [y, x];
        const a = roundFloat(fmt, lo, { mode, overflow: 'saturate' });
        const b = roundFloat(fmt, hi, { mode, overflow: 'saturate' });
        return a <= b;
      }),
      { numRuns: 20000 },
    );
  });
  it('idempotent: round(round(x)) = round(x)', () => {
    fc.assert(
      fc.property(fmtArb, modeArb, finiteDouble, (fmt, mode, x) => {
        const a = roundFloat(fmt, x, { mode, overflow: 'saturate' });
        return sameValue(roundFloat(fmt, a, { mode, overflow: 'saturate' }), a);
      }),
      { numRuns: 20000 },
    );
  });
  it('result brackets: RD(x) ≤ x ≤ RU(x) and RZ is the one closer to zero', () => {
    fc.assert(
      fc.property(fmtArb, fc.double({ noNaN: true, noDefaultInfinity: true, min: -1e30, max: 1e30 }), (fmt, x) => {
        const c = characteristics(fmt);
        if (Math.abs(x) > c.maxFinite) return true;
        const d = roundFloat(fmt, x, { mode: 'toward-negative', overflow: 'saturate' });
        const u = roundFloat(fmt, x, { mode: 'toward-positive', overflow: 'saturate' });
        const z = roundFloat(fmt, x, { mode: 'toward-zero', overflow: 'saturate' });
        const n = roundFloat(fmt, x, { mode: 'nearest-even', overflow: 'saturate' });
        return d <= x && x <= u && (n === d || n === u) && Math.abs(z) <= Math.abs(x) && (z === d || z === u);
      }),
      { numRuns: 20000 },
    );
  });
  it('nearest modes minimise |x − round(x)| among the bracketing values', () => {
    fc.assert(
      fc.property(fmtArb, fc.double({ noNaN: true, noDefaultInfinity: true, min: -1e4, max: 1e4 }), (fmt, x) => {
        const c = characteristics(fmt);
        if (Math.abs(x) > c.maxFinite) return true;
        const d = roundFloat(fmt, x, { mode: 'toward-negative' });
        const u = roundFloat(fmt, x, { mode: 'toward-positive' });
        const n = roundFloat(fmt, x, { mode: 'nearest-even' });
        return Math.abs(n - x) <= Math.min(Math.abs(d - x), Math.abs(u - x));
      }),
      { numRuns: 20000 },
    );
  });
  it('fast path equals the BigInt rational path for arbitrary doubles', () => {
    fc.assert(
      fc.property(fmtArb, modeArb, fc.double({ noNaN: false }), fc.boolean(), (fmt, mode, x, sat) => {
        const overflow = sat ? 'saturate' : 'nonsaturate';
        return sameValue(roundFloat(fmt, x, { mode, overflow }), roundParsed(fmt, doubleToRational(x), { mode, overflow }));
      }),
      { numRuns: 20000 },
    );
  });
  it('encode/decode consistency for rounded values', () => {
    fc.assert(
      fc.property(fmtArb, finiteDouble, (fmt, x) => {
        const v = roundFloat(fmt, x, { mode: 'nearest-even', overflow: 'saturate' });
        return sameValue(decode(fmt, encode(fmt, v)).value, v);
      }),
      { numRuns: 20000 },
    );
  });
  it('sign symmetry for symmetric modes: round(−x) = −round(x)', () => {
    fc.assert(
      fc.property(fmtArb, fc.constantFrom<RoundingMode>('nearest-even', 'nearest-away', 'toward-zero'), finiteDouble, (fmt, mode, x) => {
        const a = roundFloat(fmt, -x, { mode, overflow: 'saturate' });
        const b = roundFloat(fmt, x, { mode, overflow: 'saturate' });
        return a === -b || (a === 0 && b === 0);
      }),
      { numRuns: 20000 },
    );
  });
});

describe('quantization properties', () => {
  const tensorArb = fc
    .tuple(fc.integer({ min: 1, max: 6 }), fc.integer({ min: 1, max: 24 }))
    .chain(([r, c]) =>
      fc.tuple(fc.constant([r, c] as [number, number]), fc.array(fc.double({ min: -1e4, max: 1e4, noNaN: true }), { minLength: r * c, maxLength: r * c })),
    );
  const intCfgArb = fc.record({
    format: fc.constantFrom('int8' as const, 'int4' as const),
    scheme: fc.constantFrom('symmetric' as const, 'asymmetric' as const),
    granularity: fc.constantFrom('tensor' as const, 'channel' as const, 'group' as const),
    axis: fc.constantFrom(0 as const, 1 as const),
    groupSize: fc.integer({ min: 1, max: 8 }),
    narrowRange: fc.boolean(),
    calibration: fc.constantFrom('minmax' as const, 'percentile' as const, 'mse' as const),
    rounding: fc.constantFrom<RoundingMode>(...DET_MODES, 'stochastic'),
    mseCandidates: fc.integer({ min: 1, max: 12 }),
    scaleFormat: fc.constantFrom('fp64' as const, 'fp32' as const, 'fp16' as const, 'e8m0' as const),
  });
  it('codes stay inside [qmin, qmax], reconstruction = s·(q − z), outputs finite', () => {
    fc.assert(
      fc.property(tensorArb, intCfgArb, ([shape, data], partial) => {
        const cfg = makeQuantConfig(partial);
        const r = quantizeTensor(data, shape, cfg);
        const qmax = cfg.format === 'int8' ? 127 : 7;
        const qmin = cfg.narrowRange ? -qmax : -qmax - 1;
        for (let i = 0; i < data.length; i++) {
          const q = r.q[i]!;
          const p = r.params[r.layout.blockOf[i]!]!;
          if (!Number.isInteger(q) || q < qmin || q > qmax) return false;
          if (r.recon[i] !== p.scale * (q - p.zeroPoint)) return false;
          if (!Number.isFinite(r.recon[i]!)) return false;
        }
        return true;
      }),
      { numRuns: 1500 },
    );
  });
  it('deterministic for fixed inputs and seed', () => {
    fc.assert(
      fc.property(tensorArb, intCfgArb, fc.integer({ min: 0, max: 2 ** 31 }), ([shape, data], partial, seed) => {
        const cfg = makeQuantConfig({ ...partial, seed });
        const a = quantizeTensor(data, shape, cfg);
        const b = quantizeTensor(data, shape, cfg);
        return a.q.every((v, i) => v === b.q[i]) && a.recon.every((v, i) => Object.is(v, b.recon[i]));
      }),
      { numRuns: 500 },
    );
  });
  it('error of an in-range element is at most one quantization step (directed) or half a step (nearest)', () => {
    fc.assert(
      fc.property(tensorArb, intCfgArb, ([shape, data], partial) => {
        const cfg = makeQuantConfig({ ...partial, calibration: 'minmax', scaleFormat: 'fp64' });
        const r = quantizeTensor(data, shape, cfg);
        const nearest = cfg.rounding === 'nearest-even' || cfg.rounding === 'nearest-away';
        for (let i = 0; i < data.length; i++) {
          if (r.flags[i]! & 2) continue; // saturated
          const p = r.params[r.layout.blockOf[i]!]!;
          const tol = (nearest ? 0.5 : 1) * p.scale * (1 + 1e-9) + 1e-300;
          if (Math.abs(r.recon[i]! - data[i]!) > tol) return false;
        }
        return true;
      }),
      { numRuns: 1500 },
    );
  });
  it('metrics: exact copies have zero error, infinite SNR and cosine 1 (also for tiny/huge values)', () => {
    fc.assert(
      fc.property(fc.array(fc.double({ noNaN: true, noDefaultInfinity: true }), { minLength: 1, maxLength: 50 }), (x) => {
        const m = computeErrorMetrics(x, x);
        const nonzero = x.some((v) => v !== 0);
        return m.mse === 0 && m.maxAbs === 0 && (!nonzero || m.snrDb === Infinity) && (nonzero ? Math.abs(m.cosine! - 1) < 1e-12 : m.cosine === null);
      }),
    );
  });
});
