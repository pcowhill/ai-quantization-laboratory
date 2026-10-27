/**
 * Conversion (rounding) tests.
 *
 * References:
 * 1. ml_dtypes / NumPy round-to-nearest-even conversions (rne-conversions.json).
 * 2. C/hardware conversions to binary32 and binary16 under all four IEEE
 *    rounding directions (directed-rounding.json).
 * 3. A brute-force reference implemented here by searching the enumerated
 *    list of representable values (a different algorithm from the engine's
 *    quantum-based rounding).
 * 4. The engine's independent BigInt rational path.
 * 5. OCP OFP8 Table 3 overflow cases, transcribed by hand.
 */
import { describe, expect, it } from 'vitest';
import { enumerateFinite } from '@/engine/float/codec';
import { pow2 } from '@/engine/float/double';
import { doubleToRational, parseExact, roundParsed, roundString } from '@/engine/float/rational';
import { lastRound, roundFloat, RoundFlag } from '@/engine/float/round';
import { characteristics, FLOAT_FORMATS } from '@/engine/formats/registry';
import type { FloatFormat, FloatFormatId, OverflowMode } from '@/engine/formats/types';
import { Rng } from '@/engine/random/prng';
import type { RoundingMode } from '@/engine/rounding';
import { f16BitsToDouble, f32BitsToDouble, hexToDouble, loadFixture, sameValue, show } from './helpers';

const DET_MODES: RoundingMode[] = ['nearest-even', 'nearest-away', 'toward-zero', 'toward-positive', 'toward-negative'];

describe('RNE conversions match ml_dtypes / NumPy', () => {
  const fx = loadFixture<{ cases: Record<string, [string, string][]> }>('rne-conversions.json');
  for (const [id, cases] of Object.entries(fx.cases)) {
    it(`${id}: ${cases.length} cases`, () => {
      const fmt = FLOAT_FORMATS[id as FloatFormatId];
      // ml_dtypes models non-saturating conversion for FP8; FP4 always saturates.
      const overflow: OverflowMode = id === 'fp4_e2m1' ? 'saturate' : 'nonsaturate';
      for (const [xh, yh] of cases) {
        const x = hexToDouble(xh);
        const expected = hexToDouble(yh);
        const got = roundFloat(fmt, x, { mode: 'nearest-even', overflow });
        if (!sameValue(got, expected) && !(fmt.special === 'fnuz' && got === 0 && expected === 0)) {
          throw new Error(`${id}(${show(x)}) = ${show(got)}, expected ${show(expected)}`);
        }
      }
    });
  }
});

describe('directed rounding matches C fesetround (binary32, binary16)', () => {
  const fx = loadFixture<{ modes: RoundingMode[]; conversions: [string, string[], string[]][] }>('directed-rounding.json');
  it(`${fx.conversions.length} inputs × 4 modes × 2 formats`, () => {
    for (const [xh, f32s, f16s] of fx.conversions) {
      const x = hexToDouble(xh);
      fx.modes.forEach((mode, m) => {
        const g32 = roundFloat(FLOAT_FORMATS.fp32, x, { mode, overflow: 'nonsaturate' });
        const e32 = f32BitsToDouble(f32s[m]!);
        if (!sameValue(g32, e32)) throw new Error(`fp32 ${mode}(${show(x)}) = ${show(g32)}, expected ${show(e32)}`);
        const g16 = roundFloat(FLOAT_FORMATS.fp16, x, { mode, overflow: 'nonsaturate' });
        const e16 = f16BitsToDouble(f16s[m]!);
        if (!sameValue(g16, e16)) throw new Error(`fp16 ${mode}(${show(x)}) = ${show(g16)}, expected ${show(e16)}`);
      });
    }
  });
});

