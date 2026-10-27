import { describe, expect, it } from 'vitest';
import { ArithMachine, FP64_ARITH, makeArithConfig, simulatedDot } from '@/engine/arith/dot';
import { exactDot, exactSum, ExactSum } from '@/engine/arith/exact';
import { integerMatmul, integerPathSupport, matmul, matmulEntryTrace, matrix, scalarMultiply, vectorAdd } from '@/engine/arith/matrix';
import { quantizeTensor } from '@/engine/quant/quantize';
import { makeQuantConfig } from '@/engine/quant/types';
import { generate } from '@/engine/random/distributions';
import type { RoundingMode } from '@/engine/rounding';
import { f32BitsToDouble, hexToDouble, loadFixture, sameValue, show } from './helpers';

describe('dot products against Fraction-exact and NumPy accumulations', () => {
  const fx = loadFixture<{ cases: { a: string[]; b: string[]; exact: string; seqFp32: string; seqFp16: string }[] }>('dot-products.json');
  fx.cases.forEach((c, i) => {
    it(`case ${i} (n = ${c.a.length})`, () => {
      const a = c.a.map(hexToDouble);
      const b = c.b.map(hexToDouble);
      expect(exactDot(a, b)).toBe(hexToDouble(c.exact));
      const r32 = simulatedDot(a, b, makeArithConfig({ productFormat: 'fp32', accumulatorFormat: 'fp32', outputFormat: 'fp32' }));
      expect(r32.value).toBe(hexToDouble(c.seqFp32));
      expect(r32.exact).toBe(hexToDouble(c.exact));
      const r16 = simulatedDot(a, b, makeArithConfig({ productFormat: 'fp16', accumulatorFormat: 'fp16', outputFormat: 'fp16' }));
      expect(sameValue(r16.value, hexToDouble(c.seqFp16))).toBe(true);
    });
  });
});

describe('binary32 add/mul under directed rounding match C fesetround', () => {
  const fx = loadFixture<{ modes: RoundingMode[]; add32: [string, string, string[]][]; mul32: [string, string, string[]][] }>('directed-rounding.json');
  for (const op of ['add32', 'mul32'] as const) {
    it(`${op}: ${fx[op].length} pairs × 4 modes`, () => {
      for (const [ah, bh, res] of fx[op]) {
        const a = Math.fround(hexToDouble(ah));
        const b = Math.fround(hexToDouble(bh));
        fx.modes.forEach((mode, m) => {
          const machine = new ArithMachine(makeArithConfig({ rounding: mode, productFormat: 'fp32', accumulatorFormat: 'fp32' }));
          const got = op === 'add32' ? machine.add(a, b) : machine.mul(a, b);
          const expected = f32BitsToDouble(res[m]!);
          if (!sameValue(got, expected)) throw new Error(`${op} ${mode}(${show(a)}, ${show(b)}) = ${show(got)}, expected ${show(expected)}`);
        });
      }
    });
  }
});

describe('exact accumulation', () => {
  it('sums values spanning many binades exactly', () => {
    expect(exactSum([1e100, 1, -1e100])).toBe(1);
    expect(exactSum([0.1, 0.2, -0.3])).toBe(2.7755575615628914e-17);
    expect(exactDot([1e200, 1], [1e200, 1])).toBe(Infinity);
    expect(new ExactSum().add(Infinity).add(-Infinity).toNumber()).toBeNaN();
  });
});

