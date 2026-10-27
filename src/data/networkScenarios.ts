/**
 * Curated Neural Network Laboratory scenarios: a preset network plus
 * quantization variants chosen to demonstrate one effect each.
 */
import type { LayerQuant, NetworkDef } from '@/engine/nn/network';
import { DEFAULT_ARITH_CONFIG } from '@/engine/arith/dot';
import { activationConfig, networkStateFromPreset, weightConfig } from '@/state/defaults';
import type { NetworkState, NetworkVariant } from '@/state/schema';
import { networkPreset } from './networks';

export interface NetworkScenario {
  id: string;
  title: string;
  presetId: string;
  description: string;
  lookFor: string;
  variants: (net: NetworkDef) => NetworkVariant[];
}

const all = (net: NetworkDef, f: (i: number) => LayerQuant): LayerQuant[] => net.layers.map((_, i) => f(i));
const v = (id: string, name: string, layers: LayerQuant[], activationCalibration: 'dynamic' | 'static' = 'dynamic'): NetworkVariant => ({ id, name, enabled: true, layers, activationCalibration });

export const NETWORK_SCENARIOS: NetworkScenario[] = [
  {
    id: 'negligible',
    title: 'INT8 barely changes the digit classifier',
    presetId: 'digits',
    description: 'INT8 per-channel weights with INT8 activations on the 64-32-10 digit classifier.',
    lookFor: 'Agreement with the baseline stays at or near 100%; output probabilities move only slightly.',
    variants: (net) => [
      v('n1', 'W8A8 (per-channel W)', all(net, () => ({ weight: weightConfig({ format: 'int8' }), activation: activationConfig({ format: 'int8' }), arith: null }))),
      v('n2', 'BF16 weights + arithmetic', all(net, () => ({ weight: weightConfig({ format: 'bf16', scaling: 'none', overflow: 'nonsaturate' }), activation: null, arith: { ...DEFAULT_ARITH_CONFIG, productFormat: 'bf16', accumulatorFormat: 'fp32', outputFormat: 'bf16' } }))),
    ],
  },
  {
    id: 'significant',
    title: 'INT4 per-tensor scrambles the spiral',
    presetId: 'spiral',
    description: 'The tightly fitted 3-arm spiral network with INT4 weights.',
    lookFor: 'Decision regions deform and many points change class with per-tensor INT4; groups of 8 recover much of the shape.',
    variants: (net) => [
      v('n1', 'INT4 per-tensor', all(net, () => ({ weight: weightConfig({ format: 'int4', granularity: 'tensor' }), activation: null, arith: null }))),
      v('n2', 'INT4 groups of 8', all(net, () => ({ weight: weightConfig({ format: 'int4', granularity: 'group', groupSize: 8 }), activation: null, arith: null }))),
      v('n3', 'INT8 per-channel', all(net, () => ({ weight: weightConfig({ format: 'int8' }), activation: null, arith: null }))),
    ],
  },
  {
    id: 'propagation',
    title: 'Small errors grow through many layers',
    presetId: 'deep-chain',
    description: 'A 7-layer tanh chain with gain 4. Only the first layer is quantized (FP8 E4M3 weights); every later layer is exact.',
    lookFor: 'Later layers are full precision, yet they never remove the error introduced in layer 1: the per-layer relative error dips at some layers but ends several times larger at the output than after layer 1.',
    variants: (net) => [
      v('n1', 'Layer 1 weights in FP8 E4M3', all(net, (i) => ({ weight: i === 0 ? weightConfig({ format: 'fp8_e4m3', granularity: 'tensor' }) : null, activation: null, arith: null }))),
      v('n2', 'All arithmetic in BF16', all(net, () => ({ weight: null, activation: null, arith: { ...DEFAULT_ARITH_CONFIG, productFormat: 'bf16', accumulatorFormat: 'bf16', outputFormat: 'bf16' } }))),
    ],
  },
  {
    id: 'outlier',
    title: 'One outlier neuron ruins per-tensor scaling',
    presetId: 'moons-rescaled',
    description: 'A function-preserving rescaling made one hidden neuron ×32 larger. In exact arithmetic predictions are identical to the original moons network.',
    lookFor: 'Per-tensor INT4 weights flip several predictions (the outlier row takes the whole range, so the other rows get only a few levels); per-channel scaling gives each row its own scale and nearly recovers the baseline.',
    variants: (net) => [
      v('n1', 'INT4 per-tensor', all(net, () => ({ weight: weightConfig({ format: 'int4', granularity: 'tensor' }), activation: null, arith: null }))),
      v('n2', 'INT4 per-channel', all(net, () => ({ weight: weightConfig({ format: 'int4', granularity: 'channel', axis: 0 }), activation: null, arith: null }))),
    ],
  },
  {
    id: 'groups',
    title: 'Group-wise scaling improves fidelity',
    presetId: 'digits',
    description: 'INT4 weights on the digit classifier: one scale per tensor versus one per group of 16 inputs.',
    lookFor: 'Smaller groups adapt to local magnitudes: lower per-layer error and higher agreement, at the cost of more scale metadata.',
    variants: (net) => [
      v('n1', 'INT4 per-tensor', all(net, () => ({ weight: weightConfig({ format: 'int4', granularity: 'tensor' }), activation: null, arith: null }))),
      v('n2', 'INT4 per-channel', all(net, () => ({ weight: weightConfig({ format: 'int4', granularity: 'channel' }), activation: null, arith: null }))),
      v('n3', 'INT4 groups of 16', all(net, () => ({ weight: weightConfig({ format: 'int4', granularity: 'group', groupSize: 16 }), activation: null, arith: null }))),
    ],
  },
  {
    id: 'weights-vs-activations',
    title: 'Weight vs activation quantization',
    presetId: 'moons-rescaled',
    description: 'The rescaled-neuron network has an outlier both in a weight row (layer 1) and in an activation feature (input to layer 2).',
    lookFor: 'INT8 per-channel weights are harmless; per-tensor INT4 activations lose the small features next to the outlier activation.',
    variants: (net) => [
      v('n1', 'Weights only (INT8 per-channel)', all(net, () => ({ weight: weightConfig({ format: 'int8' }), activation: null, arith: null }))),
      v('n2', 'Activations only (INT4 per-tensor)', all(net, () => ({ weight: null, activation: activationConfig({ format: 'int4' }), arith: null }))),
      v('n3', 'Activations only (FP8 E4M3)', all(net, () => ({ weight: null, activation: activationConfig({ format: 'fp8_e4m3' }), arith: null }))),
    ],
  },
  {
    id: 'formats',
    title: 'Format trade-offs: INT8, FP8 E4M3, FP8 E5M2, FP4',
    presetId: 'moons',
    description: 'The same per-tensor scaled weight quantization in four element formats.',
    lookFor: 'E4M3 (more precision) has lower error than E5M2 (more range) here; FP4 E2M1 has only 15 distinct values and shifts the decision boundary.',
    variants: (net) => [
      v('n1', 'INT8', all(net, () => ({ weight: weightConfig({ format: 'int8', granularity: 'tensor' }), activation: null, arith: null }))),
      v('n2', 'FP8 E4M3', all(net, () => ({ weight: weightConfig({ format: 'fp8_e4m3', granularity: 'tensor' }), activation: null, arith: null }))),
      v('n3', 'FP8 E5M2', all(net, () => ({ weight: weightConfig({ format: 'fp8_e5m2', granularity: 'tensor' }), activation: null, arith: null }))),
      v('n4', 'FP4 E2M1', all(net, () => ({ weight: weightConfig({ format: 'fp4_e2m1', granularity: 'tensor' }), activation: null, arith: null }))),
    ],
  },
  {
    id: 'mx',
    title: 'MXFP4 vs an exact per-tensor FP4 scale',
    presetId: 'digits',
    description: 'FP4 E2M1 weights with one exact FP32 scale (amax/6) versus OCP MX blocks of 32 with power-of-two (E8M0) scales.',
    lookFor: 'On these small, well-behaved weight matrices both behave similarly: MX power-of-two scales cost up to a factor of two in resolution and can clamp a block maximum (values scaled into (6, 8) saturate to 6). Block scaling pays off when magnitudes vary strongly between blocks — compare them on the "Weight matrix with outlier rows" dataset in the Quantization Workbench.',
    variants: (net) => [
      v('n1', 'FP4 per-tensor', all(net, () => ({ weight: weightConfig({ format: 'fp4_e2m1', granularity: 'tensor' }), activation: null, arith: null }))),
      v('n2', 'MXFP4 (block 32, E8M0)', all(net, () => ({ weight: weightConfig({ format: 'fp4_e2m1', granularity: 'group', groupSize: 32, calibration: 'pow2-mx', scaleFormat: 'e8m0', overflow: 'saturate' }), activation: null, arith: null }))),
    ],
  },
];

export function applyScenario(id: string): NetworkState {
  const sc = NETWORK_SCENARIOS.find((x) => x.id === id);
  if (!sc) throw new Error(`Unknown scenario ${id}`);
  const st = networkStateFromPreset(networkPreset(sc.presetId));
  st.variants = sc.variants(st.network);
  st.activeVariantId = st.variants[0]!.id;
  return st;
}