/** Brute-force reference: choose among enumerated neighbours by exact comparisons. */
function bruteForce(fmt: FloatFormat, values: Float64Array, x: number, mode: RoundingMode): number {
  const c = characteristics(fmt);
  const neg = x < 0 || Object.is(x, -0);
  const a = Math.abs(x);
  const zero = neg && c.hasNegativeZero ? -0 : 0;
  // largest value <= a and smallest >= a among non-negative values
  let lo = 0;
  let hi = Infinity;
  for (const v of values) {
    if (v < 0) continue;
    if (v <= a && v >= lo) lo = v;
    if (v >= a && v < hi) hi = v;
  }
  let mag: number;
  if (lo === a) mag = a;
  else {
    // Above max: the next "virtual" value with unbounded exponent is max + ulp(max)
    if (hi === Infinity) hi = c.maxFinite + pow2(c.emax - fmt.fractionBits);
    const dLo = a - lo;
    const dHi = hi - a;
    const loEven = lo === 0 || Math.round(lo / pow2(Math.max(Math.floor(Math.log2(lo)), c.emin) - fmt.fractionBits)) % 2 === 0;
    switch (mode) {
      case 'nearest-even':
        mag = dLo < dHi ? lo : dHi < dLo ? hi : loEven ? lo : hi;
        break;
      case 'nearest-away':
        mag = dLo < dHi ? lo : hi;
        break;
      case 'toward-zero':
        mag = lo;
        break;
      case 'toward-positive':
        mag = neg ? lo : hi;
        break;
      default:
        mag = neg ? hi : lo;
    }
  }
  if (mag > c.maxFinite) return NaN; // marker: overflow (checked separately)
  return mag === 0 ? zero : neg ? -mag : mag;
}

describe('brute-force neighbour search agrees with the engine (all deterministic modes)', () => {
  const ids: FloatFormatId[] = ['fp8_e4m3', 'fp8_e5m2', 'fp4_e2m1', 'fp8_e4m3fnuz', 'fp8_e5m2fnuz'];
  for (const id of ids) {
    it(`${id}: values, midpoints and near-midpoints`, () => {
      const fmt = FLOAT_FORMATS[id];
      const vals = enumerateFinite(fmt);
      const pos = Array.from(vals).filter((v) => v >= 0);
      const probes: number[] = [];
      for (let i = 0; i + 1 < pos.length; i++) {
        const lo = pos[i]!;
        const hi = pos[i + 1]!;
        const mid = (lo + hi) / 2;
        const tiny = (hi - lo) * 2 ** -20;
        probes.push(lo, mid, mid + tiny, mid - tiny, lo + tiny, hi - tiny, lo + (hi - lo) / 4, lo + (3 * (hi - lo)) / 4);
      }
      for (const p of [...probes]) probes.push(-p);
      for (const x of probes) {
        for (const mode of DET_MODES) {
          const expected = bruteForce(fmt, vals, x, mode);
          const got = roundFloat(fmt, x, { mode, overflow: 'saturate' });
          if (Number.isNaN(expected)) continue; // overflow cases handled below
          if (!sameValue(got, expected)) throw new Error(`${id} ${mode}(${show(x)}) = ${show(got)}, expected ${show(expected)}`);
        }
      }
    });
  }
});

describe('fast double path agrees with the BigInt rational path', () => {
  const ids = Object.keys(FLOAT_FORMATS) as FloatFormatId[];
  const rng = new Rng(7);
  const xs: number[] = [];
  for (let i = 0; i < 4000; i++) {
    const e = Math.floor(rng.next() * 140) - 70;
    const m = 1 + rng.next();
    xs.push((rng.next() < 0.5 ? -1 : 1) * m * 2 ** e);
  }
  xs.push(0, -0, Number.MIN_VALUE, -Number.MIN_VALUE, Number.MAX_VALUE, 1e-310, 65504, 65520, 448, 464, 480, 6, 7, 5);
  for (const id of ids) {
    it(`${id}`, () => {
      const fmt = FLOAT_FORMATS[id];
      for (const x of xs) {
        for (const mode of DET_MODES) {
          for (const overflow of ['saturate', 'nonsaturate'] as OverflowMode[]) {
            const fast = roundFloat(fmt, x, { mode, overflow });
            const ff = lastRound.flags;
            const slow = roundParsed(fmt, doubleToRational(x), { mode, overflow });
            if (!sameValue(fast, slow) || ff !== lastRound.flags) {
              throw new Error(`${id} ${mode} ${overflow} (${show(x)}): fast ${show(fast)} flags ${ff}, rational ${show(slow)} flags ${lastRound.flags}`);
            }
          }
        }
      }
    });
  }
});

