/**
 * Exact arbitrary-precision rounding of rational numbers with BigInt.
 *
 * This path is used when the user types a decimal string (so "0.1" is
 * rounded directly to e.g. FP16 without first being rounded to FP64, which
 * would risk double rounding) and as an independent cross-check of the fast
 * double-based path in `round.ts` in the test-suite.
 */
import { characteristics, FLOAT_FORMATS } from '../formats/registry';
import type { FloatFormat } from '../formats/types';
import { Frac, roundsUp, type RoundingMode, type UniformSource } from '../rounding';
import { doubleToBits } from './double';
import {
  finishRounding,
  infInputResult,
  lastRound,
  nanInputResult,
  type RoundOptions,
} from './round';

export type ParsedNumber =
  | { kind: 'nan' }
  | { kind: 'inf'; negative: boolean }
  | { kind: 'finite'; negative: boolean; num: bigint; den: bigint };

export class NumberParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NumberParseError';
  }
}

const MAX_DIGITS = 2000;
const MAX_EXP10 = 6000;

function pow10(k: number): bigint {
  return 10n ** BigInt(k);
}

/** Decimal literal as mant · 10^exp10 (unclamped). */
function parseDecimal(s: string): { mant: bigint; exp10: number } {
  const m = /^(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(s);
  if (!m || (m[1] === '' && (m[2] === undefined || m[2] === ''))) {
    throw new NumberParseError(`"${s}" is not a valid decimal number`);
  }
  const intPart = m[1] ?? '';
  const fracPart = m[2] ?? '';
  const digits = (intPart + fracPart).replace(/^0+/, '') || '0';
  if (digits.length > MAX_DIGITS) throw new NumberParseError(`Too many digits (max ${MAX_DIGITS})`);
  const e = m[3] ? parseInt(m[3], 10) : 0;
  if (!Number.isFinite(e) || Math.abs(e) > 1e9) throw new NumberParseError('Exponent out of range');
  return { mant: BigInt(digits), exp10: e - fracPart.length };
}

/**
 * Builds the rational (mant/den)·10^exp10. Absurd exponents are clamped:
 * beyond ±6000 (plus the digit count) every supported format has already
 * overflowed or underflowed, so the rounded result is unchanged.
 */
function scaledRational(mant: bigint, den: bigint, exp10: number): { num: bigint; den: bigint } {
  const limit = MAX_EXP10 + 2 * MAX_DIGITS;
  const e = Math.max(-limit, Math.min(MAX_EXP10, exp10));
  return e >= 0 ? { num: mant * pow10(e), den } : { num: mant, den: den * pow10(-e) };
}

function parseHexFloat(s: string): { num: bigint; den: bigint } {
  const m = /^0[xX]([0-9a-fA-F]*)(?:\.([0-9a-fA-F]*))?(?:[pP]([+-]?\d+))?$/.exec(s);
  if (!m || (m[1] === '' && (m[2] === undefined || m[2] === ''))) {
    throw new NumberParseError(`"${s}" is not a valid hexadecimal floating-point literal`);
  }
  const intPart = m[1] ?? '';
  const fracPart = m[2] ?? '';
  const mant = BigInt('0x' + ((intPart + fracPart) || '0'));
  let exp2 = (m[3] ? parseInt(m[3], 10) : 0) - 4 * fracPart.length;
  exp2 = Math.max(-25000, Math.min(25000, exp2));
  return exp2 >= 0 ? { num: mant << BigInt(exp2), den: 1n } : { num: mant, den: 1n << BigInt(-exp2) };
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
}

/**
 * Parses a number written as a decimal ("-1.25e-3"), a hexadecimal float
 * ("0x1.8p+1"), a fraction ("1/3", "-2.5/7"), "inf"/"infinity", or "nan".
 * Returns an exact rational; no rounding happens here.
 */
export function parseExact(input: string): ParsedNumber {
  let s = input.trim().replace(/[\s_]/g, '').replace(/−/g, '-').replace(/∞/g, 'inf');
  if (s === '') throw new NumberParseError('Empty input');
  let negative = false;
  if (s[0] === '+' || s[0] === '-') {
    negative = s[0] === '-';
    s = s.slice(1);
  }
  const lower = s.toLowerCase();
  if (lower === 'nan') return { kind: 'nan' };
  if (lower === 'inf' || lower === 'infinity') return { kind: 'inf', negative };
  let num: bigint;
  let den: bigint;
  if (s.includes('/')) {
    const parts = s.split('/');
    if (parts.length !== 2) throw new NumberParseError('A fraction must have the form a/b');
    const [p, q] = parts as [string, string];
    const a = parseDecimal(p);
    let bNeg = false;
    let qs = q;
    if (qs.startsWith('-') || qs.startsWith('+')) {
      bNeg = qs[0] === '-';
      qs = qs.slice(1);
    }
    const b = parseDecimal(qs);
    if (b.mant === 0n) throw new NumberParseError('Division by zero in fraction');
    ({ num, den } = scaledRational(a.mant, b.mant, a.exp10 - b.exp10));
    if (bNeg) negative = !negative;
  } else if (/^0[xX]/.test(s)) {
    ({ num, den } = parseHexFloat(s));
  } else {
    const d = parseDecimal(s);
    ({ num, den } = scaledRational(d.mant, 1n, d.exp10));
  }
  const g = gcd(num, den);
  if (g > 1n) {
    num /= g;
    den /= g;
  }
  return { kind: 'finite', negative, num, den };
}

/** Exact rational value of a finite double. */
export function doubleToRational(x: number): ParsedNumber {
  if (Number.isNaN(x)) return { kind: 'nan' };
  const bits = doubleToBits(x);
  const negative = (bits >> 63n) === 1n;
  if (!Number.isFinite(x)) return { kind: 'inf', negative };
  const biased = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);
  const mant = biased === 0 ? frac : frac | (1n << 52n);
  const exp = (biased === 0 ? 1 : biased) - 1075;
  if (mant === 0n) return { kind: 'finite', negative, num: 0n, den: 1n };
  let num: bigint;
  let den: bigint;
  if (exp >= 0) {
    num = mant << BigInt(exp);
    den = 1n;
  } else {
    num = mant;
    den = 1n << BigInt(-exp);
  }
  const g = gcd(num, den);
  return { kind: 'finite', negative, num: num / g, den: den / g };
}

