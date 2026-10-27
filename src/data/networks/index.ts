/**
 * Curated miniature networks. Trained presets come from
 * scripts/train_network_presets.py (see trained.json provenance); the others
 * are constructed here deterministically.
 */
import { initNetwork, type NetworkDef } from '@/engine/nn/network';
import { NormalSampler } from '@/engine/random/distributions';
import { Rng } from '@/engine/random/prng';
import trained from './trained.json';

export interface NetworkPreset {
  id: string;
  name: string;
  description: string;
  network: NetworkDef;
  samples: number[][];
  labels: number[] | null;
  /** 2-D inputs can show decision regions over this box. */
  plotRange?: { x: [number, number]; y: [number, number] };
  /** Inputs are 8×8 images. */
  image?: { width: number; height: number };
  provenance: string;
}

interface TrainedPreset {
  id: string;
  name: string;
  description: string;
  network: NetworkDef;
  samples: number[][];
  labels: number[];
  training: { evalAccuracy: number; seed: number };
}

const TRAINED = trained.presets as unknown as TrainedPreset[];
const TRAINED_NOTE = 'Trained offline with scripts/train_network_presets.py (NumPy, full-batch Adam); parameters stored at FP32 precision.';

function fromTrained(id: string, extra: Partial<NetworkPreset>): NetworkPreset {
  const p = TRAINED.find((t) => t.id === id);
  if (!p) throw new Error(`Missing trained preset ${id}`);
  return {
    id: p.id,
    name: p.name,
    description: `${p.description} Held-out accuracy (FP64): ${(p.training.evalAccuracy * 100).toFixed(1)}%.`,
    network: p.network,
    samples: p.samples,
    labels: p.labels,
    provenance: TRAINED_NOTE,
    ...extra,
  };
}

function clusters(centers: [number, number][], labels: number[], perCluster: number, std: number, seed: number) {
  const rng = new Rng(seed);
  const normal = new NormalSampler(rng);
  const samples: number[][] = [];
  const out: number[] = [];
  centers.forEach((c, k) => {
    for (let i = 0; i < perCluster; i++) {
      samples.push([c[0] + std * normal.next(), c[1] + std * normal.next()]);
      out.push(labels[k]!);
    }
  });
  return { samples, labels: out };
}

function xorPreset(): NetworkPreset {
  // h1 = relu(x1 + x2), h2 = relu(x1 + x2 − 1); s = h1 − 2·h2 is XOR on {0,1}².
  // Logits: ±4·(s − 0.5).
  const network: NetworkDef = {
    inputSize: 2,
    layers: [
      { units: 2, activation: 'relu', weights: [1, 1, 1, 1], bias: [0, -1] },
      { units: 2, activation: 'identity', weights: [-4, 8, 4, -8], bias: [2, -2] },
    ],
    output: 'softmax',
    inputNames: ['x₁', 'x₂'],
    outputNames: ['XOR = 0', 'XOR = 1'],
  };
  const d = clusters([[0, 0], [0, 1], [1, 0], [1, 1]], [0, 1, 1, 0], 25, 0.12, 2026);
  return {
    id: 'xor',
    name: 'Hand-built XOR (ReLU 2-2-2)',
    description: 'A four-weight network computing XOR exactly. Every weight is a small integer, so an unscaled FP8 or BF16 cast represents it exactly; scaled formats generally do not (an INT8 scale of max|w|/127 puts −4 at −4.03…, and a rounded FP32 scale perturbs FP8 values slightly).',
    network,
    ...d,
    plotRange: { x: [-0.6, 1.6], y: [-0.6, 1.6] },
    provenance: 'Constructed by hand; samples from four seeded Gaussian clusters (σ = 0.12, seed 2026).',
  };
}

function deepChainPreset(): NetworkPreset {
  const rng = new Rng(77);
  const normal = new NormalSampler(rng.fork(1));
  const net = initNetwork(4, [8, 8, 8, 8, 8, 8, 2], ['tanh', 'tanh', 'tanh', 'tanh', 'tanh', 'tanh', 'identity'], 'identity', rng, normal);
  // Gain 4 on tanh layers puts the chain in the chaotic, sensitivity-amplifying regime.
  net.layers.forEach((l, i) => {
    if (i < 6) l.weights = l.weights.map((w) => w * 4);
  });
  net.inputNames = ['u₁', 'u₂', 'u₃', 'u₄'];
  net.outputNames = ['y₁', 'y₂'];
  const sRng = new Rng(78);
  const samples = Array.from({ length: 24 }, () => Array.from({ length: 4 }, () => 2 * sRng.next() - 1));
  return {
    id: 'deep-chain',
    name: 'Deep tanh chain (4-8×6-2, regression)',
    description: 'Seven narrow tanh layers with weight gain 4 (no training) — a chaotic regime where small perturbations grow from layer to layer, which makes error propagation visible.',
    network: net,
    samples,
    labels: null,
    provenance: 'Deterministic initialisation (xoshiro128** seed 77, N(0, (4/√fan-in)²) weights in hidden layers); inputs uniform in [−1, 1] (seed 78).',
  };
}

/**
 * Function-preserving rescaling: for a ReLU unit, multiplying its incoming
 * weights and bias by k and dividing its outgoing weights by k leaves the
 * network function unchanged (ReLU is positively homogeneous), but creates a
 * weight outlier row and an activation outlier feature.
 */
function rescaledNeuron(base: NetworkPreset, unit: number, k: number): NetworkPreset {
  const net: NetworkDef = structuredClone(base.network);
  const l0 = net.layers[0]!;
  const l1 = net.layers[1]!;
  const fanIn = net.inputSize;
  for (let i = 0; i < fanIn; i++) l0.weights[unit * fanIn + i]! *= k;
  l0.bias[unit]! *= k;
  for (let j = 0; j < l1.units; j++) l1.weights[j * l0.units + unit]! /= k;
  return {
    ...base,
    id: `${base.id}-rescaled`,
    name: `${base.name.split(' (')[0]} with a rescaled neuron (×${k})`,
    description: `The two-moons network after an exactly function-preserving change: hidden unit ${unit} of layer 1 has its input weights and bias multiplied by ${k} and its output weights divided by ${k}. In exact arithmetic predictions are unchanged, but layer 1 now contains a weight-outlier row and layer 2 receives an activation-outlier feature.`,
    network: net,
    provenance: `${base.provenance} Rescaled in src/data/networks/index.ts.`,
  };
}

const moons = fromTrained('moons', { plotRange: { x: [-1.6, 2.6], y: [-1.1, 1.6] } });

export const NETWORK_PRESETS: NetworkPreset[] = [
  moons,
  fromTrained('circles', { plotRange: { x: [-1.4, 1.4], y: [-1.4, 1.4] } }),
  fromTrained('spiral', { plotRange: { x: [-1.15, 1.15], y: [-1.15, 1.15] } }),
  fromTrained('digits', { image: { width: 8, height: 8 } }),
  xorPreset(),
  deepChainPreset(),
  rescaledNeuron(moons, 0, 32),
];

export function networkPreset(id: string): NetworkPreset {
  const p = NETWORK_PRESETS.find((n) => n.id === id);
  if (!p) throw new Error(`Unknown network preset "${id}"`);
  return p;
}
