import { describe, expect, it } from 'vitest';
import { exp, expm1, geluTanh, log, sigmoid, softmax, tanh } from '@/engine/detmath';
import { doubleToBits, nextUp } from '@/engine/float/double';
import { DISTRIBUTIONS, defaultParams, generate } from '@/engine/random/distributions';
import { Rng } from '@/engine/random/prng';
import { loadFixture } from './helpers';

function ulpDiff(a: number, b: number): number {
  if (Object.is(a, b)) return 0;
  const da = doubleToBits(a);
  const db = doubleToBits(b);
  const d = da > db ? da - db : db - da;
  return Number(d);
}

describe('xoshiro128** matches the reference C implementation', () => {
  const fx = loadFixture<{ streams: Record<string, number[]> }>('prng.json');
  for (const [seed, expected] of Object.entries(fx.streams)) {
    it(`seed ${seed}`, () => {
      const r = new Rng(Number(seed));
      expect(expected.map(() => r.nextUint32())).toEqual(expected);
    });
  }
  it('next() is in [0, 1) and nextInt is in range', () => {
    const r = new Rng(3);
    for (let i = 0; i < 10000; i++) {
      const u = r.next();
      expect(u >= 0 && u < 1).toBe(true);
      const k = r.nextInt(7);
      expect(Number.isInteger(k) && k >= 0 && k < 7).toBe(true);
    }
  });
});

describe('deterministic exp/log (fdlibm ports)', () => {
  it('agree with Math.exp / Math.log to within 1 ulp over a wide range', () => {
    const r = new Rng(11);
    let worstExp = 0;
    let worstLog = 0;
    for (let i = 0; i < 20000; i++) {
      const x = (r.next() * 2 - 1) * 700;
      worstExp = Math.max(worstExp, ulpDiff(exp(x), Math.exp(x)));
      const y = Math.exp((r.next() * 2 - 1) * 700);
      worstLog = Math.max(worstLog, ulpDiff(log(y), Math.log(y)));
    }
    expect(worstExp).toBeLessThanOrEqual(1);
    expect(worstLog).toBeLessThanOrEqual(1);
  });
  it('special values', () => {
    expect(exp(0)).toBe(1);
    expect(exp(-Infinity)).toBe(0);
    expect(exp(Infinity)).toBe(Infinity);
    expect(exp(710)).toBe(Infinity);
    expect(exp(-746)).toBe(0);
    expect(exp(NaN)).toBeNaN();
    expect(log(1)).toBe(0);
    expect(log(0)).toBe(-Infinity);
    expect(log(-1)).toBeNaN();
    expect(log(Infinity)).toBe(Infinity);
    expect(ulpDiff(log(Number.MIN_VALUE), Math.log(Number.MIN_VALUE))).toBeLessThanOrEqual(1);
    expect(ulpDiff(exp(-740), Math.exp(-740))).toBeLessThanOrEqual(1);
    expect(ulpDiff(log(nextUp(1)), Math.log(nextUp(1)))).toBeLessThanOrEqual(1);
  });
  it('tanh/expm1/sigmoid/gelu/softmax are accurate', () => {
    for (let x = -30; x <= 30; x += 0.0137) {
      expect(Math.abs(tanh(x) - Math.tanh(x))).toBeLessThanOrEqual(4 * Number.EPSILON * Math.max(1e-300, Math.abs(Math.tanh(x))) + 1e-300);
      expect(Math.abs(expm1(x / 50) - Math.expm1(x / 50))).toBeLessThanOrEqual(4 * Number.EPSILON * Math.abs(Math.expm1(x / 50)) + 1e-300);
      expect(Math.abs(sigmoid(x) - 1 / (1 + Math.exp(-x)))).toBeLessThan(1e-15);
    }
    expect(Object.is(tanh(-0), -0)).toBe(true);
    expect(tanh(1e-10)).toBe(1e-10);
    expect(geluTanh(0)).toBe(0);
    expect(Math.abs(geluTanh(1) - 0.8411919906082768)).toBeLessThan(1e-15);
    const s = softmax([1, 2, 3]);
    expect(s.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 15);
    expect(s[2]).toBeCloseTo(0.6652409557748219, 15);
  });
});

describe('seeded generators', () => {
  for (const d of DISTRIBUTIONS) {
    it(`${d.kind}: deterministic, finite, seed-sensitive`, () => {
      const spec = { kind: d.kind, params: defaultParams(d.kind), rows: 16, cols: 32, seed: 1234 };
      const a = generate(spec);
      const b = generate(spec);
      expect(Array.from(a)).toEqual(Array.from(b));
      expect(a.every(Number.isFinite)).toBe(true);
      const c = generate({ ...spec, seed: 1235 });
      expect(Array.from(c)).not.toEqual(Array.from(a));
    });
  }
  it('normal samples have approximately the requested moments', () => {
    const x = generate({ kind: 'normal', params: { mean: 2, std: 3 }, rows: 1, cols: 100000, seed: 9 });
    const mean = x.reduce((s, v) => s + v, 0) / x.length;
    const sd = Math.sqrt(x.reduce((s, v) => s + (v - mean) ** 2, 0) / x.length);
    expect(Math.abs(mean - 2)).toBeLessThan(0.05);
    expect(Math.abs(sd - 3)).toBeLessThan(0.05);
  });
  it('golden values pin the generator output across releases', () => {
    const x = generate({ kind: 'normal', params: { mean: 0, std: 1 }, rows: 1, cols: 4, seed: 42 });
    // If this changes, saved experiments would no longer replay identically.
    expect(Array.from(x).map((v) => v.toPrecision(17))).toMatchSnapshot();
  });
  it('rejects invalid shapes', () => {
    expect(() => generate({ kind: 'normal', params: {}, rows: 0, cols: 3, seed: 1 })).toThrow();
    expect(() => generate({ kind: 'normal', params: {}, rows: 2048, cols: 2048, seed: 1 })).toThrow();
  });
});