describe('the lo (error-term) argument rounds x + lo exactly', () => {
  it('directed rounding of 1 − tiny goes below 1 (power-of-two boundary)', () => {
    const f = FLOAT_FORMATS.fp32;
    expect(roundFloat(f, 1, { mode: 'toward-negative' }, -1e-30)).toBe(1 - 2 ** -24);
    expect(roundFloat(f, 1, { mode: 'toward-zero' }, -1e-30)).toBe(1 - 2 ** -24);
    expect(roundFloat(f, 1, { mode: 'toward-positive' }, -1e-30)).toBe(1);
    expect(roundFloat(f, 1, { mode: 'nearest-even' }, -1e-30)).toBe(1);
    expect(roundFloat(f, 1, { mode: 'toward-positive' }, 1e-30)).toBe(1 + 2 ** -23);
  });
  it('a tie broken by the tail', () => {
    const f = FLOAT_FORMATS.fp8_e4m3;
    // 1.0625 is exactly halfway between 1 and 1.125 in E4M3
    expect(roundFloat(f, 1.0625, { mode: 'nearest-even' })).toBe(1);
    expect(roundFloat(f, 1.0625, { mode: 'nearest-even' }, 1e-20)).toBe(1.125);
    expect(roundFloat(f, 1.0625, { mode: 'nearest-even' }, -1e-20)).toBe(1);
  });
  it('FP64 directed rounding with a tail', () => {
    const f = FLOAT_FORMATS.fp64;
    expect(roundFloat(f, 1, { mode: 'toward-positive' }, 1e-30)).toBe(1 + 2 ** -52);
    expect(roundFloat(f, 1, { mode: 'toward-negative' }, -1e-30)).toBe(1 - 2 ** -53);
  });
});

describe('OCP OFP8 Table 3 overflow and special-value conversions', () => {
  const e4 = FLOAT_FORMATS.fp8_e4m3;
  const e5 = FLOAT_FORMATS.fp8_e5m2;
  const rne = (fmt: FloatFormat, x: number, overflow: OverflowMode) => roundFloat(fmt, x, { mode: 'nearest-even', overflow });
  it('NaN → NaN in both modes', () => {
    for (const m of ['saturate', 'nonsaturate'] as const) {
      expect(rne(e4, NaN, m)).toBeNaN();
      expect(rne(e5, NaN, m)).toBeNaN();
    }
  });
  it('±Inf → ±max (SAT); E5M2 ±Inf, E4M3 NaN (NONSAT)', () => {
    expect(rne(e5, Infinity, 'saturate')).toBe(57344);
    expect(rne(e5, -Infinity, 'saturate')).toBe(-57344);
    expect(rne(e5, -Infinity, 'nonsaturate')).toBe(-Infinity);
    expect(rne(e4, Infinity, 'saturate')).toBe(448);
    expect(rne(e4, -Infinity, 'nonsaturate')).toBeNaN();
  });
  it('greater than max after rounding', () => {
    // E4M3: 464 is the tie between 448 and 480; ties-to-even gives 448 (no overflow)
    expect(rne(e4, 464, 'nonsaturate')).toBe(448);
    expect(rne(e4, 464.0001, 'nonsaturate')).toBeNaN();
    expect(rne(e4, 1e6, 'saturate')).toBe(448);
    expect(rne(e4, -1e6, 'saturate')).toBe(-448);
    // E5M2: top-binade spacing is 2^13, so the next (virtual) value is 65536 and the
    // tie is 61440. 57344 = 1.11b·2^15 has an odd significand, so the tie rounds up → Inf.
    expect(rne(e5, 61439, 'nonsaturate')).toBe(57344);
    expect(rne(e5, 61440, 'nonsaturate')).toBe(Infinity);
    expect(rne(e5, 61440, 'saturate')).toBe(57344);
    expect(rne(e5, -1e9, 'saturate')).toBe(-57344);
  });
  it('smaller than min subnormal → ±0 (sign preserved)', () => {
    expect(Object.is(rne(e4, -(2 ** -11), 'saturate'), -0)).toBe(true);
    expect(rne(e4, 2 ** -10, 'saturate')).toBe(0); // exact tie with 0 and 2^-9 → even (0)
    expect(rne(e4, 2 ** -10 * 1.01, 'saturate')).toBe(2 ** -9);
    expect(Object.is(rne(e5, -0, 'nonsaturate'), -0)).toBe(true);
  });
  it('flags overflow and saturation', () => {
    rne(e4, 1000, 'saturate');
    expect(lastRound.flags & RoundFlag.Saturated).toBeTruthy();
    expect(lastRound.flags & RoundFlag.Overflow).toBeTruthy();
  });
});

