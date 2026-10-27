/**
 * Simulated reduced-precision arithmetic.
 *
 * Rules (applied exactly, see docs/NUMERICS.md):
 * - Each product a·b is computed exactly (TwoProduct) and rounded once to
 *   `productFormat` with the configured rounding mode.
 * - Each addition acc + p is computed exactly (TwoSum) and rounded once to
 *   `accumulatorFormat`.
 * - The summation order is explicit: sequential (left to right), pairwise
 *   (balanced binary tree), blocked (sequential inside blocks of `blockSize`,
 *   block results accumulated in `outerFormat`), or Kahan-compensated (every
 *   intermediate operation rounded to the accumulator format).
 * - The final value is rounded to `outputFormat`.
 *
 * This models a generic "round after every operation" machine. It does not
 * reproduce any specific GPU instruction (e.g. tensor-core FMA trees with
 * internal alignment/truncation behaviour), which is vendor-specific.
 */
import { twoProduct, twoSum } from '../float/double';
import { lastRound, roundFloat, RoundFlag, type RoundOptions } from '../float/round';
import { FLOAT_FORMATS } from '../formats/registry';
import type { FloatFormatId, OverflowMode } from '../formats/types';
import { Rng } from '../random/prng';
import type { RoundingMode } from '../rounding';
import { ExactSum } from './exact';

export type SumOrder = 'sequential' | 'pairwise' | 'blocked' | 'kahan';

export interface ArithConfig {
  productFormat: FloatFormatId;
  accumulatorFormat: FloatFormatId;
  outputFormat: FloatFormatId;
  rounding: RoundingMode;
  order: SumOrder;
  blockSize: number;
  outerFormat: FloatFormatId;
  overflow: OverflowMode;
  ftz: boolean;
  seed: number;
}

export const DEFAULT_ARITH_CONFIG: ArithConfig = {
  productFormat: 'fp32',
  accumulatorFormat: 'fp32',
  outputFormat: 'fp32',
  rounding: 'nearest-even',
  order: 'sequential',
  blockSize: 32,
  outerFormat: 'fp32',
  overflow: 'nonsaturate',
  ftz: false,
  seed: 1,
};

export const FP64_ARITH: ArithConfig = {
  ...DEFAULT_ARITH_CONFIG,
  productFormat: 'fp64',
  accumulatorFormat: 'fp64',
  outputFormat: 'fp64',
  outerFormat: 'fp64',
};

export function makeArithConfig(partial: Partial<ArithConfig> = {}): ArithConfig {
  return { ...DEFAULT_ARITH_CONFIG, ...partial };
}

export interface DotStep {
  index: number;
  a: number;
  b: number;
  /** a·b rounded to FP64 (exact when the operands are FP32-or-narrower). */
  productExact: number;
  /** a·b rounded to the product format. */
  product: number;
  accBefore: number;
  accAfter: number;
  /** Rounding error of this accumulation step: (accBefore + product) − accAfter. */
  stepError: number;
  /** Exact running sum of the exact products so far (rounded once to FP64). */
  exactRunning: number;
  flags: number;
}

export interface DotResult {
  value: number;
  /** Exact dot product of the given operands (rounded once to FP64). */
  exact: number;
  flags: number;
  steps: DotStep[] | null;
}

/** Arithmetic machine state shared by all operations of one evaluation. */
export class ArithMachine {
  readonly cfg: ArithConfig;
  private readonly rng: Rng | undefined;
  private readonly opts: RoundOptions;
  flags = 0;

  constructor(cfg: ArithConfig, rng?: Rng) {
    this.cfg = cfg;
    this.rng = cfg.rounding === 'stochastic' ? (rng ?? new Rng(cfg.seed)) : undefined;
    const r = this.rng;
    this.opts = { mode: cfg.rounding, overflow: cfg.overflow, ftz: cfg.ftz, rng: r ? () => r.next() : undefined };
  }

  round(fmt: FloatFormatId, hi: number, lo = 0): number {
    const v = roundFloat(FLOAT_FORMATS[fmt], hi, this.opts, lo);
    this.flags |= lastRound.flags;
    return v;
  }

  mul(a: number, b: number, fmt: FloatFormatId = this.cfg.productFormat): number {
    const [p, e] = twoProduct(a, b);
    return this.round(fmt, p, e);
  }

