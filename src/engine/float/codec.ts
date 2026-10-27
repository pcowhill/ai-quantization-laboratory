/**
 * Bit-level encoding and decoding for the simulated floating-point formats.
 *
 * Bit patterns are represented as BigInt so that FP64 patterns are handled
 * exactly. `encode` requires a value that is exactly representable in the
 * format (use `roundFloat` first); `decode` accepts any bit pattern.
 */
import { characteristics } from '../formats/registry';
import type { FloatFormat } from '../formats/types';
import { bitsToDouble, doubleToBits, exponentOf, pow2, signBit } from './double';

export type FloatClass = 'zero' | 'subnormal' | 'normal' | 'infinity' | 'nan';

export interface FloatFields {
  sign: number;
  /** Biased exponent field. */
  exponent: number;
  /** Fraction (trailing significand) field. */
  fraction: bigint;
}

export interface DecodedFloat extends FloatFields {
  bits: bigint;
  value: number;
  cls: FloatClass;
  /** Unbiased exponent used in the value formula (emin for subnormals); null for specials/zero. */
  unbiasedExponent: number | null;
  /** Significand including the implicit bit, as a value in [0, 2) (null for Inf/NaN). */
  significand: number | null;
}

export function fieldMasks(fmt: FloatFormat) {
  const fracMask = (1n << BigInt(fmt.fractionBits)) - 1n;
  const expMask = (1n << BigInt(fmt.exponentBits)) - 1n;
  const allMask = (1n << BigInt(fmt.totalBits)) - 1n;
  return { fracMask, expMask, allMask };
}

export function splitFields(fmt: FloatFormat, bits: bigint): FloatFields {
  const { fracMask, expMask, allMask } = fieldMasks(fmt);
  const b = bits & allMask;
  return {
    sign: Number(b >> BigInt(fmt.totalBits - 1)),
    exponent: Number((b >> BigInt(fmt.fractionBits)) & expMask),
    fraction: b & fracMask,
  };
}

export function joinFields(fmt: FloatFormat, f: FloatFields): bigint {
  return (
    (BigInt(f.sign) << BigInt(fmt.totalBits - 1)) |
    (BigInt(f.exponent) << BigInt(fmt.fractionBits)) |
    f.fraction
  );
}

/** Canonical NaN encoding used when encoding NaN values. */
export function canonicalNaN(fmt: FloatFormat): bigint | null {
  const { fracMask, expMask } = fieldMasks(fmt);
  switch (fmt.special) {
    case 'ieee':
      // Quiet NaN: exponent all ones, most significant fraction bit set.
      return (expMask << BigInt(fmt.fractionBits)) | (1n << BigInt(fmt.fractionBits - 1));
    case 'fn':
      return (expMask << BigInt(fmt.fractionBits)) | fracMask;
    case 'fnuz':
      return 1n << BigInt(fmt.totalBits - 1);
    case 'none':
      return null;
  }
}

/** Classifies and decodes a bit pattern. */
export function decode(fmt: FloatFormat, bits: bigint): DecodedFloat {
  const { allMask } = fieldMasks(fmt);
  const b = bits & allMask;
  const f = splitFields(fmt, b);
  const c = characteristics(fmt);
  const maxExp = 2 ** fmt.exponentBits - 1;
  const fracMax = (1n << BigInt(fmt.fractionBits)) - 1n;
  const base = { ...f, bits: b };
  if (fmt.id === 'fp64') {
    const value = bitsToDouble(b);
    return { ...base, value, ...classifyParts(fmt, f, value) };
  }
  // Special encodings
  if (fmt.special === 'ieee' && f.exponent === maxExp) {
    if (f.fraction === 0n) {
      const value = f.sign ? -Infinity : Infinity;
      return { ...base, value, cls: 'infinity', unbiasedExponent: null, significand: null };
    }
    return { ...base, value: NaN, cls: 'nan', unbiasedExponent: null, significand: null };
  }
  if (fmt.special === 'fn' && f.exponent === maxExp && f.fraction === fracMax) {
    return { ...base, value: NaN, cls: 'nan', unbiasedExponent: null, significand: null };
  }
  if (fmt.special === 'fnuz' && f.sign === 1 && f.exponent === 0 && f.fraction === 0n) {
    return { ...base, value: NaN, cls: 'nan', unbiasedExponent: null, significand: null };
  }
  const fracNum = Number(f.fraction);
  let value: number;
  if (f.exponent === 0) {
    value = fracNum * pow2(c.emin - fmt.fractionBits);
  } else {
    value = (2 ** fmt.fractionBits + fracNum) * pow2(f.exponent - fmt.bias - fmt.fractionBits);
  }
  if (f.sign) value = -value;
  return { ...base, value, ...classifyParts(fmt, f, value) };
}

function classifyParts(
  fmt: FloatFormat,
  f: FloatFields,
  value: number,
): { cls: FloatClass; unbiasedExponent: number | null; significand: number | null } {
  const c = characteristics(fmt);
  if (Number.isNaN(value)) return { cls: 'nan', unbiasedExponent: null, significand: null };
  if (!Number.isFinite(value)) return { cls: 'infinity', unbiasedExponent: null, significand: null };
  const frac = Number(f.fraction) / 2 ** fmt.fractionBits;
  if (f.exponent === 0) {
    if (f.fraction === 0n) return { cls: 'zero', unbiasedExponent: null, significand: 0 };
    return { cls: 'subnormal', unbiasedExponent: c.emin, significand: frac };
  }
  return { cls: 'normal', unbiasedExponent: f.exponent - fmt.bias, significand: 1 + frac };
}