describe('IEEE 754 §7.4 overflow depends on rounding direction', () => {
  const f = FLOAT_FORMATS.fp16;
  it.each([
    ['nearest-even', 1e6, Infinity],
    ['toward-zero', 1e6, 65504],
    ['toward-positive', 1e6, Infinity],
    ['toward-negative', 1e6, 65504],
    ['toward-positive', -1e6, -65504],
    ['toward-negative', -1e6, -Infinity],
  ] as [RoundingMode, number, number][])('%s(%d) → %d', (mode, x, expected) => {
    expect(roundFloat(f, x, { mode, overflow: 'nonsaturate' })).toBe(expected);
  });
  it('65519.99 → 65504 but 65520 → Inf (RNE)', () => {
    expect(roundFloat(f, 65519.99, { mode: 'nearest-even' })).toBe(65504);
    expect(roundFloat(f, 65520, { mode: 'nearest-even' })).toBe(Infinity);
  });
});

describe('FP4 E2M1 conversion (MX §5.3.3)', () => {
  const f = FLOAT_FORMATS.fp4_e2m1;
  it('saturates on overflow, including ±Inf', () => {
    expect(roundFloat(f, 7, { mode: 'nearest-even' })).toBe(6);
    expect(roundFloat(f, 1e9, { mode: 'nearest-even', overflow: 'nonsaturate' })).toBe(6);
    expect(roundFloat(f, -Infinity, { mode: 'nearest-even' })).toBe(-6);
  });
  it('NaN maps to +0 with the Invalid flag (implementation-defined)', () => {
    expect(roundFloat(f, NaN, { mode: 'nearest-even' })).toBe(0);
    expect(lastRound.flags & RoundFlag.Invalid).toBeTruthy();
  });
  it('rounds 0.25 to 0 and 0.75 to 1 (ties to even)', () => {
    expect(roundFloat(f, 0.25, { mode: 'nearest-even' })).toBe(0);
    expect(roundFloat(f, 0.75, { mode: 'nearest-even' })).toBe(1);
    expect(roundFloat(f, 5, { mode: 'nearest-even' })).toBe(4);
    expect(roundFloat(f, 2.5, { mode: 'nearest-even' })).toBe(2);
  });
});

describe('subnormals, signed zero and flush-to-zero', () => {
  const f = FLOAT_FORMATS.fp16;
  it('produces subnormals and flags them', () => {
    expect(roundFloat(f, 2 ** -20, { mode: 'nearest-even' })).toBe(2 ** -20);
    expect(lastRound.flags & RoundFlag.Subnormal).toBeTruthy();
  });
  it('FTZ flushes subnormal results to signed zero', () => {
    expect(roundFloat(f, 2 ** -20, { mode: 'nearest-even', ftz: true })).toBe(0);
    expect(Object.is(roundFloat(f, -(2 ** -20), { mode: 'nearest-even', ftz: true }), -0)).toBe(true);
    expect(lastRound.flags & RoundFlag.Flushed).toBeTruthy();
    // the smallest normal is not flushed
    expect(roundFloat(f, 2 ** -14, { mode: 'nearest-even', ftz: true })).toBe(2 ** -14);
  });
  it('underflow to zero keeps the sign', () => {
    expect(Object.is(roundFloat(f, -1e-30, { mode: 'nearest-even' }), -0)).toBe(true);
    expect(lastRound.flags & RoundFlag.ZeroFromNonzero).toBeTruthy();
    expect(roundFloat(f, -1e-30, { mode: 'toward-negative' })).toBe(-(2 ** -24));
  });
  it('exactly representable values are returned unchanged with no flags in every mode', () => {
    for (const mode of DET_MODES) {
      for (const v of [1, -1, 0.5, 65504, 2 ** -24, -(2 ** -14), 1.5]) {
        expect(roundFloat(f, v, { mode })).toBe(v);
        expect(lastRound.flags & RoundFlag.Inexact).toBe(0);
      }
    }
  });
});

