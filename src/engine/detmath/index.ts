/**
 * Deterministic elementary functions.
 *
 * ECMAScript lets engines approximate Math.exp, Math.log, Math.tanh, etc.
 * ("implementation-approximated"), so results can differ in the last bits
 * between browsers. Experiments must replay bit-identically, so every
 * transcendental function used by data generators and neural-network
 * activations is implemented here with only IEEE 754 basic operations
 * (+, −, ×, ÷, sqrt), which JavaScript evaluates with correct rounding.
 *
 * `exp` and `log` are line-by-line ports of FreeBSD/Sun fdlibm (e_exp.c,
 * e_log.c; Copyright (C) 1993 by Sun Microsystems, freely redistributable),
 * accurate to < 1 ulp.
 */
import { fromWords, highWord, lowWord } from '../float/double';

const ln2HI = 6.93147180369123816490e-1; // 0x3fe62e42 0xfee00000
const ln2LO = 1.90821492927058770002e-10; // 0x3dea39ef 0x35793c76
const invln2 = 1.44269504088896338700e0;
const P1 = 1.66666666666666019037e-1;
const P2 = -2.77777777770155933842e-3;
const P3 = 6.61375632143793436117e-5;
const P4 = -1.65339022054652515390e-6;
const P5 = 4.13813679705723846039e-8;
const O_THRESHOLD = 7.09782712893383973096e2;
const U_THRESHOLD = -7.45133219101941108420e2;
const TWOM1000 = 9.33263618503218878990e-302; // 2^-1000

/** e^x (fdlibm __ieee754_exp). */
export function exp(x: number): number {
  let hx = highWord(x);
  const xsb = (hx >>> 31) & 1;
  hx &= 0x7fffffff;
  if (hx >= 0x40862e42) {
    if (hx >= 0x7ff00000) {
      if (((hx & 0xfffff) | lowWord(x)) !== 0) return x + x; // NaN
      return xsb === 0 ? x : 0; // exp(±Inf) = {Inf, 0}
    }
    if (x > O_THRESHOLD) return Infinity;
    if (x < U_THRESHOLD) return 0;
  }
  let hi = 0;
  let lo = 0;
  let k = 0;
  if (hx > 0x3fd62e42) {
    if (hx < 0x3ff0a2b2) {
      hi = xsb === 0 ? x - ln2HI : x + ln2HI;
      lo = xsb === 0 ? ln2LO : -ln2LO;
      k = 1 - xsb - xsb;
    } else {
      k = Math.trunc(invln2 * x + (xsb === 0 ? 0.5 : -0.5));
      const t = k;
      hi = x - t * ln2HI;
      lo = t * ln2LO;
    }
    x = hi - lo;
  } else if (hx < 0x3e300000) {
    return 1 + x;
  } else {
    k = 0;
  }
  const t = x * x;
  const c = x - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  if (k === 0) return 1 - ((x * c) / (c - 2.0) - x);
  const y = 1 - (lo - (x * c) / (2.0 - c) - hi);
  const yhi = highWord(y);
  const ylo = lowWord(y);
  if (k >= -1021) return fromWords((yhi + (k << 20)) >>> 0, ylo);
  return fromWords((yhi + ((k + 1000) << 20)) >>> 0, ylo) * TWOM1000;
}

const two54 = 1.80143985094819840000e16;
const Lg1 = 6.666666666666735130e-1;
const Lg2 = 3.999999999940941908e-1;
const Lg3 = 2.857142874366239149e-1;
const Lg4 = 2.222219843214978396e-1;
const Lg5 = 1.818357216161805012e-1;
const Lg6 = 1.531383769920937332e-1;
const Lg7 = 1.479819860511658591e-1;

