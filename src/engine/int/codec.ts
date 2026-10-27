/**
 * Two's complement encoding for the signed integer element formats.
 */
import type { IntFormat } from '../formats/types';

export function intMask(fmt: IntFormat): bigint {
  return (1n << BigInt(fmt.totalBits)) - 1n;
}

/** Encodes an integer in [min, max] as a two's complement bit pattern. */
export function encodeInt(fmt: IntFormat, q: number): bigint {
  if (!Number.isInteger(q) || q < fmt.min || q > fmt.max) {
    throw new RangeError(`${q} is not a valid ${fmt.name} value (range [${fmt.min}, ${fmt.max}])`);
  }
  return BigInt(q) & intMask(fmt);
}

/** Decodes any bit pattern (only the low `totalBits` bits are used). */
export function decodeInt(fmt: IntFormat, bits: bigint): number {
  return Number(BigInt.asIntN(fmt.totalBits, bits & intMask(fmt)));
}

/** Integer range of a quantization grid, optionally narrowed to be symmetric. */
export function intRange(fmt: IntFormat, narrow: boolean): { qmin: number; qmax: number } {
  return { qmin: narrow ? -fmt.max : fmt.min, qmax: fmt.max };
}
