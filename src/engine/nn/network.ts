/**
 * Miniature multilayer perceptron with independently quantized weights and
 * activations (fake quantization: values are quantized and immediately
 * dequantized, and the arithmetic itself follows an ArithConfig).
 *
 * For layer ℓ with input vector a (length n_in):
 *   1. activation quantization:  ã = Q_act(a)          (if configured)
 *   2. weight quantization:      W̃ = Q_w(W)            (once per variant)
 *   3. affine map:               z_j = Σ_i W̃[j,i]·ã_i + b_j
 *                                 (products/sums rounded per the layer's ArithConfig;
 *                                  bias added in the accumulator)
 *   4. activation function:      a'_j = f(z_j) in FP64 using deterministic math
 * The network output applies softmax / sigmoid / identity to the last layer.
 */
import { ArithMachine, FP64_ARITH, type ArithConfig } from '../arith/dot';
import { geluTanh, sigmoid, silu, softmax, tanh } from '../detmath';
import { computeLayout } from '../quant/layout';
import { calibrateValues, quantizeTensor, quantizeValue, type BlockParams, type QuantResult } from '../quant/quantize';
import { validateQuantConfig, type QuantConfig } from '../quant/types';

export type Activation = 'identity' | 'relu' | 'leaky-relu' | 'sigmoid' | 'tanh' | 'gelu' | 'silu';
export type OutputMode = 'softmax' | 'sigmoid' | 'identity';

export const ACTIVATIONS: { id: Activation; name: string; formula: string }[] = [
  { id: 'identity', name: 'Identity', formula: 'f(z) = z' },
  { id: 'relu', name: 'ReLU', formula: 'f(z) = max(0, z)' },
  { id: 'leaky-relu', name: 'Leaky ReLU', formula: 'f(z) = z if z > 0 else 0.01·z' },
  { id: 'sigmoid', name: 'Sigmoid', formula: 'f(z) = 1 / (1 + e^−z)' },
  { id: 'tanh', name: 'tanh', formula: 'f(z) = tanh(z)' },
  { id: 'gelu', name: 'GELU (tanh approx.)', formula: 'f(z) = ½z(1 + tanh(√(2/π)(z + 0.044715z³)))' },
  { id: 'silu', name: 'SiLU / Swish', formula: 'f(z) = z·σ(z)' },
];

export function applyActivation(act: Activation, z: number): number {
  switch (act) {
    case 'identity':
      return z;
    case 'relu':
      return z > 0 ? z : 0;
    case 'leaky-relu':
      return z > 0 ? z : 0.01 * z;
    case 'sigmoid':
      return sigmoid(z);
    case 'tanh':
      return tanh(z);
    case 'gelu':
      return geluTanh(z);
    case 'silu':
      return silu(z);
  }
}

export interface LayerDef {
  units: number;
  activation: Activation;
  /** Row-major weights, shape [units, inputs]. */
  weights: number[];
  bias: number[];
}

export interface NetworkDef {
  inputSize: number;
  layers: LayerDef[];
  output: OutputMode;
  inputNames?: string[];
  outputNames?: string[];
}

export type ActivationCalibration = 'dynamic' | 'static';

export interface LayerQuant {
  /** null = keep weights in FP64. */
  weight: QuantConfig | null;
  /** null = keep this layer's input activations in FP64. */
  activation: QuantConfig | null;
  /** null = FP64 arithmetic. */
  arith: ArithConfig | null;
}

export interface NetworkQuant {
  layers: LayerQuant[];
  /** dynamic: activation scales computed from each input vector; static: calibrated once on a calibration set. */
  activationCalibration: ActivationCalibration;
}

export const MAX_UNITS = 64;
export const MAX_LAYERS = 8;
export const MAX_INPUTS = 64;

export interface NetworkIssue {
  path: string;
  message: string;
}

/**
 * Activation quantization acts on the layer-input vector, viewed as shape
 * [1, width]: per-tensor, per-feature (granularity `channel`, axis 1) or
 * groups of consecutive features (granularity `group`, axis 0).
 */
export function validateNetworkQuant(net: NetworkDef, quant: NetworkQuant): NetworkIssue[] {
  const issues: NetworkIssue[] = [];
  if (quant.layers.length !== net.layers.length) {
    issues.push({ path: 'quant.layers', message: `Quantization settings list ${quant.layers.length} layers; the network has ${net.layers.length}.` });
  }
  let fanIn = net.inputSize;
  quant.layers.forEach((lq, i) => {
    const units = net.layers[i]?.units ?? 0;
    if (lq.weight) {
      for (const e of validateQuantConfig(lq.weight, [units, fanIn])) {
        if (e.severity === 'error') issues.push({ path: `quant.layers[${i}].weight.${e.field}`, message: `Layer ${i + 1} weights: ${e.message}` });
      }
    }
    if (lq.activation) {
      const a = lq.activation;
      for (const e of validateQuantConfig(a, [1, fanIn])) {
        if (e.severity === 'error') issues.push({ path: `quant.layers[${i}].activation.${e.field}`, message: `Layer ${i + 1} activations: ${e.message}` });
      }
      if (a.scaling === 'scaled' && a.granularity === 'channel' && a.axis !== 1) {
        issues.push({ path: `quant.layers[${i}].activation.axis`, message: `Layer ${i + 1} activations: per-feature scaling uses axis 1 of the [1, features] input.` });
      }
      if (a.scaling === 'scaled' && a.granularity === 'group' && a.axis !== 0) {
        issues.push({ path: `quant.layers[${i}].activation.axis`, message: `Layer ${i + 1} activations: feature groups run along axis 0 of the [1, features] input.` });
      }
    }
    fanIn = units;
  });
  return issues;
}

