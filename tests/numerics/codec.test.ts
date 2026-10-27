/**
 * Exhaustive bit-pattern tests against ml_dtypes / NumPy decode tables
 * (tests/fixtures/decode-tables.json) plus encode/decode round trips.
 */
import { describe, expect, it } from 'vitest';
import { decode, encode, enumerateFinite, nextDownIn, nextUpIn, splitFields } from '@/engine/float/codec';
import { bitsToDouble, doubleToBits } from '@/engine/float/double';
import { characteristics, FLOAT_FORMATS } from '@/engine/formats/registry';
import type { FloatFormatId } from '@/engine/formats/types';
import { decodeInt, encodeInt } from '@/engine/int/codec';
import { INT_FORMATS } from '@/engine/formats/registry';
import { hexToDouble, loadFixture, sameValue, show } from './helpers';

interface DecodeTables {
  small: Record<string, string[]>;
  fp16_f32_b64: string;
  bf16_f32_b64: string;
}
const tables = loadFixture<DecodeTables>('decode-tables.json');

function f32Table(b64: string): Float32Array {
  const buf = Buffer.from(b64, 'base64');
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

describe('exhaustive decode matches ml_dtypes', () => {
  for (const [id, hexes] of Object.entries(tables.small)) {
    it(`${id}: all ${hexes.length} patterns`, () => {
      const fmt = FLOAT_FORMATS[id as FloatFormatId];
      hexes.forEach((h, b) => {
        const expected = hexToDouble(h);
        const got = decode(fmt, BigInt(b)).value;
        if (!sameValue(got, expected)) throw new Error(`${id} 0x${b.toString(16)}: got ${show(got)} expected ${show(expected)}`);
      });
    });
  }
  it('fp16: all 65536 patterns (NumPy float16)', () => {
    const t = f32Table(tables.fp16_f32_b64);
    for (let b = 0; b < 65536; b++) {
      const got = decode(FLOAT_FORMATS.fp16, BigInt(b)).value;
      if (!sameValue(got, t[b]!)) throw new Error(`fp16 0x${b.toString(16)}: got ${got} expected ${t[b]}`);
    }
  });
  it('bf16: all 65536 patterns (ml_dtypes bfloat16)', () => {
    const t = f32Table(tables.bf16_f32_b64);
    for (let b = 0; b < 65536; b++) {
      const got = decode(FLOAT_FORMATS.bf16, BigInt(b)).value;
      if (!sameValue(got, t[b]!)) throw new Error(`bf16 0x${b.toString(16)}: got ${got} expected ${t[b]}`);
    }
  });
});

describe('encode/decode round trips', () => {
  const ids: FloatFormatId[] = ['fp8_e4m3', 'fp8_e5m2', 'fp4_e2m1', 'fp8_e4m3fnuz', 'fp8_e5m2fnuz', 'fp16', 'bf16'];
  for (const id of ids) {
    it(`${id}: encode(decode(b)) = b for every non-NaN pattern`, () => {
      const fmt = FLOAT_FORMATS[id];
      const n = 1 << fmt.totalBits;
      let nans = 0;
      for (let b = 0; b < n; b++) {
        const d = decode(fmt, BigInt(b));
        if (d.cls === 'nan') {
          nans++;
          continue;
        }
        expect(encode(fmt, d.value)).toBe(BigInt(b));
      }
      expect(nans).toBe(characteristics(fmt).nanEncodings);
    });
  }
  it('fp32: round trips for 200k sampled patterns (vs DataView)', () => {
    const dv = new DataView(new ArrayBuffer(4));
    let x = 0x12345678;
    for (let i = 0; i < 200000; i++) {
      x = (Math.imul(x, 1103515245) + 12345) >>> 0;
      dv.setUint32(0, x);
      const v = dv.getFloat32(0);
      const d = decode(FLOAT_FORMATS.fp32, BigInt(x));
      expect(sameValue(d.value, v)).toBe(true);
      if (!Number.isNaN(v)) expect(encode(FLOAT_FORMATS.fp32, v)).toBe(BigInt(x));
    }
  });
  it('fp64 encode equals the DataView bit pattern', () => {
    for (const v of [0, -0, 1, -1, 0.1, Math.PI, Number.MAX_VALUE, Number.MIN_VALUE, Infinity, -Infinity]) {
      expect(encode(FLOAT_FORMATS.fp64, v)).toBe(doubleToBits(v));
      expect(bitsToDouble(encode(FLOAT_FORMATS.fp64, v))).toBe(v);
    }
  });
});

describe('specific encodings from the specs', () => {
  it('E4M3: max 448 = S.1111.110, NaN = S.1111.111, min subnormal = S.0000.001', () => {
    const f = FLOAT_FORMATS.fp8_e4m3;
    expect(encode(f, 448)).toBe(0b0_1111_110n);
    expect(encode(f, -448)).toBe(0b1_1111_110n);
    expect(decode(f, 0b0_1111_111n).cls).toBe('nan');
    expect(decode(f, 0b1_1111_111n).cls).toBe('nan');
    expect(encode(f, NaN)).toBe(0b0_1111_111n);
    expect(encode(f, 2 ** -9)).toBe(1n);
    expect(decode(f, 0b0_1111_000n).value).toBe(256); // exponent 1111 is finite in E4M3
  });
  it('E5M2: Inf = S.11111.00, NaN = S.11111.{01,10,11}, max = S.11110.11', () => {
    const f = FLOAT_FORMATS.fp8_e5m2;
    expect(decode(f, 0b0_11111_00n).value).toBe(Infinity);
    expect(decode(f, 0b1_11111_00n).value).toBe(-Infinity);
    for (const m of [1n, 2n, 3n]) expect(decode(f, 0b0_11111_00n | m).cls).toBe('nan');
    expect(encode(f, 57344)).toBe(0b0_11110_11n);
  });
  it('FP4 E2M1 values ±{0, 0.5, 1, 1.5, 2, 3, 4, 6}', () => {
    expect(Array.from(enumerateFinite(FLOAT_FORMATS.fp4_e2m1))).toEqual([-6, -4, -3, -2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2, 3, 4, 6]);
    expect(encode(FLOAT_FORMATS.fp4_e2m1, -0)).toBe(0b1000n);
    expect(() => encode(FLOAT_FORMATS.fp4_e2m1, NaN)).toThrow();
  });
  it('FNUZ: 0x80 is NaN and −0 encodes as +0', () => {
    const f = FLOAT_FORMATS.fp8_e4m3fnuz;
    expect(decode(f, 0x80n).cls).toBe('nan');
    expect(encode(f, -0)).toBe(0n);
  });
  it('BF16 1.0 = 0x3F80 and FP16 1.0 = 0x3C00', () => {
    expect(encode(FLOAT_FORMATS.bf16, 1)).toBe(0x3f80n);
    expect(encode(FLOAT_FORMATS.fp16, 1)).toBe(0x3c00n);
    expect(splitFields(FLOAT_FORMATS.fp16, 0x3c00n)).toEqual({ sign: 0, exponent: 15, fraction: 0n });
  });
  it('rejects values that are not exactly representable', () => {
    expect(() => encode(FLOAT_FORMATS.fp16, 0.1)).toThrow();
    expect(() => encode(FLOAT_FORMATS.fp8_e4m3, 449)).toThrow();
    expect(() => encode(FLOAT_FORMATS.fp8_e4m3, Infinity)).toThrow();
  });
});

describe('neighbours', () => {
  it('nextUp/nextDown walk every finite value of small formats', () => {
    for (const id of ['fp8_e4m3', 'fp8_e5m2', 'fp4_e2m1', 'fp8_e4m3fnuz'] as FloatFormatId[]) {
      const f = FLOAT_FORMATS[id];
      const vals = Array.from(enumerateFinite(f));
      for (let i = 0; i + 1 < vals.length; i++) {
        // numeric equality: the step from −min subnormal lands on −0, which equals 0
        expect(nextUpIn(f, vals[i]!) === vals[i + 1]).toBe(true);
        expect(nextDownIn(f, vals[i + 1]!) === vals[i]).toBe(true);
      }
      const c = characteristics(f);
      expect(nextUpIn(f, c.maxFinite)).toBe(c.hasInfinity ? Infinity : null);
    }
  });
  it('nextUp of −min subnormal is −0; of 0 is min subnormal', () => {
    const f = FLOAT_FORMATS.fp16;
    expect(Object.is(nextUpIn(f, -(2 ** -24)), -0)).toBe(true);
    expect(nextUpIn(f, 0)).toBe(2 ** -24);
  });
});

describe('integer codec', () => {
  it('INT4 two\'s complement encodings', () => {
    const f = INT_FORMATS.int4;
    for (let q = -8; q <= 7; q++) expect(decodeInt(f, encodeInt(f, q))).toBe(q);
    expect(encodeInt(f, -1)).toBe(0b1111n);
    expect(encodeInt(f, -8)).toBe(0b1000n);
    expect(() => encodeInt(f, 8)).toThrow();
  });
  it('INT8 exhaustive', () => {
    const f = INT_FORMATS.int8;
    for (let b = 0; b < 256; b++) {
      const q = decodeInt(f, BigInt(b));
      expect(q).toBe(b >= 128 ? b - 256 : b);
      expect(encodeInt(f, q)).toBe(BigInt(b));
    }
  });
});

describe('regressions from independent review', () => {
  it('FNUZ nextUp from the negative side lands on +0 (the format has no −0)', () => {
    expect(Object.is(nextUpIn(FLOAT_FORMATS.fp8_e4m3fnuz, -(2 ** -10)), 0)).toBe(true);
  });
});