  add(a: number, b: number, fmt: FloatFormatId = this.cfg.accumulatorFormat): number {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return this.round(fmt, a + b);
    const [s, t] = twoSum(a, b);
    return this.round(fmt, s, t);
  }

  sub(a: number, b: number, fmt: FloatFormatId = this.cfg.accumulatorFormat): number {
    return this.add(a, -b, fmt);
  }

  /** Sums already-rounded terms using the configured order. */
  sum(terms: ArrayLike<number>, steps?: DotStep[]): number {
    const cfg = this.cfg;
    const acc = cfg.accumulatorFormat;
    switch (cfg.order) {
      case 'pairwise':
        return this.pairwise(terms, 0, terms.length);
      case 'kahan': {
        let s = 0;
        let c = 0;
        for (let i = 0; i < terms.length; i++) {
          const y = this.sub(terms[i]!, c, acc);
          const t = this.add(s, y, acc);
          c = this.sub(this.sub(t, s, acc), y, acc);
          s = t;
        }
        return s;
      }
      case 'blocked': {
        const B = Math.max(1, Math.floor(cfg.blockSize));
        let outer = 0;
        for (let start = 0; start < terms.length; start += B) {
          let inner = 0;
          for (let i = start; i < Math.min(terms.length, start + B); i++) {
            const before = inner;
            inner = this.add(inner, terms[i]!, acc);
            if (steps) recordStep(steps, i, before, inner, terms[i]!);
          }
          outer = this.add(outer, inner, cfg.outerFormat);
        }
        return outer;
      }
      default: {
        let s = 0;
        for (let i = 0; i < terms.length; i++) {
          const before = s;
          s = this.add(s, terms[i]!, acc);
          if (steps) recordStep(steps, i, before, s, terms[i]!);
        }
        return s;
      }
    }
  }

  private pairwise(terms: ArrayLike<number>, lo: number, hi: number): number {
    const n = hi - lo;
    if (n === 0) return 0;
    if (n === 1) return terms[lo]!;
    const mid = lo + Math.floor(n / 2);
    return this.add(this.pairwise(terms, lo, mid), this.pairwise(terms, mid, hi));
  }

  /** Dot product with the configured product/accumulator/output precision. */
  dot(a: ArrayLike<number>, b: ArrayLike<number>, withSteps = false, bias?: number): DotResult {
    if (a.length !== b.length) throw new RangeError('Dot product operands must have equal length');
    const n = a.length;
    const products = new Float64Array(n);
    const exact = new ExactSum();
    const steps: DotStep[] | null = withSteps ? [] : null;
    const flagsBefore = this.flags;
    this.flags = 0;
    for (let i = 0; i < n; i++) {
      products[i] = this.mul(a[i]!, b[i]!);
      exact.addProduct(a[i]!, b[i]!);
    }
    let value = this.sum(products, steps ?? undefined);
    if (bias !== undefined) {
      value = this.add(value, bias);
      exact.add(bias);
    }
    value = this.round(this.cfg.outputFormat, value);
    if (steps) {
      const running = new ExactSum();
      for (const st of steps) {
        st.a = a[st.index]!;
        st.b = b[st.index]!;
        st.productExact = st.a * st.b;
        running.addProduct(st.a, st.b);
        st.exactRunning = running.toNumber();
      }
    }
    const flags = this.flags;
    this.flags |= flagsBefore;
    return { value, exact: exact.toNumber(), flags, steps };
  }
}

function recordStep(steps: DotStep[], index: number, before: number, after: number, product: number): void {
  const [s, t] = twoSum(before, product);
  steps.push({
    index,
    a: 0,
    b: 0,
    productExact: 0,
    product,
    accBefore: before,
    accAfter: after,
    stepError: Number.isFinite(s) && Number.isFinite(after) ? s - after + t : NaN,
    exactRunning: 0,
    flags: lastRound.flags,
  });
}

/** Flags that indicate a non-finite or saturated arithmetic result. */
export const ARITH_PROBLEM_FLAGS = RoundFlag.Overflow | RoundFlag.NaNResult | RoundFlag.InfResult | RoundFlag.Saturated;

/** Convenience: dot product with a fresh machine. */
export function simulatedDot(a: ArrayLike<number>, b: ArrayLike<number>, cfg: ArithConfig, withSteps = false): DotResult {
  return new ArithMachine(cfg).dot(a, b, withSteps);
}
