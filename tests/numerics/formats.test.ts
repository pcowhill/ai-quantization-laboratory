/**
 * Format characteristics checked against the values printed in the
 * specifications (OCP OFP8 rev 1.0 Tables 1–2, OCP MX v1.0 Table 5,
 * IEEE 754-2019 Table 3.5) — hand-transcribed, not computed by the engine.
 */
import { describe, expect, it } from 'vitest';
import { characteristics, FLOAT_FORMATS, INT_FORMATS, PRIMARY_FORMAT_IDS } from '@/engine/formats/registry';

describe('format characteristics match specification tables', () => {
  const table: Record<string, { bias: number; emax: number; emin: number; max: number; minNormal: number; minSub: number; maxSub: number }> = {
    // OCP OFP8 Table 1 & 2
    fp8_e4m3: { bias: 7, emax: 8, emin: -6, max: 448, minNormal: 2 ** -6, minSub: 2 ** -9, maxSub: 0.875 * 2 ** -6 },
    fp8_e5m2: { bias: 15, emax: 15, emin: -14, max: 57344, minNormal: 2 ** -14, minSub: 2 ** -16, maxSub: 0.75 * 2 ** -14 },
    // OCP MX Table 5
    fp4_e2m1: { bias: 1, emax: 2, emin: 0, max: 6, minNormal: 1, minSub: 0.5, maxSub: 0.5 },
    // IEEE 754-2019 Table 3.5
    fp16: { bias: 15, emax: 15, emin: -14, max: 65504, minNormal: 2 ** -14, minSub: 2 ** -24, maxSub: 2 ** -14 - 2 ** -24 },
    fp32: { bias: 127, emax: 127, emin: -126, max: 3.4028234663852886e38, minNormal: 2 ** -126, minSub: 2 ** -149, maxSub: 2 ** -126 - 2 ** -149 },
    fp64: { bias: 1023, emax: 1023, emin: -1022, max: Number.MAX_VALUE, minNormal: 2.2250738585072014e-308, minSub: Number.MIN_VALUE, maxSub: 2.225073858507201e-308 },
    // bfloat16: binary32 exponent range, 8-bit precision
    bf16: { bias: 127, emax: 127, emin: -126, max: 3.3895313892515355e38, minNormal: 2 ** -126, minSub: 2 ** -133, maxSub: 2 ** -126 - 2 ** -133 },
    // FNUZ variants (ml_dtypes finfo)
    fp8_e4m3fnuz: { bias: 8, emax: 7, emin: -7, max: 240, minNormal: 2 ** -7, minSub: 2 ** -10, maxSub: 0.875 * 2 ** -7 },
    fp8_e5m2fnuz: { bias: 16, emax: 15, emin: -15, max: 57344, minNormal: 2 ** -15, minSub: 2 ** -17, maxSub: 0.75 * 2 ** -15 },
  };
  for (const [id, exp] of Object.entries(table)) {
    it(`${id}`, () => {
      const f = FLOAT_FORMATS[id as keyof typeof FLOAT_FORMATS];
      const c = characteristics(f);
      expect(f.bias).toBe(exp.bias);
      expect(c.emax).toBe(exp.emax);
      expect(c.emin).toBe(exp.emin);
      expect(c.maxFinite).toBe(exp.max);
      expect(c.minNormal).toBe(exp.minNormal);
      expect(c.minSubnormal).toBe(exp.minSub);
      expect(c.maxSubnormal).toBe(exp.maxSub);
    });
  }

  it('special-value support per spec', () => {
    expect(characteristics(FLOAT_FORMATS.fp8_e4m3)).toMatchObject({ hasInfinity: false, hasNaN: true, nanEncodings: 2, hasNegativeZero: true });
    expect(characteristics(FLOAT_FORMATS.fp8_e5m2)).toMatchObject({ hasInfinity: true, hasNaN: true, nanEncodings: 6 });
    expect(characteristics(FLOAT_FORMATS.fp4_e2m1)).toMatchObject({ hasInfinity: false, hasNaN: false, nanEncodings: 0 });
    expect(characteristics(FLOAT_FORMATS.fp8_e4m3fnuz)).toMatchObject({ hasInfinity: false, nanEncodings: 1, hasNegativeZero: false });
    expect(characteristics(FLOAT_FORMATS.fp16).epsilon).toBe(2 ** -10);
    expect(characteristics(FLOAT_FORMATS.bf16).epsilon).toBe(2 ** -7);
  });

  it('OCP dynamic range in binades (Table 2: 18 and 32, rounded)', () => {
    expect(Math.round(characteristics(FLOAT_FORMATS.fp8_e4m3).dynamicRangeBinades)).toBe(18);
    expect(Math.round(characteristics(FLOAT_FORMATS.fp8_e5m2).dynamicRangeBinades)).toBe(32);
  });

  it('integer ranges', () => {
    expect(INT_FORMATS.int8).toMatchObject({ min: -128, max: 127, totalBits: 8 });
    expect(INT_FORMATS.int4).toMatchObject({ min: -8, max: 7, totalBits: 4 });
  });

  it('all nine required formats are registered with references', () => {
    expect(PRIMARY_FORMAT_IDS).toHaveLength(9);
    for (const f of Object.values(FLOAT_FORMATS)) expect(f.references.length).toBeGreaterThan(0);
  });
});
