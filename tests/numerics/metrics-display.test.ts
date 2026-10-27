import { describe, expect, it } from 'vitest';
import { exactDecimal, shortestDecimal } from '@/engine/float/rational';
import { FLOAT_FORMATS } from '@/engine/formats/registry';
import { computeErrorMetrics, relativeError } from '@/engine/metrics/error';
import { summarize } from '@/engine/metrics/stats';

describe('error metrics (hand-computed)', () => {
  it('basic aggregates', () => {
    const m = computeErrorMetrics([1, 2, 3, 4], [1, 2.5, 2, 4]);
    expect(m.mae).toBe(0.375);
    expect(m.mse).toBe(0.3125);
    expect(m.rmse).toBeCloseTo(Math.sqrt(0.3125), 15);
    expect(m.maxAbs).toBe(1);
    expect(m.maxAbsIndex).toBe(2);
    expect(m.meanRelative).toBeCloseTo((0.25 + 1 / 3) / 4, 15);
    expect(m.snrDb).toBeCloseTo(10 * Math.log10(30 / 1.25), 12);
    expect(m.bias).toBe(-0.125);
  });
  it('relative error convention for zero references', () => {
    expect(relativeError(0, 0)).toBe(0);
    expect(relativeError(0, 1e-3)).toBeNull();
    const m = computeErrorMetrics([0, 0, 2], [0, 1, 2]);
    expect(m.relativeUndefined).toBe(1);
    expect(m.meanRelative).toBe(0); // the two defined pairs are exact
    expect(m.zeroRate).toBeCloseTo(1 / 3, 15);
    expect(m.zeroCollapseRate).toBe(0);
  });
  it('undefined cosine / SNR', () => {
    const m = computeErrorMetrics([0, 0], [1, 1]);
    expect(m.cosine).toBeNull();
    expect(m.snrDb).toBeNull();
    expect(computeErrorMetrics([1, -1], [-1, 1]).cosine).toBeCloseTo(-1, 15);
  });
  it('non-finite pairs are excluded and counted', () => {
    const m = computeErrorMetrics([1, NaN, 3], [1, 2, Infinity]);
    expect(m.finitePairs).toBe(1);
    expect(m.nonFinitePairs).toBe(2);
    expect(m.mse).toBe(0);
  });
  it('zero collapse and saturation rates', () => {
    const m = computeErrorMetrics([0.01, 5, 0], [0, 4, 0], (i) => i === 1);
    expect(m.zeroCollapseRate).toBe(0.5);
    expect(m.saturationRate).toBeCloseTo(1 / 3, 15);
  });
  it('summary statistics', () => {
    const s = summarize([1, 2, 3, 4, NaN]);
    expect(s).toMatchObject({ count: 4, nonFinite: 1, min: 1, max: 4, mean: 2.5, median: 2.5 });
    expect(s.std).toBeCloseTo(Math.sqrt(1.25), 15);
  });
});

describe('decimal display', () => {
  it('exact decimal expansion of binary values', () => {
    expect(exactDecimal(0.1)).toBe('0.1000000000000000055511151231257827021181583404541015625');
    expect(exactDecimal(-0.5)).toBe('-0.5');
    expect(exactDecimal(2 ** 70)).toBe('1180591620717411303424');
    expect(exactDecimal(-0)).toBe('-0');
    expect(exactDecimal(Number.MIN_VALUE).length).toBeGreaterThan(700);
  });
  it('shortest round-trip decimal per format', () => {
    expect(shortestDecimal(FLOAT_FORMATS.fp16, 0.0999755859375)).toBe('0.1');
    expect(shortestDecimal(FLOAT_FORMATS.bf16, 0.10009765625)).toBe('0.1');
    expect(shortestDecimal(FLOAT_FORMATS.fp32, Math.fround(1 / 3))).toBe('0.33333334');
    // 450 is the shortest decimal that converts back to 448 in E4M3
    expect(shortestDecimal(FLOAT_FORMATS.fp8_e4m3, 448)).toBe('450');
    expect(shortestDecimal(FLOAT_FORMATS.fp8_e4m3, 0.1015625)).toBe('0.1');
    expect(shortestDecimal(FLOAT_FORMATS.fp64, 0.1)).toBe('0.1');
  });
});

describe('regressions from independent review', () => {
  it('cosine and SNR stay defined when x and x̂ differ by hundreds of binades', () => {
    const m = computeErrorMetrics([1e-170], [1e10]);
    expect(m.cosine).toBeCloseTo(1, 12);
    expect(m.snrDb).toBeCloseTo(20 * Math.log10(1e-170 / (1e10 - 1e-170)), 6);
  });
  it('MSE of huge but finite errors is computed without spurious overflow', () => {
    expect(computeErrorMetrics([1e200], [3e200]).mse).toBe(Infinity); // (2e200)² genuinely overflows
    expect(computeErrorMetrics([1e150], [3e150]).rmse).toBeCloseTo(2e150, -136);
  });
});