export function bitLength(v: bigint): number {
  return v === 0n ? 0 : v.toString(2).length;
}

/** floor(log2(num/den)) for positive num, den. */
export function floorLog2(num: bigint, den: bigint): number {
  const d = bitLength(num) - bitLength(den);
  const ge = d >= 0 ? num >= den << BigInt(d) : num << BigInt(-d) >= den;
  return ge ? d : d - 1;
}

/** Rounds an exact parsed number to `fmt` (flags in `lastRound.flags`). */
export function roundParsed(fmt: FloatFormat, p: ParsedNumber, opts: RoundOptions): number {
  if (p.kind === 'nan') return nanInputResult(fmt);
  if (p.kind === 'inf') return infInputResult(fmt, p.negative, opts);
  const c = characteristics(fmt);
  if (p.num === 0n) {
    lastRound.flags = 0;
    return p.negative && c.hasNegativeZero ? -0 : 0;
  }
  const a = p.num < 0n ? -p.num : p.num;
  const den = p.den;
  const e = floorLog2(a, den);
  const qe = Math.max(e, c.emin) - fmt.fractionBits;
  let n: bigint;
  let rem: bigint;
  let D: bigint;
  if (e > c.emax + 1) {
    // Certain overflow; avoid huge shifts. Any n ≥ 2^p reproduces the decision.
    return finishRounding(fmt, p.negative, 2 ** (fmt.fractionBits + 1), Frac.Zero, 0, e, qe, opts);
  }
  if (qe >= 0) {
    D = den << BigInt(qe);
    n = a / D;
    rem = a % D;
  } else {
    const N = a << BigInt(-qe);
    D = den;
    n = N / D;
    rem = N % D;
  }
  let frac: Frac;
  const twice = 2n * rem;
  if (rem === 0n) frac = Frac.Zero;
  else if (twice < D) frac = Frac.BelowHalf;
  else if (twice === D) frac = Frac.Half;
  else frac = Frac.AboveHalf;
  const fracValue = Number((rem << 53n) / D) / 2 ** 53;
  return finishRounding(fmt, p.negative, Number(n), frac, fracValue, e, qe, opts);
}

/** Parses and rounds a string in one step. */
export function roundString(fmt: FloatFormat, input: string, opts: RoundOptions): number {
  return roundParsed(fmt, parseExact(input), opts);
}

/**
 * Exact decimal expansion of a double. Every finite binary floating-point
 * value has a terminating decimal expansion, e.g.
 * 0.1 (as FP64) → "0.1000000000000000055511151231257827021181583404541015625".
 */
