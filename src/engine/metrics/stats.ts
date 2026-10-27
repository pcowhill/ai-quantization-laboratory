/**
 * Descriptive statistics over finite values. Non-finite entries (NaN, ±Inf)
 * are skipped by every function here; callers report them separately.
 */

export function finiteValues(xs: ArrayLike<number>): Float64Array {
  let count = 0;
  for (let i = 0; i < xs.length; i++) if (Number.isFinite(xs[i]!)) count++;
  const out = new Float64Array(count);
  let j = 0;
  for (let i = 0; i < xs.length; i++) {
    const v = xs[i]!;
    if (Number.isFinite(v)) out[j++] = v;
  }
  return out;
}

export function sortedCopy(xs: ArrayLike<number>): Float64Array {
  return finiteValues(xs).sort();
}

/**
 * Percentile with linear interpolation between closest ranks
 * (Hyndman & Fan type 7; NumPy's default `method="linear"`).
 * `sorted` must be ascending and finite; p in [0, 100].
 */
export function percentileSorted(sorted: ArrayLike<number>, p: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (!(p >= 0 && p <= 100)) throw new RangeError('Percentile must be within [0, 100]');
  const h = ((n - 1) * p) / 100;
  const lo = Math.floor(h);
  const hi = Math.min(n - 1, lo + 1);
  const a = sorted[lo]!;
  const b = sorted[hi]!;
  return a + (h - lo) * (b - a);
}

export function percentile(xs: ArrayLike<number>, p: number): number {
  return percentileSorted(sortedCopy(xs), p);
}

export interface Summary {
  count: number;
  nonFinite: number;
  min: number;
  max: number;
  absMax: number;
  mean: number;
  std: number;
  median: number;
  zeros: number;
  /** Excess kurtosis (0 for a normal distribution); NaN when undefined. */
  kurtosis: number;
}

export function summarize(xs: ArrayLike<number>): Summary {
  const f = finiteValues(xs);
  const n = f.length;
  const nonFinite = xs.length - n;
  if (n === 0) {
    return { count: 0, nonFinite, min: NaN, max: NaN, absMax: NaN, mean: NaN, std: NaN, median: NaN, zeros: 0, kurtosis: NaN };
  }
  let min = Infinity;
  let max = -Infinity;
  let zeros = 0;
  // Neumaier-compensated sum for the mean.
  let sum = 0;
  let comp = 0;
  for (let i = 0; i < n; i++) {
    const v = f[i]!;
    if (v < min) min = v;
    if (v > max) max = v;
    if (v === 0) zeros++;
    const t = sum + v;
    comp += Math.abs(sum) >= Math.abs(v) ? sum - t + v : v - t + sum;
    sum = t;
  }
  const mean = (sum + comp) / n;
  let m2 = 0;
  let m4 = 0;
  for (let i = 0; i < n; i++) {
    const d = f[i]! - mean;
    const d2 = d * d;
    m2 += d2;
    m4 += d2 * d2;
  }
  const variance = m2 / n;
  const kurtosis = variance > 0 ? m4 / n / (variance * variance) - 3 : NaN;
  const sorted = f.slice().sort();
  return {
    count: n,
    nonFinite,
    min,
    max,
    absMax: Math.max(Math.abs(min), Math.abs(max)),
    mean,
    std: Math.sqrt(variance),
    median: percentileSorted(sorted, 50),
    zeros,
    kurtosis,
  };
}

export function absMax(xs: ArrayLike<number>): number {
  let m = 0;
  for (let i = 0; i < xs.length; i++) {
    const v = Math.abs(xs[i]!);
    if (v > m && Number.isFinite(v)) m = v;
  }
  return m;
}
