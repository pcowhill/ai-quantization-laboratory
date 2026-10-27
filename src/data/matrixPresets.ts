/**
 * Curated Matrix Laboratory examples. Each sets operands and, where the
 * lesson depends on them, storage / arithmetic settings.
 */
import { DEFAULT_ARITH_CONFIG } from '@/engine/arith/dot';
import { generate } from '@/engine/random/distributions';
import { makeQuantConfig } from '@/engine/quant/types';
import type { MatrixState } from '@/state/schema';

export interface MatrixPreset {
  id: string;
  name: string;
  description: string;
  apply: () => Partial<MatrixState>;
}

const g = (rows: number, cols: number, seed: number, kind: 'normal' | 'uniform' = 'normal', params: Record<string, number> = {}) =>
  Array.from(generate({ kind, params, rows, cols, seed }));

export const MATRIX_PRESETS: MatrixPreset[] = [
  {
    id: 'small',
    name: 'Small matrix product (3×4 · 4×2)',
    description: 'A hand-sized example: every intermediate value is visible.',
    apply: () => ({
      op: 'matmul',
      A: { rows: 3, cols: 4, values: [0.5, -1.25, 2, 0.1, 1.5, 0.3, -0.7, 3.2, -2.2, 0.05, 1.1, -0.4] },
      B: { rows: 4, cols: 2, values: [1.2, -0.3, 0.4, 2.5, -1.1, 0.6, 0.9, -0.05] },
    }),
  },
  {
    id: 'stagnation',
    name: 'Long dot product: FP16 accumulator stagnation',
    description: '4096 products between 0.8 and 0.99. Above 2048 the FP16 spacing is 2, so adding any value below 1 rounds straight back down: the running sum stops growing at 2048 — try pairwise or blocked order, or an FP32 accumulator. (Addends straddling 1 would instead round up and down at random, an unbiased random walk.)',
    apply: () => ({
      op: 'dot',
      A: { rows: 1, cols: 4096, values: g(1, 4096, 3, 'uniform', { low: 0.8, high: 0.99 }) },
      B: { rows: 4096, cols: 1, values: new Array(4096).fill(1) },
      quantA: null,
      quantB: null,
      arith: { ...DEFAULT_ARITH_CONFIG, productFormat: 'fp16', accumulatorFormat: 'fp16', outputFormat: 'fp32', order: 'sequential' },
    }),
  },
  {
    id: 'cancellation',
    name: 'Catastrophic cancellation',
    description: 'Two large terms cancel, leaving small ones. Low-precision accumulation loses the small terms entirely; order matters.',
    apply: () => ({
      op: 'dot',
      A: { rows: 1, cols: 6, values: [10000, 1.5, 0.25, -10000, 0.125, 3.0625] },
      B: { rows: 6, cols: 1, values: [1, 1, 1, 1, 1, 1] },
      quantA: null,
      quantB: null,
      arith: { ...DEFAULT_ARITH_CONFIG, productFormat: 'fp16', accumulatorFormat: 'fp16', outputFormat: 'fp16' },
    }),
  },
  {
    id: 'outlier-column',
    name: 'Activation outlier column × weights',
    description: 'A (8×16 activations) has one feature column ~50× larger. Per-tensor INT8 quantization of A crushes the other features; compare per-row or per-column scaling.',
    apply: () => {
      const a = g(8, 16, 11);
      for (let r = 0; r < 8; r++) a[r * 16 + 5] = 50 + 5 * a[r * 16 + 5]!;
      return {
        op: 'matmul',
        A: { rows: 8, cols: 16, values: a },
        B: { rows: 16, cols: 4, values: g(16, 4, 12).map((x) => x / 4) },
        quantA: makeQuantConfig({ format: 'int8', granularity: 'tensor' }),
        quantB: makeQuantConfig({ format: 'int8', granularity: 'channel', axis: 1 }),
        arith: { ...DEFAULT_ARITH_CONFIG },
      };
    },
  },
  {
    id: 'int8-kernel',
    name: 'INT8 × INT8 with INT32 accumulation',
    description: 'Both operands quantized to INT8 (per-row A, per-column B). Enable the integer path to compute with integer products, an INT32 accumulator and a final rescale.',
    apply: () => ({
      op: 'matmul',
      A: { rows: 6, cols: 32, values: g(6, 32, 21) },
      B: { rows: 32, cols: 5, values: g(32, 5, 22) },
      quantA: makeQuantConfig({ format: 'int8', granularity: 'channel', axis: 0 }),
      quantB: makeQuantConfig({ format: 'int8', granularity: 'channel', axis: 1 }),
      arith: { ...DEFAULT_ARITH_CONFIG },
      integerPath: true,
      intAccumulator: 'int32-wrap',
    }),
  },
  {
    id: 'fp8-gemm',
    name: 'FP8 E4M3 operands, FP32 accumulation',
    description: 'Operands stored in FP8 with per-tensor scales; products exact and accumulated in FP32. Error is dominated by storage, not arithmetic.',
    apply: () => ({
      op: 'matmul',
      A: { rows: 8, cols: 32, values: g(8, 32, 31) },
      B: { rows: 32, cols: 8, values: g(32, 8, 32) },
      quantA: makeQuantConfig({ format: 'fp8_e4m3' }),
      quantB: makeQuantConfig({ format: 'fp8_e4m3' }),
      arith: { ...DEFAULT_ARITH_CONFIG, productFormat: 'fp32', accumulatorFormat: 'fp32', outputFormat: 'fp32' },
    }),
  },
  {
    id: 'hilbert',
    name: 'Ill-conditioned: Hilbert matrix × vector',
    description: 'The 6×6 Hilbert matrix H[i][j] = 1/(i+j+1) times a vector of alternating signs: sums of nearly cancelling terms amplify tiny storage errors.',
    apply: () => ({
      op: 'matvec',
      A: { rows: 6, cols: 6, values: Array.from({ length: 36 }, (_, k) => 1 / (Math.floor(k / 6) + (k % 6) + 1)) },
      B: { rows: 6, cols: 1, values: [1, -6, 15, -20, 15, -6] },
      quantA: makeQuantConfig({ format: 'bf16', scaling: 'none', overflow: 'nonsaturate' }),
      quantB: null,
      arith: { ...DEFAULT_ARITH_CONFIG },
    }),
  },
  {
    id: 'vector-add',
    name: 'Vector addition in FP16',
    description: 'Adding small increments to large values: in FP16, 2048 + 1 = 2048.',
    apply: () => ({
      op: 'add',
      A: { rows: 1, cols: 6, values: [2048, 2048, 1024, 0.1, 65504, -3] },
      B: { rows: 1, cols: 6, values: [1, 3, 0.5, 0.2, 32, 3] },
      quantA: null,
      quantB: null,
      arith: { ...DEFAULT_ARITH_CONFIG, accumulatorFormat: 'fp16', productFormat: 'fp16', outputFormat: 'fp16' },
    }),
  },
  {
    id: 'scale',
    name: 'Scalar multiplication',
    description: 'Multiplying by 0.1 (itself inexact in binary) in BF16.',
    apply: () => ({
      op: 'scale',
      A: { rows: 2, cols: 4, values: [1, 2, 3, 4, 100, 1000, 0.5, -7] },
      scalar: 0.1,
      quantA: null,
      arith: { ...DEFAULT_ARITH_CONFIG, productFormat: 'bf16', accumulatorFormat: 'bf16', outputFormat: 'bf16' },
    }),
  },
];