/** Validates shapes and limits; invalid networks are reported, never repaired. */
export function validateNetwork(net: NetworkDef): NetworkIssue[] {
  const issues: NetworkIssue[] = [];
  if (!Number.isInteger(net.inputSize) || net.inputSize < 1 || net.inputSize > MAX_INPUTS) {
    issues.push({ path: 'inputSize', message: `Input size must be an integer in [1, ${MAX_INPUTS}].` });
  }
  if (net.layers.length < 1 || net.layers.length > MAX_LAYERS) {
    issues.push({ path: 'layers', message: `A network needs between 1 and ${MAX_LAYERS} layers.` });
  }
  let fanIn = net.inputSize;
  net.layers.forEach((l, i) => {
    if (!Number.isInteger(l.units) || l.units < 1 || l.units > MAX_UNITS) {
      issues.push({ path: `layers[${i}].units`, message: `Layer ${i + 1} must have between 1 and ${MAX_UNITS} units.` });
    }
    if (l.weights.length !== l.units * fanIn) {
      issues.push({ path: `layers[${i}].weights`, message: `Layer ${i + 1} needs ${l.units}×${fanIn} = ${l.units * fanIn} weights, found ${l.weights.length}.` });
    }
    if (l.bias.length !== l.units) {
      issues.push({ path: `layers[${i}].bias`, message: `Layer ${i + 1} needs ${l.units} biases, found ${l.bias.length}.` });
    }
    if (l.weights.some((w) => !Number.isFinite(w)) || l.bias.some((b) => !Number.isFinite(b))) {
      issues.push({ path: `layers[${i}]`, message: `Layer ${i + 1} contains non-finite parameters.` });
    }
    fanIn = l.units;
  });
  if (net.output === 'softmax' && net.layers.length > 0 && net.layers[net.layers.length - 1]!.units < 2) {
    issues.push({ path: 'output', message: 'Softmax output needs at least two output units.' });
  }
  return issues;
}

export interface LayerTrace {
  /** Layer input before activation quantization. */
  input: Float64Array;
  /** Layer input as used in the matmul (after activation quantization). */
  inputUsed: Float64Array;
  /** Pre-activation z. */
  preact: Float64Array;
  /** Post-activation output. */
  output: Float64Array;
  /** Activation-quantization parameters (null if not quantized). */
  activationParams: BlockParams[] | null;
  /** OR of arithmetic rounding flags in this layer. */
  arithFlags: number;
}

export interface ForwardTrace {
  layers: LayerTrace[];
  /** Network output after the output transform (probabilities for softmax). */
  output: Float64Array;
  /** Index of the largest output. */
  prediction: number;
}

/** Prepared (quantized) weights for a network variant. */
export interface PreparedNetwork {
  net: NetworkDef;
  quant: NetworkQuant | null;
  weights: Float64Array[];
  weightResults: (QuantResult | null)[];
  /** Static activation parameters per layer (when calibration is static). */
  staticActivation: (BlockParams[] | null)[];
}

function layerQuant(quant: NetworkQuant | null, i: number): LayerQuant {
  return quant?.layers[i] ?? { weight: null, activation: null, arith: null };
}

