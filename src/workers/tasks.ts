import type { QuantConfig } from '@/engine/quant/types';
import { prepareNetwork, type NetworkDef } from '@/engine/nn/network';
import { evaluateVariants, type VariantEvaluation } from '@/labs/workbench';
import { decisionGrid, evaluateNetwork, type NetworkEvaluation } from '@/labs/network';
import type { NetworkState, NetworkVariant } from '@/state/schema';

export type TaskRequest =
  | { kind: 'workbench'; data: Float64Array; shape: [number, number]; variants: { id: string; config: QuantConfig }[] }
  | { kind: 'network-eval'; state: NetworkState }
  | { kind: 'network-grid'; net: NetworkDef; variants: NetworkVariant[]; samples: number[][]; range: { x: [number, number]; y: [number, number] }; G: number };

export interface GridResult {
  id: string;
  grid: Uint8Array | null;
  error: string | null;
}

export type TaskResult = VariantEvaluation[] | NetworkEvaluation | GridResult[];

export function runTask(task: TaskRequest): TaskResult {
  switch (task.kind) {
    case 'workbench':
      return evaluateVariants(task.data, task.shape, task.variants);
    case 'network-eval':
      return evaluateNetwork(task.state);
    case 'network-grid': {
      const out: GridResult[] = [{ id: 'baseline', grid: decisionGrid(prepareNetwork(task.net, null), task.range, task.G), error: null }];
      for (const v of task.variants) {
        try {
          const p = prepareNetwork(task.net, { layers: v.layers, activationCalibration: v.activationCalibration }, task.samples);
          out.push({ id: v.id, grid: decisionGrid(p, task.range, task.G), error: null });
        } catch (e) {
          out.push({ id: v.id, grid: null, error: (e as Error).message });
        }
      }
      return out;
    }
  }
}