describe('decimal strings are rounded directly (no double rounding)', () => {
  it('"0.1" in FP16 is 0x2E66 = 0.0999755859375', () => {
    expect(roundString(FLOAT_FORMATS.fp16, '0.1', { mode: 'nearest-even' })).toBe(0.0999755859375);
  });
  it('a decimal just above an E4M3 tie rounds up even though FP64→FP32→E4M3 would not', () => {
    const s = '1.06250000000000000001';
    expect(roundString(FLOAT_FORMATS.fp8_e4m3, s, { mode: 'nearest-even' })).toBe(1.125);
    // Through FP64 first the value collapses to the tie 1.0625 and rounds to 1:
    expect(roundFloat(FLOAT_FORMATS.fp8_e4m3, parseFloat(s), { mode: 'nearest-even' })).toBe(1);
  });
  it('FP64 rounding of decimal strings agrees with the JavaScript parser', () => {
    const rng = new Rng(99);
    for (let i = 0; i < 3000; i++) {
      const digits = 1 + Math.floor(rng.next() * 20);
      let s = '';
      for (let k = 0; k < digits; k++) s += Math.floor(rng.next() * 10);
      s = `${rng.next() < 0.5 ? '-' : ''}${s.slice(0, 1)}.${s.slice(1)}e${Math.floor(rng.next() * 640) - 330}`;
      expect(sameValue(roundString(FLOAT_FORMATS.fp64, s, { mode: 'nearest-even', overflow: 'nonsaturate' }), parseFloat(s))).toBe(true);
    }
  });
  it('fractions, hex floats and specials parse exactly', () => {
    expect(parseExact('1/3')).toEqual({ kind: 'finite', negative: false, num: 1n, den: 3n });
    expect(roundString(FLOAT_FORMATS.fp64, '1/3', { mode: 'nearest-even' })).toBe(1 / 3);
    expect(roundString(FLOAT_FORMATS.fp64, '0x1.8p1', { mode: 'nearest-even' })).toBe(3);
    expect(roundString(FLOAT_FORMATS.fp64, '-inf', { mode: 'nearest-even' })).toBe(-Infinity);
    expect(roundString(FLOAT_FORMATS.fp64, 'NaN', { mode: 'nearest-even' })).toBeNaN();
    expect(Object.is(roundString(FLOAT_FORMATS.fp32, '-0', { mode: 'nearest-even' }), -0)).toBe(true);
    expect(roundString(FLOAT_FORMATS.fp64, '1e400', { mode: 'nearest-even', overflow: 'nonsaturate' })).toBe(Infinity);
    expect(roundString(FLOAT_FORMATS.fp64, '1e-400', { mode: 'toward-positive' })).toBe(Number.MIN_VALUE);
    expect(() => parseExact('1/0')).toThrow();
    expect(() => parseExact('abc')).toThrow();
    expect(() => parseExact('')).toThrow();
  });
});

describe('stochastic rounding', () => {
  it('is deterministic for a fixed seed', () => {
    const run = (seed: number) => {
      const rng = new Rng(seed);
      return Array.from({ length: 50 }, (_, i) => roundFloat(FLOAT_FORMATS.fp8_e4m3, 1 + i / 97, { mode: 'stochastic', rng: () => rng.next() }));
    };
    expect(run(5)).toEqual(run(5));
    expect(run(5)).not.toEqual(run(6));
  });
  it('only ever returns one of the two neighbours and is unbiased on average', () => {
    const rng = new Rng(1);
    const x = 1.03; // between 1 and 1.125 in E4M3, fraction 0.24
    let sum = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) {
      const v = roundFloat(FLOAT_FORMATS.fp8_e4m3, x, { mode: 'stochastic', rng: () => rng.next() });
      expect(v === 1 || v === 1.125).toBe(true);
      sum += v;
    }
    expect(Math.abs(sum / N - x)).toBeLessThan(0.003);
  });
  it('never perturbs exactly representable values', () => {
    const rng = new Rng(2);
    for (let i = 0; i < 100; i++) expect(roundFloat(FLOAT_FORMATS.fp16, 0.5, { mode: 'stochastic', rng: () => rng.next() })).toBe(0.5);
  });
});