export function exactDecimal(x: number): string {
  if (Number.isNaN(x)) return 'NaN';
  if (x === Infinity) return 'Infinity';
  if (x === -Infinity) return '-Infinity';
  const r = doubleToRational(x);
  if (r.kind !== 'finite') return String(x);
  const sign = r.negative ? '-' : '';
  if (r.num === 0n) return sign + '0';
  // den is a power of two 2^k; multiply by 5^k to get a power of ten.
  const k = bitLength(r.den) - 1;
  const scaled = r.num * 5n ** BigInt(k);
  if (k === 0) return sign + scaled.toString();
  const digits = scaled.toString().padStart(k + 1, '0');
  const intPart = digits.slice(0, digits.length - k);
  const fracPart = digits.slice(digits.length - k).replace(/0+$/, '');
  return sign + intPart + (fracPart ? '.' + fracPart : '');
}

/**
 * Shortest decimal string (in significant digits) that rounds back to
 * exactly `x` in format `fmt` under round-to-nearest-even. `x` must be a
 * value of `fmt`.
 */
export function shortestDecimal(fmt: FloatFormat, x: number): string {
  if (Number.isNaN(x)) return 'NaN';
  if (!Number.isFinite(x)) return x > 0 ? 'Infinity' : '-Infinity';
  if (x === 0) return Object.is(x, -0) ? '-0' : '0';
  for (let digits = 1; digits <= 17; digits++) {
    const candidate = x.toPrecision(digits);
    const back = roundString(fmt, candidate, { mode: 'nearest-even', overflow: 'nonsaturate' });
    if (Object.is(back, x)) return normalizeDecimal(candidate);
  }
  return String(x);
}

/**
 * Formats a toPrecision() candidate like JavaScript's Number#toString
 * (plain notation for moderate exponents). Candidates have ≤ 17 significant
 * digits, so the nearest double prints with the same digits.
 */
function normalizeDecimal(s: string): string {
  return Number(s).toString();
}

// ---------------------------------------------------------------- exact helpers

const FP64_FMT = FLOAT_FORMATS.fp64;

/** Signed fraction num/den (den > 0) of a finite parsed number. */
export interface Fraction {
  num: bigint;
  den: bigint;
}

export function toFraction(p: ParsedNumber): Fraction | null {
  if (p.kind !== 'finite') return null;
  return { num: p.negative ? -p.num : p.num, den: p.den };
}

export function fractionSub(a: Fraction, b: Fraction): Fraction {
  return { num: a.num * b.den - b.num * a.den, den: a.den * b.den };
}

export function fractionAbs(a: Fraction): Fraction {
  return { num: a.num < 0n ? -a.num : a.num, den: a.den };
}

/** a / b, or null when b = 0. */
export function fractionDiv(a: Fraction, b: Fraction): Fraction | null {
  if (b.num === 0n) return null;
  const neg = b.num < 0n;
  return { num: neg ? -a.num * b.den : a.num * b.den, den: neg ? -b.num * a.den : b.num * a.den };
}

/** Rounds a fraction once to FP64 (nearest-even). */
export function fractionToNumber(a: Fraction): number {
  const negative = a.num < 0n;
  return roundParsed(FP64_FMT, { kind: 'finite', negative, num: negative ? -a.num : a.num, den: a.den }, { mode: 'nearest-even', overflow: 'nonsaturate' });
}

export function fractionFromNumber(x: number): Fraction | null {
  return toFraction(doubleToRational(x));
}

/**
 * Rounds an exact rational to an integer with the given mode (used for
 * integer quantization of typed values without an FP64 detour).
 */
export function roundFractionToInteger(a: Fraction, mode: RoundingMode, rng?: UniformSource): number {
  const negative = a.num < 0n;
  const mag = negative ? -a.num : a.num;
  const n = mag / a.den;
  const rem = mag % a.den;
  const twice = 2n * rem;
  const frac: Frac = rem === 0n ? Frac.Zero : twice < a.den ? Frac.BelowHalf : twice === a.den ? Frac.Half : Frac.AboveHalf;
  const fracValue = Number((rem << 53n) / a.den) / 2 ** 53;
  // n may exceed 2^53 for huge inputs; those always saturate later, so a capped value is fine.
  const nNum = n > 2n ** 53n ? 2 ** 53 : Number(n);
  const m = roundsUp(mode, nNum, frac, negative, fracValue, rng) ? nNum + 1 : nNum;
  return negative ? (m === 0 ? 0 : -m) : m;
}