/** Quantizes weights (and, for static calibration, activation ranges) once. */
export function prepareNetwork(net: NetworkDef, quant: NetworkQuant | null, calibrationInputs: number[][] = []): PreparedNetwork {
  const issues = [...validateNetwork(net), ...(quant ? validateNetworkQuant(net, quant) : [])];
  if (issues.length) throw new Error(issues.map((i) => i.message).join(' '));
  let fanIn = net.inputSize;
  const weights: Float64Array[] = [];
  const weightResults: (QuantResult | null)[] = [];
  net.layers.forEach((l, i) => {
    const lq = layerQuant(quant, i);
    if (lq.weight) {
      const r = quantizeTensor(l.weights, [l.units, fanIn], lq.weight);
      weights.push(r.recon);
      weightResults.push(r);
    } else {
      weights.push(Float64Array.from(l.weights));
      weightResults.push(null);
    }
    fanIn = l.units;
  });
  const prepared: PreparedNetwork = { net, quant, weights, weightResults, staticActivation: net.layers.map(() => null) };
  if (quant && quant.activationCalibration === 'static') {
    if (calibrationInputs.length === 0) throw new Error('Static activation calibration needs at least one calibration input.');
    // Calibrate each quantized layer input on the calibration set, propagating
    // through the already-calibrated (partially quantized) earlier layers.
    let batch: Float64Array[] = calibrationInputs.map((x) => Float64Array.from(x));
    for (let i = 0; i < net.layers.length; i++) {
      const cfg = layerQuant(quant, i).activation;
      if (cfg) {
        const width = batch[0]!.length;
        if (cfg.scaling === 'none') {
          prepared.staticActivation[i] = null;
        } else {
          const layout = computeLayout([1, width], cfg.granularity, cfg.axis, cfg.groupSize);
          const params: BlockParams[] = [];
          for (let b = 0; b < layout.blockCount; b++) {
            const vals: number[] = [];
            for (const v of batch) for (let k = 0; k < width; k++) if (layout.blockOf[k] === b) vals.push(v[k]!);
            params.push(calibrateValues(vals, cfg));
          }
          prepared.staticActivation[i] = params;
        }
      }
      batch = batch.map((x) => layerForward(prepared, i, x).output);
    }
  }
  return prepared;
}

function quantizeActivation(prepared: PreparedNetwork, i: number, x: Float64Array): { used: Float64Array; params: BlockParams[] | null } {
  const cfg = layerQuant(prepared.quant, i).activation;
  if (!cfg) return { used: x, params: null };
  const fixed = prepared.staticActivation[i];
  if (fixed && cfg.scaling === 'scaled') {
    const layout = computeLayout([1, x.length], cfg.granularity, cfg.axis, cfg.groupSize);
    const used = new Float64Array(x.length);
    for (let k = 0; k < x.length; k++) {
      const p = fixed[layout.blockOf[k]!]!;
      used[k] = quantizeValue(x[k]!, cfg, p.scale, p.zeroPoint).recon;
    }
    return { used, params: fixed };
  }
  const r = quantizeTensor(x, [1, x.length], cfg);
  return { used: r.recon, params: cfg.scaling === 'scaled' ? r.params : null };
}

function layerForward(prepared: PreparedNetwork, i: number, x: Float64Array): LayerTrace {
  const l = prepared.net.layers[i]!;
  const lq = layerQuant(prepared.quant, i);
  const { used, params } = quantizeActivation(prepared, i, x);
  const W = prepared.weights[i]!;
  const fanIn = x.length;
  const machine = new ArithMachine(lq.arith ?? FP64_ARITH);
  const preact = new Float64Array(l.units);
  const output = new Float64Array(l.units);
  let flags = 0;
  for (let j = 0; j < l.units; j++) {
    const row = W.subarray(j * fanIn, (j + 1) * fanIn);
    const r = machine.dot(row, used, false, l.bias[j]!);
    preact[j] = r.value;
    flags |= r.flags;
    output[j] = applyActivation(l.activation, r.value);
  }
  return { input: x, inputUsed: used, preact, output, activationParams: params, arithFlags: flags };
}

/** Runs one input vector through a prepared network. */
export function forward(prepared: PreparedNetwork, input: ArrayLike<number>): ForwardTrace {
  if (input.length !== prepared.net.inputSize) {
    throw new RangeError(`Input has ${input.length} values; the network expects ${prepared.net.inputSize}.`);
  }
  let x: Float64Array = Float64Array.from(input);
  const layers: LayerTrace[] = [];
  for (let i = 0; i < prepared.net.layers.length; i++) {
    const t = layerForward(prepared, i, x);
    layers.push(t);
    x = t.output;
  }
  let output: Float64Array;
  switch (prepared.net.output) {
    case 'softmax':
      output = softmax(x);
      break;
    case 'sigmoid':
      output = x.map(sigmoid);
      break;
    default:
      output = x;
  }
  let prediction = 0;
  for (let k = 1; k < output.length; k++) if (output[k]! > output[prediction]!) prediction = k;
  return { layers, output, prediction };
}

/** Deterministic He/Xavier-style initialisation from a seed (no training). */
export function initNetwork(
  inputSize: number,
  units: number[],
  activations: Activation[],
  output: OutputMode,
  rng: { next(): number },
  normal: { next(): number },
): NetworkDef {
  let fanIn = inputSize;
  const layers: LayerDef[] = units.map((u, i) => {
    const act = activations[i] ?? 'relu';
    const gain = act === 'relu' || act === 'leaky-relu' ? Math.sqrt(2) : 1;
    const std = gain / Math.sqrt(fanIn);
    const weights = Array.from({ length: u * fanIn }, () => std * normal.next());
    const bias = Array.from({ length: u }, () => 0.1 * (rng.next() - 0.5));
    fanIn = u;
    return { units: u, activation: act, weights, bias };
  });
  return { inputSize, layers, output };
}