describe('simulated accumulation behaviour', () => {
  it('FP16 accumulation of many small terms stagnates; FP32 does not', () => {
    const n = 4096;
    const a = new Float64Array(n).fill(1);
    const b = new Float64Array(n).fill(1);
    const fp16 = simulatedDot(a, b, makeArithConfig({ productFormat: 'fp16', accumulatorFormat: 'fp16', outputFormat: 'fp32' }));
    // In FP16, 2048 + 1 = 2048 (spacing 2), so the running sum stalls at 2048.
    expect(fp16.value).toBe(2048);
    expect(simulatedDot(a, b, makeArithConfig()).value).toBe(4096);
    // Pairwise summation keeps every partial sum exact here.
    expect(simulatedDot(a, b, makeArithConfig({ productFormat: 'fp16', accumulatorFormat: 'fp16', order: 'pairwise' })).value).toBe(4096);
    // Blocked: inner FP16 blocks of 256, outer FP32 accumulation.
    expect(simulatedDot(a, b, makeArithConfig({ productFormat: 'fp16', accumulatorFormat: 'fp16', order: 'blocked', blockSize: 256, outerFormat: 'fp32' })).value).toBe(4096);
    // Kahan-compensated summation in FP16 recovers the exact result.
    expect(simulatedDot(a, b, makeArithConfig({ productFormat: 'fp16', accumulatorFormat: 'fp16', order: 'kahan' })).value).toBe(4096);
  });
  it('step trace is consistent with the final value', () => {
    const a = [0.1, 0.2, 0.3, 1e-4];
    const b = [3, -1, 2, 7];
    const r = simulatedDot(a, b, makeArithConfig({ accumulatorFormat: 'bf16', productFormat: 'bf16', outputFormat: 'bf16' }), true);
    expect(r.steps).toHaveLength(4);
    expect(r.steps![3]!.accAfter).toBe(r.value);
    for (let i = 1; i < 4; i++) expect(r.steps![i]!.accBefore).toBe(r.steps![i - 1]!.accAfter);
    expect(r.steps![3]!.exactRunning).toBe(r.exact);
  });
  it('FP64 machine reproduces native JavaScript arithmetic', () => {
    const a = Array.from(generate({ kind: 'normal', params: {}, rows: 1, cols: 100, seed: 1 }));
    const b = Array.from(generate({ kind: 'normal', params: {}, rows: 1, cols: 100, seed: 2 }));
    let s = 0;
    for (let i = 0; i < 100; i++) s += a[i]! * b[i]!;
    expect(simulatedDot(a, b, FP64_ARITH).value).toBe(s);
  });
  it('overflowing accumulators follow the overflow policy', () => {
    const big = [60000, 60000];
    const one = [1, 1];
    expect(simulatedDot(big, one, makeArithConfig({ accumulatorFormat: 'fp16', productFormat: 'fp32', outputFormat: 'fp32' })).value).toBe(Infinity);
    expect(simulatedDot(big, one, makeArithConfig({ accumulatorFormat: 'fp16', productFormat: 'fp32', outputFormat: 'fp32', overflow: 'saturate' })).value).toBe(65504);
    expect(simulatedDot([300, 300], one, makeArithConfig({ accumulatorFormat: 'fp8_e4m3', productFormat: 'fp32', outputFormat: 'fp32', overflow: 'nonsaturate' })).value).toBeNaN();
  });
});

describe('matrix operations', () => {
  const A = matrix(2, 3, [1, 2, 3, 4, 5, 6]);
  const B = matrix(3, 2, [7, 8, 9, 10, 11, 12]);
  it('matmul in FP64 equals the textbook product', () => {
    const r = matmul(A, B, FP64_ARITH);
    expect(Array.from(r.value.data)).toEqual([58, 64, 139, 154]);
    expect(Array.from(r.exact.data)).toEqual([58, 64, 139, 154]);
  });
  it('matvec is matmul with one column; entry trace matches', () => {
    const v = matrix(3, 1, [0.1, 0.2, 0.3]);
    const cfg = makeArithConfig({ accumulatorFormat: 'fp16', productFormat: 'fp16', outputFormat: 'fp16', rounding: 'stochastic', seed: 5 });
    const r = matmul(A, v, cfg);
    const t = matmulEntryTrace(A, v, 1, 0, cfg);
    expect(t.value).toBe(r.value.data[1]);
    expect(() => matmul(A, A, cfg)).toThrow();
  });
  it('vector add and scalar multiply round each result', () => {
    const cfg = makeArithConfig({ accumulatorFormat: 'fp16', productFormat: 'fp16', outputFormat: 'fp16' });
    expect(Array.from(vectorAdd([2048], [1], cfg).value)).toEqual([2048]);
    expect(Array.from(vectorAdd([2048], [1], cfg).exact)).toEqual([2049]);
    expect(Array.from(scalarMultiply(0.1, [3], cfg).value)).toEqual([0.300048828125]);
  });
});

