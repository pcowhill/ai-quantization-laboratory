/**
 * Outlier detection and analysis.
 *
 * Methods (each uses a threshold multiplier k):
 * - `zscore`: |x − mean| > k·σ (population σ).
 * - `iqr`:    x < Q1 − k·IQR or x > Q3 + k·IQR (Tukey fences; k = 1.5 is classic).
 * - `mad`:    |x − median| > k·1.4826·MAD (robust z-score; 1.4826 makes MAD
 *             consistent with σ for normal data).
 * - `ratio`:  |x| > k·median(|x|) (magnitude relative to the typical element).
 */
import { percentileSorted, summarize } from '../metrics/stats';

export type OutlierMethod = 'zscore' | 'iqr' | 'mad' | 'ratio';

export const OUTLIER_METHODS: { id: OutlierMethod; name: string; defaultK: number; description: string }[] = [
  { id: 'zscore', name: 'z-score', defaultK: 3, description: '|x − mean| > k·σ' },
  { id: 'iqr', name: 'IQR (Tukey fences)', defaultK: 1.5, description: 'outside [Q1 − k·IQR, Q3 + k·IQR]' },
  { id: 'mad', name: 'Robust z (MAD)', defaultK: 3.5, description: '|x − median| > k·1.4826·MAD' },
  { id: 'ratio', name: 'Magnitude ratio', defaultK: 10, description: '|x| > k·median(|x|)' },
];

export interface OutlierReport {
  method: OutlierMethod;
  k: number;
  mask: Uint8Array;
  count: number;
  fraction: number;
  lowerFence: number;
  upperFence: number;
  /** max|x| / median|x| ("crest factor"); null if median|x| = 0. */
  maxToMedianRatio: number | null;
  /** Fraction of total energy Σx² carried by the outliers. */
  energyShare: number;
  kurtosis: number;
}

export function detectOutliers(data: ArrayLike<number>, method: OutlierMethod, k: number): OutlierReport {
  const n = data.length;
  const mask = new Uint8Array(n);
  const finite: number[] = [];
  for (let i = 0; i < n; i++) if (Number.isFinite(data[i]!)) finite.push(data[i]!);
  const sorted = Float64Array.from(finite).sort();
  const absSorted = Float64Array.from(finite, Math.abs).sort();
  const s = summarize(finite);
  let lower = -Infinity;
  let upper = Infinity;
  let test: (x: number) => boolean;
  switch (method) {
    case 'zscore':
      lower = s.mean - k * s.std;
      upper = s.mean + k * s.std;
      test = (x) => s.std > 0 && Math.abs(x - s.mean) > k * s.std;
      break;
    case 'iqr': {
      const q1 = percentileSorted(sorted, 25);
      const q3 = percentileSorted(sorted, 75);
      const iqr = q3 - q1;
      lower = q1 - k * iqr;
      upper = q3 + k * iqr;
      test = (x) => x < lower || x > upper;
      break;
    }
    case 'mad': {
      const med = percentileSorted(sorted, 50);
      const dev = Float64Array.from(finite, (x) => Math.abs(x - med)).sort();
      const mad = percentileSorted(dev, 50) * 1.4826;
      lower = med - k * mad;
      upper = med + k * mad;
      test = (x) => mad > 0 && Math.abs(x - med) > k * mad;
      break;
    }
    case 'ratio': {
      const medAbs = percentileSorted(absSorted, 50);
      upper = k * medAbs;
      lower = -upper;
      test = (x) => medAbs > 0 && Math.abs(x) > upper;
      break;
    }
  }
  let count = 0;
  let energy = 0;
  let outEnergy = 0;
  for (let i = 0; i < n; i++) {
    const x = data[i]!;
    if (!Number.isFinite(x)) continue;
    energy += x * x;
    if (test(x)) {
      mask[i] = 1;
      count++;
      outEnergy += x * x;
    }
  }
  const medAbs = absSorted.length ? percentileSorted(absSorted, 50) : NaN;
  return {
    method,
    k,
    mask,
    count,
    fraction: n > 0 ? count / n : 0,
    lowerFence: lower,
    upperFence: upper,
    maxToMedianRatio: medAbs > 0 ? s.absMax / medAbs : null,
    energyShare: energy > 0 ? outEnergy / energy : 0,
    kurtosis: s.kurtosis,
  };
}
