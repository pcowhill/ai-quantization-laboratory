/**
 * Exact accumulation of sums of doubles and products of doubles using
 * dyadic rationals m·2^e with BigInt m. Used to compute the mathematically
 * exact dot product of the *stored* operands, so the simulator can separate
 * storage (quantization) error from arithmetic (rounding) error.
 */
import { doubleToBits } from '../float/double';
import { FLOAT_FORMATS } from '../formats/registry';
import { roundParsed } from '../float/rational';

function decompose(x: number): { m: bigint; e: number } {
  const bits = doubleToBits(x);
  const neg = bits >> 63n === 1n;
  const biased = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & 0xfffffffffffffn;
  const m = biased === 0 ? frac : frac | 0x10000000000000n;
  const e = (biased === 0 ? 1 : biased) - 1075;
  return { m: neg ? -m : m, e };
}

export class ExactSum {
  private m = 0n;
  private e = 0;
  private nonFinite: number | null = null;

  /** Adds m·2^e. */
  private addDyadic(m: bigint, e: number): void {
    if (m === 0n) return;
    if (this.m === 0n) {
      this.m = m;
      this.e = e;
      return;
    }
    if (e < this.e) {
      this.m <<= BigInt(this.e - e);
      this.e = e;
      this.m += m;
    } else {
      this.m += m << BigInt(e - this.e);
    }
  }

  private trackNonFinite(v: number): boolean {
    if (Number.isFinite(v)) return false;
    if (this.nonFinite === null) this.nonFinite = v;
    else this.nonFinite = this.nonFinite + v; // Inf + (−Inf) → NaN, NaN propagates
    return true;
  }

  add(x: number): this {
    if (this.trackNonFinite(x)) return this;
    const d = decompose(x);
    this.addDyadic(d.m, d.e);
    return this;
  }

  /** Adds the exact product a·b. */
  addProduct(a: number, b: number): this {
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      this.trackNonFinite(a * b);
      return this;
    }
    const da = decompose(a);
    const db = decompose(b);
    this.addDyadic(da.m * db.m, da.e + db.e);
    return this;
  }

  isZero(): boolean {
    return this.nonFinite === null && this.m === 0n;
  }

  /** The exact sum rounded once (round-to-nearest-even) to FP64. */
  toNumber(): number {
    if (this.nonFinite !== null) return this.nonFinite;
    if (this.m === 0n) return 0;
    const negative = this.m < 0n;
    const mag = negative ? -this.m : this.m;
    const parsed =
      this.e >= 0
        ? { kind: 'finite' as const, negative, num: mag << BigInt(this.e), den: 1n }
        : { kind: 'finite' as const, negative, num: mag, den: 1n << BigInt(-this.e) };
    return roundParsed(FLOAT_FORMATS.fp64, parsed, { mode: 'nearest-even', overflow: 'nonsaturate' });
  }

  clone(): ExactSum {
    const c = new ExactSum();
    c.m = this.m;
    c.e = this.e;
    c.nonFinite = this.nonFinite;
    return c;
  }
}

/** Exact dot product of two double vectors, rounded once to FP64. */
export function exactDot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const s = new ExactSum();
  for (let i = 0; i < a.length; i++) s.addProduct(a[i]!, b[i]!);
  return s.toNumber();
}

/** Exact sum of a double vector, rounded once to FP64. */
export function exactSum(a: ArrayLike<number>): number {
  const s = new ExactSum();
  for (let i = 0; i < a.length; i++) s.add(a[i]!);
  return s.toNumber();
}