describe('integer path', () => {
  const M = 4;
  const K = 64;
  const N = 3;
  const a = generate({ kind: 'normal', params: {}, rows: M, cols: K, seed: 10 });
  const b = generate({ kind: 'normal', params: {}, rows: K, cols: N, seed: 11 });
  it('per-row A × per-column B equals the dequantized product up to FP rounding', () => {
    const qa = quantizeTensor(a, [M, K], makeQuantConfig({ format: 'int8', granularity: 'channel', axis: 0 }));
    const qb = quantizeTensor(b, [K, N], makeQuantConfig({ format: 'int8', granularity: 'channel', axis: 1, scheme: 'asymmetric' }));
    expect(integerPathSupport(qa, qb).ok).toBe(true);
    const ri = integerMatmul(qa, qb, { accumulator: 'exact', rescaleFormat: 'fp64', outputFormat: 'fp64' });
    const rf = matmul(matrix(M, K, qa.recon), matrix(K, N, qb.recon), FP64_ARITH);
    for (let i = 0; i < M * N; i++) expect(ri.value.data[i]).toBeCloseTo(rf.exact.data[i]!, 10);
    expect(ri.int32Overflows).toBe(0);
  });
  it('group-wise scales split the reduction into segments', () => {
    const qa = quantizeTensor(a, [M, K], makeQuantConfig({ format: 'int4', granularity: 'group', axis: 0, groupSize: 16 }));
    const qb = quantizeTensor(b, [K, N], makeQuantConfig({ format: 'int4', granularity: 'group', axis: 1, groupSize: 32 }));
    const ri = integerMatmul(qa, qb, { accumulator: 'int32-wrap', rescaleFormat: 'fp32', outputFormat: 'fp32' });
    expect(ri.segments).toBe(M * N * 4);
    const rf = matmul(matrix(M, K, qa.recon), matrix(K, N, qb.recon), FP64_ARITH);
    for (let i = 0; i < M * N; i++) expect(Math.abs(ri.value.data[i]! - rf.exact.data[i]!)).toBeLessThan(1e-5);
  });
  it('rejects incompatible granularity with an explanation', () => {
    const qa = quantizeTensor(a, [M, K], makeQuantConfig({ format: 'int8', granularity: 'channel', axis: 1 }));
    const qb = quantizeTensor(b, [K, N], makeQuantConfig({ format: 'int8' }));
    expect(integerPathSupport(qa, qb)).toMatchObject({ ok: false });
    const qf = quantizeTensor(b, [K, N], makeQuantConfig({ format: 'fp8_e4m3' }));
    expect(integerPathSupport(qb, qf).ok).toBe(false);
  });
  it('detects INT32 accumulator overflow and wraps', () => {
    const big = new Float64Array(200000).fill(1);
    const qa = quantizeTensor(big, [1, 200000], makeQuantConfig({ format: 'int8' }));
    const qb = quantizeTensor(big, [200000, 1], makeQuantConfig({ format: 'int8' }));
    const r = integerMatmul(qa, qb, { accumulator: 'int32-wrap', rescaleFormat: 'fp64', outputFormat: 'fp64' });
    expect(r.int32Overflows).toBe(1);
    expect(r.value.data[0]).toBeLessThan(0); // 127·127·200000 wraps negative
    const s = integerMatmul(qa, qb, { accumulator: 'int32-saturate', rescaleFormat: 'fp64', outputFormat: 'fp64' });
    const expected = 2147483647 * qa.params[0]!.scale * qb.params[0]!.scale;
    expect(Math.abs(s.value.data[0]! - expected) / expected).toBeLessThan(1e-12);
  });
});

describe('regressions from independent review', () => {
  it('binary64-overflowing sums and products follow IEEE §7.4 under directed rounding', () => {
    const rtz = (fmt: 'fp64' | 'fp32') => new ArithMachine(makeArithConfig({ rounding: 'toward-zero', accumulatorFormat: fmt, productFormat: fmt }));
    expect(rtz('fp64').add(1.5e308, 1.5e308)).toBe(Number.MAX_VALUE);
    expect(rtz('fp32').mul(1e200, 1e200)).toBe(3.4028234663852886e38);
    expect(new ArithMachine(makeArithConfig({ rounding: 'toward-negative', productFormat: 'fp32' })).mul(-1e200, 1e200)).toBe(-Infinity);
    const sat = new ArithMachine(makeArithConfig({ accumulatorFormat: 'fp64', overflow: 'saturate' }));
    sat.add(1.5e308, 1.5e308);
    expect(sat.flags & 2).toBeTruthy(); // Overflow flag
  });
  it('products near or below the subnormal range are rounded exactly', () => {
    const ru = new ArithMachine(makeArithConfig({ rounding: 'toward-positive', productFormat: 'fp32' }));
    expect(ru.mul(2 ** -540, 2 ** -540)).toBe(2 ** -149);
    const rz = new ArithMachine(makeArithConfig({ rounding: 'toward-zero', productFormat: 'fp64' }));
    expect(rz.mul(1.5 * 2 ** -600, 2 ** -474)).toBe(2 ** -1074);
  });
  it('pairwise summation rounds a single term to the accumulator format', () => {
    const cfg = makeArithConfig({ productFormat: 'fp32', accumulatorFormat: 'fp16', outputFormat: 'fp32', order: 'pairwise' });
    expect(simulatedDot([1 + 2 ** -20], [1], cfg).value).toBe(1);
  });
  it('integer path reports the true (unwrapped) partial sum', () => {
    const big = new Float64Array(140000).fill(1);
    const qa = quantizeTensor(big, [1, 140000], makeQuantConfig({ format: 'int8' }));
    const qb = quantizeTensor(big, [140000, 1], makeQuantConfig({ format: 'int8' }));
    const r = integerMatmul(qa, qb, { accumulator: 'int32-wrap', rescaleFormat: 'fp64', outputFormat: 'fp64' });
    expect(r.maxAbsPartial).toBe(127 * 127 * 140000);
  });
});
