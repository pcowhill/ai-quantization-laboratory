/**
 * Visualization data preparation (pure functions): histograms, empirical
 * CDFs and deterministic down-sampling. Tested so that charts faithfully
 * reflect the numerical results.
 */

export interface Histogram {
  lo: number;
  hi: number;
  width: number;
  counts: number[];
  /** Values outside [lo, hi] or non-finite (not counted in bins). */
  excluded: number;
}

/**
 * Fixed-width histogram over [lo, hi] with `bins` bins. Bin k covers
 * [lo + k·w, lo + (k+1)·w); the last bin also includes hi.
 */
export function histogram(values: ArrayLike<number>, lo: number, hi: number, bins: number): Histogram {
  const counts = new Array<number>(bins).fill(0);
  let excluded = 0;
  if (!(hi > lo)) {
    // Degenerate range: everything finite lands in one bin centred on lo.
    for (let i = 0; i < values.length; i++) {
      const v = values[i]!;
      if (Number.isFinite(v) && v === lo) counts[0]!++;
      else excluded++;
    }
    return { lo, hi: lo, width: 0, counts, excluded };
  }
  const w = (hi - lo) / bins;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (!Number.isFinite(v) || v < lo || v > hi) {
      excluded++;
      continue;
    }
    let k = Math.floor((v - lo) / w);
    if (k >= bins) k = bins - 1;
    counts[k]!++;
  }
  return { lo, hi, width: w, counts, excluded };
}

/** Range [min, max] over the finite values of several arrays (null if none). */
export function finiteRange(...arrays: ArrayLike<number>[]): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const a of arrays)
    for (let i = 0; i < a.length; i++) {
      const v = a[i]!;
      if (!Number.isFinite(v)) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  return lo <= hi ? [lo, hi] : null;
}

/** Counts of each distinct value (e.g. integer codes), sorted by value. */
export function valueCounts(values: ArrayLike<number>): { value: number; count: number }[] {
  const m = new Map<number, number>();
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    const key = Object.is(v, -0) ? 0 : v;
    m.set(key, (m.get(key) ?? 0) + 1);
  }
  return [...m.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => a.value - b.value);
}

/**
 * Empirical CDF of finite values evaluated at up to `points` evenly spaced
 * ranks: returns [value, fraction ≤ value] pairs.
 */
export function empiricalCdf(values: ArrayLike<number>, points = 200): [number, number][] {
  const f: number[] = [];
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i]!)) f.push(values[i]!);
  f.sort((a, b) => a - b);
  const n = f.length;
  if (n === 0) return [];
  const out: [number, number][] = [];
  const step = Math.max(1, Math.floor(n / points));
  for (let i = 0; i < n; i += step) out.push([f[i]!, (i + 1) / n]);
  if (out[out.length - 1]![1] !== 1) out.push([f[n - 1]!, 1]);
  return out;
}

/**
 * Deterministic subsample of indices: every k-th element so that at most
 * `max` indices remain, plus all indices in `always` (selection, outliers).
 */
export function sampleIndices(n: number, max: number, always: Iterable<number> = []): { indices: number[]; stride: number } {
  const stride = Math.max(1, Math.ceil(n / max));
  const set = new Set<number>();
  for (let i = 0; i < n; i += stride) set.add(i);
  for (const i of always) if (i >= 0 && i < n) set.add(i);
  return { indices: [...set].sort((a, b) => a - b), stride };
}
