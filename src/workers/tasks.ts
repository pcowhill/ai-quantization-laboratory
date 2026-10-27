import type { QuantConfig } from '@/engine/quant/types';
import { evaluateVariants, type VariantEvaluation } from '@/labs/workbench';

export type TaskRequest = { kind: 'workbench'; data: Float64Array; shape: [number, number]; variants: { id: string; config: QuantConfig }[] };

export type TaskResult = VariantEvaluation[];

export function runTask(task: TaskRequest): TaskResult {
  switch (task.kind) {
    case 'workbench':
      return evaluateVariants(task.data, task.shape, task.variants);
  }
}
