/**
 * Storage accounting for quantized tensors.
 *
 * Theoretical (bit-packed) size counts exactly the bits a packed encoding
 * needs: elements × element bits + per-block scales + per-block zero-points.
 * Block layout parameters (granularity, axis, group size) are per-tensor
 * constants and are counted as negligible fixed metadata (reported separately
 * as `fixedMetadataBits`, 0 here).
 *
 * This is a storage estimate only. Smaller representations do not imply
 * proportional reductions in memory bandwidth, latency or energy, which also
 * depend on kernels, hardware support, packing and dequantization overhead.
 */
import { getFormat } from '../formats/registry';
import type { QuantConfig, ScaleFormat } from './types';

export const SCALE_FORMAT_BITS: Record<ScaleFormat, number> = {
  fp64: 64,
  fp32: 32,
  fp16: 16,
  bf16: 16,
  e8m0: 8,
};

export interface StorageEstimate {
  elements: number;
  elementBits: number;
  blocks: number;
  scaleBits: number;
  zeroPointBits: number;
  fixedMetadataBits: number;
  /** Total bits for the packed representation. */
  totalBits: number;
  /** Bytes, rounding the packed bit stream up to whole bytes. */
  totalBytes: number;
  /** Average bits per element including metadata. */
  bitsPerElement: number;
  /** Size relative to the same tensor stored as FP32 (FP32 bits / quantized bits). */
  compressionVsFp32: number;
  /** Bytes this browser application actually uses for the tensor (see `inMemoryNote`). */
  inMemoryBytes: number;
  inMemoryNote: string;
}

export function estimateStorage(cfg: QuantConfig, elements: number, blocks: number): StorageEstimate {
  const elementBits = getFormat(cfg.format).totalBits;
  const scaled = cfg.scaling === 'scaled';
  const scaleBitsEach = scaled ? SCALE_FORMAT_BITS[cfg.scaleFormat] : 0;
  const nBlocks = scaled ? blocks : 0;
  const hasZeroPoint = scaled && cfg.scheme === 'asymmetric' && getFormat(cfg.format).kind === 'int';
  // Zero-points are stored with the element bit width (an INT4 zero-point needs 4 bits).
  const zeroPointBits = hasZeroPoint ? nBlocks * elementBits : 0;
  const scaleBits = nBlocks * scaleBitsEach;
  const totalBits = elements * elementBits + scaleBits + zeroPointBits;
  // In this application every tensor is held as Float64Array (original, codes,
  // reconstruction) plus a Uint16Array of flags: 8 + 8 + 8 + 2 bytes per element.
  const inMemoryBytes = elements * 26 + nBlocks * 8 * 2;
  return {
    elements,
    elementBits,
    blocks: nBlocks,
    scaleBits,
    zeroPointBits,
    fixedMetadataBits: 0,
    totalBits,
    totalBytes: Math.ceil(totalBits / 8),
    bitsPerElement: elements > 0 ? totalBits / elements : 0,
    compressionVsFp32: totalBits > 0 ? (elements * 32) / totalBits : 0,
    inMemoryBytes,
    inMemoryNote:
      'The simulator keeps original, quantized and reconstructed values as 64-bit floats (plus 16-bit flags) for exact inspection; it never stores the packed bit stream.',
  };
}
