import { log10 } from '../detmath';
import { exponentOf, pow2 } from '../float/double';

/**
 * Numerical error metrics between a reference tensor x and an approximation x̂.
 *
 * Conventions (documented in docs/NUMERICS.md):
 * - Pairs where x or x̂ is NaN/±Inf are excluded from every aggregate and
 *   counted in `nonFinitePairs`.
 * - Relative error |x − x̂| / |x| is undefined when x = 0. Such elements are
 *   excluded from the relative-error aggregates and counted in
 *   `relativeUndefined`, except when x̂ = 0 too, which is exact (relative error 0).
 * - Cosine similarity is undefined (null) when either vector has zero norm.
 * - SNR (dB) = 10·log10(Σx² / Σ(x − x̂)²): +Infinity when the error is exactly
 *   zero, null when the signal energy is zero.
 * - Sums of squares are accumulated after dividing by an exact power of two
 *   close to the largest magnitude, so cosine similarity and SNR neither
 *   underflow for tiny (even subnormal) values nor overflow for huge ones.
 */

export interface ErrorMetrics {
  count: number;
  /** Pairs included in the aggregates (both finite). */
  finitePairs: number;
  nonFinitePairs: number;
  mae: number;
  mse: number;
  rmse: number;
  maxAbs: number;
  maxAbsIndex: number;
  meanRelative: number | null;
  maxRelative: number | null;
  relativeUndefined: number;
  cosine: number | null;
  snrDb: number | null;
  /** Fraction of all elements whose approximation is exactly zero. */
  zeroRate: number;
  /** Fraction of non-zero reference elements whose approximation is zero. */
  zeroCollapseRate: number | null;
  /** Fraction of elements flagged as saturated/clipped (when flags are supplied). */
  saturationRate: number | null;
  /** Mean signed error (bias), mean of x̂ − x. */
  bias: number;
}

/** Hypot-style accumulation-free square root of a sum. */
function safeSqrt(x: number): number {
  return Math.sqrt(Math.max(0, x));
}

export function computeErrorMetrics(
  ref: ArrayLike<number>,
  approx: ArrayLike<number>,
  saturatedMask?: (i: number) => boolean,
): ErrorMetrics {
  if (ref.length !== approx.length) throw new RangeError('Reference and approximation must have equal length');
  const n = ref.length;
  // Exact power-of-two scale for the squared sums.
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const x = ref[i]!;
    const y = approx[i]!;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    peak = Math.max(peak, Math.abs(x), Math.abs(y));
  }
  const s = peak > 0 ? pow2(exponentOf(peak)) : 1;
  let finitePairs = 0;
  let sumAbs = 0;
  let sumSq = 0;
  let sumSigned = 0;
  let maxAbs = 0;
  let maxAbsIndex = -1;
  let sumRel = 0;
  let relCount = 0;
  let maxRel = 0;
  let relUndefined = 0;
  let dot = 0;
  let nx = 0;
  let ny = 0;
  let zeros = 0;
  let nonzeroRef = 0;
  let collapsed = 0;
  let saturated = 0;
  for (let i = 0; i < n; i++) {
    const x = ref[i]!;
    const y = approx[i]!;
    if (y === 0) zeros++;
    if (saturatedMask && saturatedMask(i)) saturated++;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    finitePairs++;
    if (x !== 0) {
      nonzeroRef++;
      if (y === 0) collapsed++;
    }
    const d = y - x;
    const ad = Math.abs(d);
    const ds = y / s - x / s;
    sumAbs += ad;
    sumSq += ds * ds;
    sumSigned += d;
    if (ad > maxAbs || maxAbsIndex < 0) {
      maxAbs = ad;
      maxAbsIndex = i;
    }
    if (x !== 0) {
      const r = ad / Math.abs(x);
      sumRel += r;
      relCount++;
      if (r > maxRel) maxRel = r;
    } else if (y === 0) {
      relCount++;
    } else {
      relUndefined++;
    }
    const xs = x / s;
    const ys = y / s;
    dot += xs * ys;
    nx += xs * xs;
    ny += ys * ys;
  }
  // sumSq is in units of s²; undo the scaling (may legitimately overflow to Infinity).
  const mse = finitePairs > 0 ? ((sumSq / finitePairs) * s) * s : NaN;
  const cosine = nx > 0 && ny > 0 ? dot / (safeSqrt(nx) * safeSqrt(ny)) : null;
  let snrDb: number | null;
  if (nx === 0) snrDb = null;
  else if (sumSq === 0) snrDb = Infinity;
  else snrDb = 10 * log10(nx / sumSq);
  return {
    count: n,
    finitePairs,
    nonFinitePairs: n - finitePairs,
    mae: finitePairs > 0 ? sumAbs / finitePairs : NaN,
    mse,
    rmse: safeSqrt(mse),
    maxAbs: finitePairs > 0 ? maxAbs : NaN,
    maxAbsIndex,
    meanRelative: relCount > 0 ? sumRel / relCount : null,
    maxRelative: relCount > 0 ? maxRel : null,
    relativeUndefined: relUndefined,
    cosine: cosine === null ? null : Math.max(-1, Math.min(1, cosine)),
    snrDb,
    zeroRate: n > 0 ? zeros / n : 0,
    zeroCollapseRate: nonzeroRef > 0 ? collapsed / nonzeroRef : null,
    saturationRate: saturatedMask && n > 0 ? saturated / n : null,
    bias: finitePairs > 0 ? sumSigned / finitePairs : NaN,
  };
}

/** Per-element absolute error (NaN where either value is non-finite). */
export function absoluteErrors(ref: ArrayLike<number>, approx: ArrayLike<number>): Float64Array {
  const out = new Float64Array(ref.length);
  for (let i = 0; i < ref.length; i++) {
    const x = ref[i]!;
    const y = approx[i]!;
    out[i] = Number.isFinite(x) && Number.isFinite(y) ? Math.abs(y - x) : NaN;
  }
  return out;
}

/** Relative error of a single pair following the documented convention (null = undefined). */
export function relativeError(x: number, y: number): number | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (x === 0) return y === 0 ? 0 : null;
  return Math.abs(y - x) / Math.abs(x);
}
