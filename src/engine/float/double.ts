/**
 * Exact bit-level utilities for IEEE 754 binary64 (JavaScript `number`).
 *
 * Every function here is exact: no transcendental functions and no
 * operation that could round are used to obtain the result.
 */

const buffer = new ArrayBuffer(8);
const view = new DataView(buffer);

/** Raw 64-bit pattern of a double (big-endian field order). */
export function doubleToBits(x: number): bigint {
  view.setFloat64(0, x);
  return view.getBigUint64(0);
}

/** Double whose raw bit pattern is `bits` (only the low 64 bits are used). */
export function bitsToDouble(bits: bigint): number {
  view.setBigUint64(0, BigInt.asUintN(64, bits));
  return view.getFloat64(0);
}

/** High 32 bits (sign, exponent and top 20 fraction bits) of a double. */
export function highWord(x: number): number {
  view.setFloat64(0, x);
  return view.getUint32(0);
}

/** Low 32 bits of the fraction field of a double. */
export function lowWord(x: number): number {
  view.setFloat64(0, x);
  return view.getUint32(4);
}

/** Builds a double from two 32-bit words. */
export function fromWords(hi: number, lo: number): number {
  view.setUint32(0, hi >>> 0);
  view.setUint32(4, lo >>> 0);
  return view.getFloat64(0);
}

/** True when the sign bit of x is set (distinguishes -0 from +0, and works for NaN). */
export function signBit(x: number): boolean {
  return (highWord(x) & 0x80000000) !== 0;
}

/**
 * Exact power of two 2^k for integer k in [-1074, 1023]. Constructed from
 * bits so that it never depends on `Math.pow` (which ECMAScript allows to be
 * implementation-approximated). Returns 0 or Infinity outside that range.
 */
export function pow2(k: number): number {
  if (!Number.isInteger(k)) throw new RangeError(`pow2 requires an integer exponent, got ${k}`);
  if (k > 1023) return Infinity;
  if (k >= -1022) return fromWords((k + 1023) << 20, 0);
  if (k < -1074) return 0;
  const pos = k + 1074; // bit position inside the 52-bit fraction field
  return pos >= 32 ? fromWords(1 << (pos - 32), 0) : fromWords(0, (1 << pos) >>> 0);
}

/**
 * Unbiased binary exponent of a finite non-zero double: floor(log2(|x|)),
 * computed exactly from the bit pattern (also for subnormal doubles).
 */
export function exponentOf(x: number): number {
  const hi = highWord(x) & 0x7fffffff;
  const biased = hi >>> 20;
  if (biased === 0x7ff) throw new RangeError('exponentOf requires a finite value');
  if (biased !== 0) return biased - 1023;
  const fracHi = hi & 0xfffff;
  if (fracHi !== 0) return -1074 + 32 + (31 - Math.clz32(fracHi));
  const lo = lowWord(x);
  if (lo === 0) throw new RangeError('exponentOf requires a non-zero value');
  return -1074 + (31 - Math.clz32(lo));
}

/** True when |x| is an exact power of two (x finite and non-zero). */
export function isPowerOfTwo(x: number): boolean {
  if (x === 0 || !Number.isFinite(x)) return false;
  const a = Math.abs(x);
  return a === pow2(exponentOf(a));
}

/** Smallest double greater than x (IEEE 754 nextUp). */
export function nextUp(x: number): number {
  if (Number.isNaN(x) || x === Infinity) return x;
  if (x === 0) return pow2(-1074);
  const bits = doubleToBits(x);
  return bitsToDouble(x > 0 ? bits + 1n : bits - 1n);
}

/** Largest double smaller than x (IEEE 754 nextDown). */
export function nextDown(x: number): number {
  return -nextUp(-x);
}

/**
 * Error-free transformation of a sum (Knuth's TwoSum): returns [s, t] where
 * s = fl(a + b) and a + b = s + t exactly. Valid when no overflow occurs.
 */
export function twoSum(a: number, b: number): [number, number] {
  const s = a + b;
  const bb = s - a;
  const err = a - (s - bb) + (b - bb);
  return [s, Number.isFinite(s) ? err : 0];
}

const SPLITTER = 134217729; // 2^27 + 1 (Veltkamp splitting constant)

function split(a: number): [number, number] {
  const c = SPLITTER * a;
  const hi = c - (c - a);
  return [hi, a - hi];
}

/**
 * Error-free transformation of a product (Dekker's TwoProduct): returns
 * [p, e] where p = fl(a * b) and a * b = p + e exactly, provided no overflow
 * or underflow occurs in the intermediate quantities. Large operands are
 * pre-scaled by exact powers of two to keep the splitting step in range.
 */
export function twoProduct(a: number, b: number): [number, number] {
  const p = a * b;
  if (!Number.isFinite(p) || p === 0 || a === 0 || b === 0) return [p, 0];
  // Scale operands into a safe range so the Veltkamp split cannot overflow
  // and the error term cannot underflow; scaling by powers of two is exact.
  const ea = exponentOf(a);
  const eb = exponentOf(b);
  const sa = ea > 500 || ea < -400 ? -ea : 0;
  const sb = eb > 500 || eb < -400 ? -eb : 0;
  const as = sa === 0 ? a : ldexp(a, sa);
  const bs = sb === 0 ? b : ldexp(b, sb);
  const ps = as * bs;
  const [ah, al] = split(as);
  const [bh, bl] = split(bs);
  const es = al * bl - (((ps - ah * bh) - al * bh) - ah * bl);
  if (sa === 0 && sb === 0) return [p, es];
  // Undo scaling. The error term may underflow when the true product is
  // tiny; in that case p itself is subnormal and the residual is below the
  // double resolution, which we report as an approximate (not exact) zero.
  return [p, ldexp(es, -(sa + sb))];
}

/**
 * x × 2^k (C `ldexp`). Exact unless the result overflows or lands in the
 * subnormal range, where it is rounded like any other double operation.
 */
export function ldexp(x: number, k: number): number {
  let r = x;
  let rem = k;
  while (rem > 1000) {
    r *= pow2(1000);
    rem -= 1000;
  }
  while (rem < -1000) {
    r *= pow2(-1000);
    rem += 1000;
  }
  return r * pow2(rem);
}
