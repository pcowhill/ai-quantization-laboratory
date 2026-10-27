/**
 * Correct rounding of real values to any supported binary floating-point
 * format.
 *
 * Algorithm (exact for every input):
 *   1. Determine the binade exponent e = floor(log2|v|) exactly from the bits.
 *   2. The spacing of representable values ("quantum") in that binade is
 *      2^qe with qe = max(e, emin) − fractionBits. Below emin the quantum is
 *      fixed, which is exactly what produces subnormal numbers.
 *   3. Write |v| / 2^qe = n + r with integer n and exact remainder r ∈ [0,1).
 *      Division by a power of two is exact in binary64, so for doubles n and
 *      r are obtained without error.
 *   4. The rounding mode decides between n and n + 1 using only whether r is
 *      0, below ½, exactly ½ or above ½ (stochastic rounding uses r itself).
 *   5. The result (n or n+1)·2^qe is checked against the largest finite value
 *      and the format's overflow rules (IEEE 754 §7.4 or OCP OFP8 Table 3).
 *
 * An optional `lo` term lets callers round an exact sum `x + lo` (from
 * TwoSum/TwoProduct). `lo` acts as a sticky bit, so directed rounding of
 * simulated arithmetic is exact too (no double-rounding error).
 */
import { characteristics } from '../formats/registry';
import type { FloatFormat, OverflowMode } from '../formats/types';
import { Frac, roundsUp, type RoundingMode, type UniformSource } from '../rounding';
import { exponentOf, isPowerOfTwo, pow2, signBit } from './double';

/** Status flags describing what happened during a conversion (bitmask). */
export const RoundFlag = {
  /** Result differs from the exact input. */
  Inexact: 1,
  /** Rounded magnitude exceeded the largest finite value. */
  Overflow: 2,
  /** Result was clamped to ±max finite (saturating conversion). */
  Saturated: 4,
  /** Result is subnormal or zero and inexact (tiny after rounding). */
  Underflow: 8,
  /** Subnormal result replaced by zero because flush-to-zero is enabled. */
  Flushed: 16,
  /** Result is a (non-zero) subnormal number. */
  Subnormal: 32,
  /** A non-zero input produced a zero result. */
  ZeroFromNonzero: 64,
  /** Input cannot be represented at all (NaN into a format without NaN). */
  Invalid: 128,
  /** Result is NaN. */
  NaNResult: 256,
  /** Result is ±Inf. */
  InfResult: 512,
} as const;

export interface RoundOptions {
  mode: RoundingMode;
  /** Overflow policy; defaults to the format's `defaultOverflow`. */
  overflow?: OverflowMode;
  /** Flush subnormal results to (signed) zero. */
  ftz?: boolean;
  /** Required for stochastic rounding. */
  rng?: UniformSource;
}

/** Flags of the most recent rounding call (avoids allocating per element). */
export const lastRound = { flags: 0 };

/**
 * Shared final step: given the exact decomposition of a non-zero magnitude,
 * apply the rounding decision, overflow rules, underflow/FTZ handling and sign.
 * @param e binade exponent of the exact magnitude (used for overflow detection)
 * @param qe quantum exponent
 */
export function finishRounding(
  fmt: FloatFormat,
  negative: boolean,
  n: number,
  frac: Frac,
  fracValue: number,
  e: number,
  qe: number,
  opts: RoundOptions,
): number {
  const c = characteristics(fmt);
  let flags = frac === Frac.Zero ? 0 : RoundFlag.Inexact;
  const up = roundsUp(opts.mode, n, frac, negative, fracValue, opts.rng);
  const m = up ? n + 1 : n;
  const r = e > c.emax ? Infinity : m * pow2(qe);
  if (r > c.maxFinite) {
    lastRound.flags = flags | RoundFlag.Overflow | RoundFlag.Inexact;
    return overflowResult(fmt, negative, opts);
  }
  let mag = r;
  if (mag < c.minNormal) {
    if (mag === 0) {
      flags |= RoundFlag.ZeroFromNonzero | RoundFlag.Underflow;
    } else {
      if (flags & RoundFlag.Inexact) flags |= RoundFlag.Underflow;
      if (opts.ftz) {
        mag = 0;
        flags |= RoundFlag.Flushed | RoundFlag.ZeroFromNonzero | RoundFlag.Inexact;
      } else {
        flags |= RoundFlag.Subnormal;
      }
    }
  }
  lastRound.flags = flags;
  if (mag === 0) return negative && c.hasNegativeZero ? -0 : 0;
  return negative ? -mag : mag;
}