/** Natural logarithm (fdlibm __ieee754_log). */
export function log(x: number): number {
  let hx = highWord(x) | 0; // signed
  const lx = lowWord(x);
  let k = 0;
  if (hx < 0x00100000) {
    if (((hx & 0x7fffffff) | lx) === 0) return -Infinity;
    if (hx < 0) return NaN;
    k -= 54;
    x *= two54;
    hx = highWord(x) | 0;
  }
  if (hx >= 0x7ff00000) return x + x;
  k += (hx >> 20) - 1023;
  hx &= 0x000fffff;
  let i = (hx + 0x95f64) & 0x100000;
  x = fromWords(hx | (i ^ 0x3ff00000), lowWord(x));
  k += i >> 20;
  const f = x - 1.0;
  if ((0x000fffff & (2 + hx)) < 3) {
    if (f === 0) {
      if (k === 0) return 0;
      return k * ln2HI + k * ln2LO;
    }
    const R = f * f * (0.5 - 0.33333333333333333 * f);
    if (k === 0) return f - R;
    return k * ln2HI - (R - k * ln2LO - f);
  }
  const s = f / (2.0 + f);
  const dk = k;
  const z = s * s;
  i = hx - 0x6147a;
  const w = z * z;
  const j = 0x6b851 - hx;
  const t1 = w * (Lg2 + w * (Lg4 + w * Lg6));
  const t2 = z * (Lg1 + w * (Lg3 + w * (Lg5 + w * Lg7)));
  i |= j;
  const R = t2 + t1;
  if (i > 0) {
    const hfsq = 0.5 * f * f;
    if (k === 0) return f - (hfsq - s * (hfsq + R));
    return dk * ln2HI - (hfsq - (s * (hfsq + R) + dk * ln2LO) - f);
  }
  if (k === 0) return f - s * (f - R);
  return dk * ln2HI - (s * (f - R) - dk * ln2LO - f);
}

/**
 * e^x − 1, accurate near zero. Uses a Taylor series for |x| < 0.5
 * (terms until they no longer change the sum) and exp(x) − 1 elsewhere.
 */
export function expm1(x: number): number {
  if (Number.isNaN(x)) return x;
  if (Math.abs(x) >= 0.5) return exp(x) - 1;
  let term = x;
  let sum = x;
  for (let n = 2; n < 40; n++) {
    term = (term * x) / n;
    const next = sum + term;
    if (next === sum) break;
    sum = next;
  }
  return sum;
}

/** Hyperbolic tangent via expm1: tanh(x) = expm1(2x) / (expm1(2x) + 2). */
export function tanh(x: number): number {
  if (Number.isNaN(x)) return x;
  if (x === 0) return x; // preserves −0
  const a = Math.abs(x);
  if (a > 22) return x > 0 ? 1 : -1;
  const em = expm1(2 * a);
  const r = em / (em + 2);
  return x > 0 ? r : -r;
}

/** Logistic sigmoid 1 / (1 + e^−x). */
export function sigmoid(x: number): number {
  if (x >= 0) return 1 / (1 + exp(-x));
  const e = exp(x);
  return e / (1 + e);
}

const SQRT_2_OVER_PI = 0.7978845608028654; // sqrt(2/π)

/** GELU, tanh approximation: 0.5·x·(1 + tanh(√(2/π)·(x + 0.044715·x³))). */
export function geluTanh(x: number): number {
  return 0.5 * x * (1 + tanh(SQRT_2_OVER_PI * (x + 0.044715 * x * x * x)));
}

/** SiLU / swish: x · sigmoid(x). */
export function silu(x: number): number {
  return x * sigmoid(x);
}

/** Numerically stable softmax (subtracts the maximum first). */
export function softmax(xs: ArrayLike<number>): Float64Array {
  const out = new Float64Array(xs.length);
  let max = -Infinity;
  for (let i = 0; i < xs.length; i++) max = Math.max(max, xs[i]!);
  let sum = 0;
  for (let i = 0; i < xs.length; i++) {
    out[i] = exp(xs[i]! - max);
    sum += out[i]!;
  }
  for (let i = 0; i < xs.length; i++) out[i]! /= sum;
  return out;
}

/** log2 via log (deterministic). */
export function log2(x: number): number {
  return log(x) / Math.LN2;
}

/** log10 via log (deterministic). */
export function log10(x: number): number {
  return log(x) / Math.LN10;
}
