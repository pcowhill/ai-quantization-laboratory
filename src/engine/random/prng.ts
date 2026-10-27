/**
 * Deterministic pseudo-random number generation.
 *
 * Generator: xoshiro128** 1.1 (Blackman & Vigna, https://prng.di.unimi.it/),
 * seeded from a 32-bit integer through SplitMix32. Only 32-bit integer
 * operations (Math.imul, shifts) are used, so the sequence is bit-identical
 * in every JavaScript engine.
 */

export type Seed = number;

/** Normalises any finite number to an unsigned 32-bit seed. */
export function normalizeSeed(seed: number): number {
  if (!Number.isFinite(seed)) throw new RangeError('Seed must be a finite number');
  return Math.trunc(seed) >>> 0;
}

function splitmix32(state: { s: number }): number {
  state.s = (state.s + 0x9e3779b9) | 0;
  let z = state.s;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
  return (z ^ (z >>> 16)) >>> 0;
}

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;
  readonly seed: number;

  constructor(seed: Seed) {
    this.seed = normalizeSeed(seed);
    const st = { s: this.seed };
    this.a = splitmix32(st);
    this.b = splitmix32(st);
    this.c = splitmix32(st);
    this.d = splitmix32(st);
    if ((this.a | this.b | this.c | this.d) === 0) this.a = 1;
  }

  /** Next unsigned 32-bit integer. */
  nextUint32(): number {
    const result = Math.imul(rotl(Math.imul(this.b, 5), 7), 9) >>> 0;
    const t = this.b << 9;
    this.c ^= this.a;
    this.d ^= this.b;
    this.b ^= this.c;
    this.a ^= this.d;
    this.c ^= t;
    this.d = rotl(this.d, 11);
    return result;
  }

  /** Uniform double in [0, 1) with 53 random bits. */
  next(): number {
    const hi = this.nextUint32() >>> 5; // 27 bits
    const lo = this.nextUint32() >>> 6; // 26 bits
    return (hi * 67108864 + lo) / 9007199254740992;
  }

  /** Uniform integer in [0, n) (n ≤ 2^32) without modulo bias. */
  nextInt(n: number): number {
    if (n <= 0 || n > 4294967296 || !Number.isInteger(n)) throw new RangeError('nextInt bound out of range');
    const limit = 4294967296 - (4294967296 % n);
    let x: number;
    do x = this.nextUint32();
    while (x >= limit);
    return x % n;
  }

  /** Derives an independent child generator (for per-purpose streams). */
  fork(label: number): Rng {
    return new Rng((this.seed ^ Math.imul(label + 1, 0x9e3779b1)) >>> 0);
  }

  /** Returns a bound `() => number` uniform source. */
  uniformSource(): () => number {
    return () => this.next();
  }
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}
