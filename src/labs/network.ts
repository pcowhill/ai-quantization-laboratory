/**
 * Neural Network Laboratory computations (pure).
 */
import { computeErrorMetrics } from '@/engine/metrics/error';
import { forward, prepareNetwork, validateNetwork, validateNetworkQuant, type ForwardTrace, type NetworkDef, type PreparedNetwork } from '@/engine/nn/network';
import type { NetworkState, NetworkVariant } from '@/state/schema';

export interface VariantPrepared {
  id: string;
  name: string;
  prepared: PreparedNetwork | null;
  error: string | null;
}

export interface LayerError {
  layer: number;
  /** Mean over samples of ‖a_q − a_b‖ / ‖a_b‖ for the layer output. */
  relError: number;
  /** Mean cosine similarity of layer outputs. */
  cosine: number;
  /** Mean over samples of the layer-input quantization error ‖ã − a‖ / ‖a‖ (0 if not quantized). */
  inputQuantError: number;
}

export interface VariantSummary {
  id: string;
  predictions: number[];
  accuracy: number | null;
  agreement: number;
  flips: number[];
  meanAbsOutputDiff: number;
  maxAbsOutputDiff: number;
  layerErrors: LayerError[];
}

export interface NetworkEvaluation {
  issues: string[];
  baseline: PreparedNetwork | null;
  baselinePredictions: number[];
  baselineAccuracy: number | null;
  variants: VariantPrepared[];
  summaries: VariantSummary[];
  /** Traces for the selected sample. */
  baselineTrace: ForwardTrace | null;
  variantTraces: Record<string, ForwardTrace | null>;
}

function norm(v: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i]! * v[i]!;
  return Math.sqrt(s);
}

function relDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += (a[i]! - b[i]!) ** 2;
  const nb = norm(b);
  return nb === 0 ? (d === 0 ? 0 : Infinity) : Math.sqrt(d) / nb;
}

export function prepareVariant(net: NetworkDef, v: NetworkVariant, samples: number[][]): VariantPrepared {
  try {
    const quant = { layers: v.layers, activationCalibration: v.activationCalibration };
    const issues = validateNetworkQuant(net, quant);
    if (issues.length) return { id: v.id, name: v.name, prepared: null, error: issues.map((i) => i.message).join(' ') };
    return { id: v.id, name: v.name, prepared: prepareNetwork(net, quant, samples), error: null };
  } catch (e) {
    return { id: v.id, name: v.name, prepared: null, error: (e as Error).message };
  }
}

/** Evaluates the baseline and every enabled variant on all samples. */
export function evaluateNetwork(s: NetworkState, maxSamples = 400): NetworkEvaluation {
  const issues = validateNetwork(s.network).map((i) => i.message);
  const empty: NetworkEvaluation = { issues, baseline: null, baselinePredictions: [], baselineAccuracy: null, variants: [], summaries: [], baselineTrace: null, variantTraces: {} };
  if (issues.length) return empty;
  const badSample = s.samples.findIndex((x) => x.length !== s.network.inputSize);
  if (badSample >= 0) return { ...empty, issues: [`Sample ${badSample} has ${s.samples[badSample]!.length} values; the network expects ${s.network.inputSize}.`] };
  const samples = s.samples.slice(0, maxSamples);
  const baseline = prepareNetwork(s.network, null);
  const baseTraces = samples.map((x) => forward(baseline, x));
  const baselinePredictions = baseTraces.map((t) => t.prediction);
  const labels = s.labels?.slice(0, samples.length) ?? null;
  const acc = (preds: number[]) => (labels ? preds.filter((p, i) => p === labels[i]).length / preds.length : null);
  const variants = s.variants.filter((v) => v.enabled).map((v) => prepareVariant(s.network, v, samples));
  const summaries: VariantSummary[] = [];
  const variantTraces: Record<string, ForwardTrace | null> = {};
  const sel = Math.min(s.selectedSample, s.samples.length - 1);
  for (const v of variants) {
    if (!v.prepared) {
      variantTraces[v.id] = null;
      continue;
    }
    const traces = samples.map((x) => forward(v.prepared!, x));
    const predictions = traces.map((t) => t.prediction);
    let sumAbs = 0;
    let maxAbs = 0;
    let count = 0;
    const L = s.network.layers.length;
    const layerErrors: LayerError[] = Array.from({ length: L }, (_, l) => ({ layer: l, relError: 0, cosine: 0, inputQuantError: 0 }));
    traces.forEach((t, i) => {
      const b = baseTraces[i]!;
      for (let k = 0; k < t.output.length; k++) {
        const d = Math.abs(t.output[k]! - b.output[k]!);
        sumAbs += d;
        maxAbs = Math.max(maxAbs, d);
        count++;
      }
      for (let l = 0; l < L; l++) {
        layerErrors[l]!.relError += relDiff(t.layers[l]!.output, b.layers[l]!.output) / traces.length;
        const m = computeErrorMetrics(b.layers[l]!.output, t.layers[l]!.output);
        layerErrors[l]!.cosine += (m.cosine ?? 1) / traces.length;
        layerErrors[l]!.inputQuantError += relDiff(t.layers[l]!.inputUsed, t.layers[l]!.input) / traces.length;
      }
    });
    summaries.push({
      id: v.id,
      predictions,
      accuracy: acc(predictions),
      agreement: predictions.filter((p, i) => p === baselinePredictions[i]).length / predictions.length,
      flips: predictions.map((p, i) => (p !== baselinePredictions[i] ? i : -1)).filter((i) => i >= 0),
      meanAbsOutputDiff: count ? sumAbs / count : 0,
      maxAbsOutputDiff: maxAbs,
      layerErrors,
    });
    variantTraces[v.id] = sel >= 0 ? forward(v.prepared, s.samples[sel]!) : null;
  }
  return {
    issues,
    baseline,
    baselinePredictions,
    baselineAccuracy: acc(baselinePredictions),
    variants,
    summaries,
    baselineTrace: sel >= 0 ? forward(baseline, s.samples[sel]!) : null,
    variantTraces,
  };
}

/** Class predictions over a G×G grid of 2-D inputs (decision regions). */
export function decisionGrid(prepared: PreparedNetwork, range: { x: [number, number]; y: [number, number] }, G: number): Uint8Array {
  const out = new Uint8Array(G * G);
  for (let r = 0; r < G; r++) {
    const y = range.y[1] - ((r + 0.5) / G) * (range.y[1] - range.y[0]);
    for (let c = 0; c < G; c++) {
      const x = range.x[0] + ((c + 0.5) / G) * (range.x[1] - range.x[0]);
      out[r * G + c] = forward(prepared, [x, y]).prediction;
    }
  }
  return out;
}