function overflowResult(fmt: FloatFormat, negative: boolean, opts: RoundOptions): number {
  const c = characteristics(fmt);
  const mode = opts.overflow ?? fmt.defaultOverflow;
  const max = negative ? -c.maxFinite : c.maxFinite;
  const inf = negative ? -Infinity : Infinity;
  if (mode === 'saturate' || fmt.overflowSemantics === 'saturate-only') {
    lastRound.flags |= RoundFlag.Saturated;
    return max;
  }
  switch (fmt.overflowSemantics) {
    case 'inf':
      lastRound.flags |= RoundFlag.InfResult;
      return inf;
    case 'nan':
      lastRound.flags |= RoundFlag.NaNResult;
      return NaN;
    case 'ieee754': {
      // IEEE 754-2019 §7.4: directed modes may deliver ±max instead of ±Inf.
      let toInf: boolean;
      switch (opts.mode) {
        case 'toward-zero':
          toInf = false;
          break;
        case 'toward-positive':
          toInf = !negative;
          break;
        case 'toward-negative':
          toInf = negative;
          break;
        default:
          toInf = true;
      }
      if (toInf) {
        lastRound.flags |= RoundFlag.InfResult;
        return inf;
      }
      lastRound.flags |= RoundFlag.Saturated;
      return max;
    }
  }
}

/** Result for NaN inputs (and the spec-mandated handling of formats without NaN). */
export function nanInputResult(fmt: FloatFormat): number {
  if (characteristics(fmt).hasNaN) {
    lastRound.flags = RoundFlag.NaNResult;
    return NaN;
  }
  // OCP MX §5.3.3: conversion of NaN to FP4 is implementation-defined. We map
  // it to +0 and raise the Invalid flag so callers can report it.
  lastRound.flags = RoundFlag.Invalid;
  return 0;
}

/** Result for ±Inf inputs according to the overflow policy (OCP OFP8 Table 3 / IEEE 754). */
export function infInputResult(fmt: FloatFormat, negative: boolean, opts: RoundOptions): number {
  const c = characteristics(fmt);
  const mode = opts.overflow ?? fmt.defaultOverflow;
  if (mode === 'saturate' || !c.hasInfinity) {
    if (mode === 'nonsaturate' && fmt.overflowSemantics === 'nan') {
      lastRound.flags = RoundFlag.NaNResult;
      return NaN;
    }
    lastRound.flags = RoundFlag.Saturated | RoundFlag.Inexact;
    return negative ? -c.maxFinite : c.maxFinite;
  }
  lastRound.flags = RoundFlag.InfResult;
  return negative ? -Infinity : Infinity;
}

/**
 * Rounds the exact real value `x + lo` to `fmt`. `lo` must satisfy
 * |lo| ≤ ½ ulp(x) (as produced by TwoSum/TwoProduct); pass 0 for a plain
 * double. Returns the rounded value as a double (every value of every
 * supported format is exactly representable as a double). Flags are written
 * to `lastRound.flags`.
 */
export function roundFloat(fmt: FloatFormat, x: number, opts: RoundOptions, lo = 0): number {
  if (Number.isNaN(x)) return nanInputResult(fmt);
  const negative = signBit(x);
  if (!Number.isFinite(x)) return infInputResult(fmt, negative, opts);
  if (x === 0) {
    if (lo !== 0) return roundFloat(fmt, lo, opts, 0);
    lastRound.flags = 0;
    return negative && characteristics(fmt).hasNegativeZero ? -0 : 0;
  }
  const c = characteristics(fmt);
  const a = Math.abs(x);
  const t = negative ? -lo : lo; // tail on the magnitude scale
  let e = exponentOf(a);
  // A power of two minus a tiny amount lies in the binade below.
  if (t < 0 && e > c.emin && isPowerOfTwo(a)) e -= 1;
  const qe = Math.max(e, c.emin) - fmt.fractionBits;
  const q = pow2(qe);
  const s = a / q; // exact: division by a power of two, result ≥ 2^-53·…, never subnormal here
  let n = Math.floor(s);
  const f = s - n; // exact
  let frac: Frac;
  let fracValue = f;
  if (f === 0) {
    if (t === 0) frac = Frac.Zero;
    else if (t > 0) {
      frac = Frac.BelowHalf;
      fracValue = t / q;
    } else {
      n -= 1;
      frac = Frac.AboveHalf;
      fracValue = 1 + t / q;
    }
  } else if (f === 0.5) {
    frac = t === 0 ? Frac.Half : t > 0 ? Frac.AboveHalf : Frac.BelowHalf;
    fracValue = f + t / q;
  } else {
    frac = f < 0.5 ? Frac.BelowHalf : Frac.AboveHalf;
    if (t !== 0) fracValue = f + t / q;
  }
  return finishRounding(fmt, negative, n, frac, fracValue, e, qe, opts);
}

/** Convenience: round a double with round-to-nearest-even and default overflow. */
export function toFormat(fmt: FloatFormat, x: number): number {
  return roundFloat(fmt, x, { mode: 'nearest-even' });
}