export function decodeValue(fmt: FloatFormat, bits: bigint): number {
  return decode(fmt, bits).value;
}

export class EncodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EncodeError';
  }
}

/**
 * Encodes a value that is exactly representable in `fmt`. NaN maps to the
 * format's canonical NaN. Throws EncodeError for non-representable values.
 */
export function encode(fmt: FloatFormat, value: number): bigint {
  if (fmt.id === 'fp64') return doubleToBits(Number.isNaN(value) ? NaN : value);
  const c = characteristics(fmt);
  const { expMask } = fieldMasks(fmt);
  const signBitValue = BigInt(fmt.totalBits - 1);
  if (Number.isNaN(value)) {
    const nan = canonicalNaN(fmt);
    if (nan === null) throw new EncodeError(`${fmt.name} has no NaN encoding`);
    return nan;
  }
  const neg = signBit(value);
  if (!Number.isFinite(value)) {
    if (!c.hasInfinity) throw new EncodeError(`${fmt.name} has no infinity encoding`);
    return ((neg ? 1n : 0n) << signBitValue) | (expMask << BigInt(fmt.fractionBits));
  }
  if (value === 0) {
    if (neg && c.hasNegativeZero) return 1n << signBitValue;
    return 0n;
  }
  const a = Math.abs(value);
  if (a > c.maxFinite) throw new EncodeError(`${value} exceeds the largest finite ${fmt.name} value`);
  const e = exponentOf(a);
  let expField: number;
  let fracField: number;
  if (e < c.emin) {
    expField = 0;
    fracField = a / pow2(c.emin - fmt.fractionBits);
  } else {
    expField = e + fmt.bias;
    fracField = (a / pow2(e) - 1) * 2 ** fmt.fractionBits;
  }
  if (!Number.isInteger(fracField)) {
    throw new EncodeError(`${value} is not exactly representable in ${fmt.name}; round it first`);
  }
  return (
    ((neg ? 1n : 0n) << signBitValue) |
    (BigInt(expField) << BigInt(fmt.fractionBits)) |
    BigInt(fracField)
  );
}

/** Classification of a value already in the format. */
export function classify(fmt: FloatFormat, value: number): FloatClass {
  if (Number.isNaN(value)) return 'nan';
  if (!Number.isFinite(value)) return 'infinity';
  if (value === 0) return 'zero';
  return Math.abs(value) < characteristics(fmt).minNormal ? 'subnormal' : 'normal';
}

/** True when `value` is exactly a value of the format (NaN counts if the format has NaN). */
export function isRepresentable(fmt: FloatFormat, value: number): boolean {
  try {
    encode(fmt, value);
    return true;
  } catch {
    return false;
  }
}

export function bitsToBinary(bits: bigint, width: number): string {
  return bits.toString(2).padStart(width, '0');
}

export function bitsToHex(bits: bigint, width: number): string {
  return bits.toString(16).toUpperCase().padStart(Math.ceil(width / 4), '0');
}

/**
 * Next representable value above `value` in the format (IEEE nextUp
 * semantics). Returns null when there is none (max finite for formats
 * without infinity, +Inf, NaN).
 */
export function nextUpIn(fmt: FloatFormat, value: number): number | null {
  if (Number.isNaN(value) || value === Infinity) return null;
  const c = characteristics(fmt);
  if (value === -Infinity) return -c.maxFinite;
  if (value === 0) return c.minSubnormal;
  if (value === c.maxFinite) return c.hasInfinity ? Infinity : null;
  const bits = encode(fmt, value);
  const signMask = 1n << BigInt(fmt.totalBits - 1);
  // Positive values move up by incrementing the pattern; negative ones by decrementing.
  const next = value > 0 ? bits + 1n : bits - 1n;
  const v = decode(fmt, next).value;
  if (value < 0 && (next & ~signMask) === 0n) return c.hasNegativeZero ? -0 : 0;
  return v;
}

export function nextDownIn(fmt: FloatFormat, value: number): number | null {
  const up = nextUpIn(fmt, -value);
  return up === null ? null : -up;
}

/**
 * All finite values of a format with at most 16 bits, sorted ascending,
 * with −0 omitted (it equals +0 numerically).
 */
export function enumerateFinite(fmt: FloatFormat): Float64Array {
  if (fmt.totalBits > 16) throw new Error(`Cannot enumerate ${fmt.name}: too many encodings`);
  const out: number[] = [];
  const count = 1 << fmt.totalBits;
  for (let b = 0; b < count; b++) {
    const d = decode(fmt, BigInt(b));
    if (d.cls === 'nan' || d.cls === 'infinity') continue;
    if (Object.is(d.value, -0)) continue;
    out.push(d.value);
  }
  return Float64Array.from(out).sort();
}

/** Exponent of a double, exported for UI helpers. */
export { exponentOf };
