/**
 * Format type definitions.
 *
 * A *format* describes how a single element is encoded in bits. It is
 * deliberately distinct from a *quantization scheme* (see `engine/quant`),
 * which combines an element format with shared scaling metadata.
 */

export type FloatFormatId =
  | 'fp64'
  | 'fp32'
  | 'fp16'
  | 'bf16'
  | 'fp8_e4m3'
  | 'fp8_e5m2'
  | 'fp4_e2m1'
  | 'fp8_e4m3fnuz'
  | 'fp8_e5m2fnuz';

export type IntFormatId = 'int8' | 'int4';

export type FormatId = FloatFormatId | IntFormatId;

/**
 * How the format reserves encodings for special values.
 * - `ieee`: exponent field all ones encodes ±Inf (fraction 0) and NaN (fraction ≠ 0).
 * - `fn`:   finite + NaN only; the single pattern S.1…1.1…1 is NaN (OCP E4M3).
 * - `fnuz`: finite + NaN only, no negative zero; the pattern 1.0…0.0…0 is the only NaN.
 * - `none`: every encoding is a finite number (OCP MX FP4 E2M1).
 */
export type SpecialEncoding = 'ieee' | 'fn' | 'fnuz' | 'none';

/**
 * Behaviour when a rounded magnitude exceeds the largest finite value
 * in non-saturating mode.
 * - `ieee754`: IEEE 754-2019 §7.4, depends on rounding direction (to ±Inf or ±max).
 * - `inf`:     always ±Inf (OCP OFP8 E5M2 non-saturating mode).
 * - `nan`:     always NaN (OCP OFP8 E4M3 non-saturating mode; FNUZ variants).
 * - `saturate-only`: the format has no Inf/NaN, so conversion always saturates (FP4 E2M1).
 */
export type OverflowSemantics = 'ieee754' | 'inf' | 'nan' | 'saturate-only';

/** User-selectable overflow policy for conversions. */
export type OverflowMode = 'saturate' | 'nonsaturate';

export interface SpecReference {
  title: string;
  section?: string;
  url?: string;
}

export interface FloatFormat {
  kind: 'float';
  id: FloatFormatId;
  /** Display name, e.g. "FP8 E4M3". */
  name: string;
  /** Exact profile name, e.g. "OCP OFP8 E4M3 (a.k.a. E4M3FN)". */
  profile: string;
  totalBits: number;
  signBits: 1;
  exponentBits: number;
  /** Trailing significand (fraction / mantissa) bits. */
  fractionBits: number;
  bias: number;
  special: SpecialEncoding;
  overflowSemantics: OverflowSemantics;
  /** Overflow mode used when the user has not chosen one. */
  defaultOverflow: OverflowMode;
  hasSubnormals: true;
  /** True for formats included only to illustrate variant conventions. */
  variant: boolean;
  references: SpecReference[];
  notes: string[];
}

export interface IntFormat {
  kind: 'int';
  id: IntFormatId;
  name: string;
  profile: string;
  totalBits: number;
  signed: true;
  min: number;
  max: number;
  references: SpecReference[];
  notes: string[];
}

export type NumericFormat = FloatFormat | IntFormat;

/** Derived numerical characteristics of a floating-point format. */
export interface FloatCharacteristics {
  /** Precision p = fraction bits + 1 (implicit leading bit). */
  precision: number;
  /** Unbiased exponent of the smallest normal binade. */
  emin: number;
  /** Unbiased exponent of the largest finite binade. */
  emax: number;
  maxFinite: number;
  minNormal: number;
  minSubnormal: number;
  maxSubnormal: number;
  /** Machine epsilon: distance from 1 to the next larger representable value. */
  epsilon: number;
  hasInfinity: boolean;
  hasNaN: boolean;
  hasNegativeZero: boolean;
  /** Number of finite encodings, counting +0 and −0 separately. */
  finiteEncodings: number;
  /** Number of NaN encodings. */
  nanEncodings: number;
  /** log2(maxFinite / minSubnormal) (binades spanned incl. subnormals). */
  dynamicRangeBinades: number;
}
