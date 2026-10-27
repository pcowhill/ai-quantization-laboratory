/**
 * Quantization Workbench computations (pure).
 */
import { RoundFlag } from '@/engine/float/round';
import { computeErrorMetrics, type ErrorMetrics } from '@/engine/metrics/error';
import { quantizeTensor, type QuantResult } from '@/engine/quant/quantize';
import { estimateStorage, type StorageEstimate } from '@/engine/quant/storage';
import { QuantConfigError, validateQuantConfig, type ConfigIssue, type QuantConfig } from '@/engine/quant/types';
import { generate } from '@/engine/random/distributions';
import { builtinTensor } from '@/data/datasets';
import type { DataSource } from '@/state/schema';

export interface ResolvedData {
  data: Float64Array;
  shape: [number, number];
  label: string;
}

export function resolveData(source: DataSource): ResolvedData {
  switch (source.kind) {
    case 'generator':
      return {
        data: generate({ kind: source.distribution, params: source.params, rows: source.rows, cols: source.cols, seed: source.seed }),
        shape: [source.rows, source.cols],
        label: `${source.distribution} ${source.rows}×${source.cols}, seed ${source.seed}`,
      };
    case 'builtin': {
      const b = builtinTensor(source.id);
      if (!b) throw new Error(`Unknown built-in dataset "${source.id}"`);
      const values = b.build();
      return { data: Float64Array.from(values), shape: [b.rows, b.cols], label: source.id };
    }
    case 'manual':
    case 'imported':
      if (source.values.length !== source.rows * source.cols) throw new Error(`Expected ${source.rows * source.cols} values, found ${source.values.length}.`);
      return { data: Float64Array.from(source.values), shape: [source.rows, source.cols], label: source.kind === 'imported' ? source.name : 'manual data' };
  }
}

export interface VariantEvaluation {
  id: string;
  issues: ConfigIssue[];
  error: string | null;
  result: QuantResult | null;
  metrics: ErrorMetrics | null;
  storage: StorageEstimate | null;
  /** Number of distinct quantized values actually used. */
  levelsUsed: number;
}

export function evaluateVariant(id: string, data: Float64Array, shape: [number, number], config: QuantConfig): VariantEvaluation {
  const issues = validateQuantConfig(config, shape);
  if (issues.some((i) => i.severity === 'error')) {
    return { id, issues, error: 'Invalid configuration', result: null, metrics: null, storage: null, levelsUsed: 0 };
  }
  try {
    const result = quantizeTensor(data, shape, config);
    const flags = result.flags;
    const metrics = computeErrorMetrics(result.original, result.recon, (i) => (flags[i]! & (RoundFlag.Saturated | RoundFlag.Overflow)) !== 0);
    const storage = estimateStorage(config, data.length, result.layout.blockCount);
    const levels = new Set<number>();
    for (const v of result.recon) levels.add(Object.is(v, -0) ? 0 : v);
    return { id, issues, error: null, result, metrics, storage, levelsUsed: levels.size };
  } catch (e) {
    const msg = e instanceof QuantConfigError ? e.issues.map((i) => i.message).join(' ') : (e as Error).message;
    return { id, issues, error: msg, result: null, metrics: null, storage: null, levelsUsed: 0 };
  }
}

export function evaluateVariants(data: Float64Array, shape: [number, number], variants: { id: string; config: QuantConfig }[]): VariantEvaluation[] {
  return variants.map((v) => evaluateVariant(v.id, data, shape, v.config));
}
