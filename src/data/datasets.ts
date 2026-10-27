/**
 * Curated dataset catalog for the Quantization Workbench. Entries are either
 * seeded generator configurations (editable) or fixed built-in tensors.
 * Every entry is deterministic.
 */
import { defaultParams, generate, type DistributionKind } from '@/engine/random/distributions';
import { NETWORK_PRESETS } from './networks';
import type { DataSource } from '@/state/schema';

export type DatasetCategory = 'Ordinary' | 'Edge cases' | 'Pathological' | 'Model-like';

export interface DatasetEntry {
  id: string;
  name: string;
  category: DatasetCategory;
  description: string;
  /** What to look for when quantizing this data. */
  tip?: string;
  source: DataSource;
}

export interface BuiltinTensor {
  id: string;
  rows: number;
  cols: number;
  build: () => number[];
}

const gen = (distribution: DistributionKind, rows: number, cols: number, seed: number, params: Record<string, number> = {}): DataSource => ({
  kind: 'generator',
  distribution,
  params: { ...defaultParams(distribution), ...params },
  rows,
  cols,
  seed,
});

function layerWeights(presetId: string, layer: number): { rows: number; cols: number; values: number[] } {
  const p = NETWORK_PRESETS.find((n) => n.id === presetId)!;
  const l = p.network.layers[layer]!;
  return { rows: l.units, cols: l.weights.length / l.units, values: l.weights };
}

export const BUILTIN_TENSORS: BuiltinTensor[] = [
  {
    id: 'hand-vector',
    rows: 1,
    cols: 12,
    build: () => [0.1, -0.25, 1, 3.14159, -7.5, 0.003, 42, -0.0001, 0, 2.5, -2.5, 100],
  },
  { id: 'ramp', rows: 1, cols: 256, build: () => Array.from({ length: 256 }, (_, i) => -1 + (2 * i) / 255) },
  {
    id: 'powers-of-two',
    rows: 2,
    cols: 41,
    build: () => [...Array.from({ length: 41 }, (_, i) => 2 ** (i - 20)), ...Array.from({ length: 41 }, (_, i) => -(2 ** (i - 20)))],
  },
  { id: 'tenths', rows: 1, cols: 20, build: () => Array.from({ length: 20 }, (_, i) => parseFloat(`${Math.floor((i + 1) / 10)}.${(i + 1) % 10}`)) },
  {
    id: 'fp16-edges',
    rows: 1,
    cols: 12,
    build: () => [65504, 65519, 65520, 70000, 6.103515625e-5, 6.0e-5, 5.960464477539063e-8, 2.9802322387695312e-8, 1e-9, -65504, 0, -0],
  },
  { id: 'specials', rows: 1, cols: 8, build: () => [1, NaN, Infinity, -Infinity, -0, 0, 3, -2] },
  { id: 'constant', rows: 4, cols: 16, build: () => new Array(64).fill(3.7) },
  { id: 'zeros', rows: 4, cols: 16, build: () => new Array(64).fill(0) },
  {
    id: 'single-outlier',
    rows: 1,
    cols: 1024,
    build: () => {
      const v = Array.from(generate({ kind: 'normal', params: { mean: 0, std: 1 }, rows: 1, cols: 1024, seed: 7 }));
      v[517] = 200;
      return v;
    },
  },
  { id: 'digits-w1', ...shape(() => layerWeights('digits', 0)) },
  { id: 'spiral-w2', ...shape(() => layerWeights('spiral', 1)) },
  { id: 'moons-w1-rescaled', ...shape(() => layerWeights('moons-rescaled', 0)) },
  {
    id: 'digit-image',
    rows: 8,
    cols: 8,
    build: () => NETWORK_PRESETS.find((n) => n.id === 'digits')!.samples[0]!,
  },
];

function shape(f: () => { rows: number; cols: number; values: number[] }) {
  const s = f();
  return { rows: s.rows, cols: s.cols, build: () => [...f().values] };
}

export const DATASETS: DatasetEntry[] = [
  { id: 'normal', name: 'Normal N(0, 1), 16×64', category: 'Ordinary', description: 'Standard normal values.', source: gen('normal', 16, 64, 42) },
  { id: 'uniform', name: 'Uniform U(−1, 1), 16×64', category: 'Ordinary', description: 'Evenly spread values: the friendliest case for uniform quantization grids.', source: gen('uniform', 16, 64, 42) },
  { id: 'ramp', name: 'Linear ramp −1 … 1 (256 points)', category: 'Ordinary', description: 'Equally spaced values; the scatter plot shows the quantization staircase clearly.', source: { kind: 'builtin', id: 'ramp' } },
  { id: 'bimodal', name: 'Bimodal mixture', category: 'Ordinary', description: 'Two clusters at ±2.', source: gen('bimodal', 16, 64, 42) },
  { id: 'hand-vector', name: 'Hand-picked vector (12 values)', category: 'Ordinary', description: 'A small vector mixing tiny, ordinary and large values — easy to inspect element by element.', source: { kind: 'builtin', id: 'hand-vector' } },
  { id: 'powers-of-two', name: 'Powers of two 2^−20 … 2^20', category: 'Edge cases', description: 'Exactly representable in binary floating point when within range; integer grids crush the small ones to zero.', tip: 'Compare FP8 E4M3 with INT8: the float grid keeps relative precision across binades.', source: { kind: 'builtin', id: 'powers-of-two' } },
  { id: 'tenths', name: 'Decimal tenths 0.1 … 2.0', category: 'Edge cases', description: 'Decimal fractions that are not exactly representable in binary.', source: { kind: 'builtin', id: 'tenths' } },
  { id: 'fp16-edges', name: 'FP16 limits and boundaries', category: 'Edge cases', description: 'Values at and around the FP16 overflow threshold (65520) and subnormal range.', tip: 'Cast to FP16 without scaling, then switch overflow mode.', source: { kind: 'builtin', id: 'fp16-edges' } },
  { id: 'specials', name: 'NaN, ±∞ and signed zeros', category: 'Edge cases', description: 'Special values: see how each format and scheme handles them (they are flagged and excluded from calibration and metrics).', source: { kind: 'builtin', id: 'specials' } },
  { id: 'constant', name: 'Constant tensor (all 3.7)', category: 'Edge cases', description: 'A zero-width range: calibration must not divide by zero.', source: { kind: 'builtin', id: 'constant' } },
  { id: 'zeros', name: 'All zeros', category: 'Edge cases', description: 'Degenerate blocks: any scale reproduces zero exactly.', source: { kind: 'builtin', id: 'zeros' } },
  { id: 'single-outlier', name: 'Normal + one outlier (200σ)', category: 'Pathological', description: '1023 standard-normal values plus a single value of 200.', tip: 'With per-tensor min/max INT8 most values collapse onto a handful of levels. Try percentile or MSE calibration, or groups of 32.', source: { kind: 'builtin', id: 'single-outlier' } },
  { id: 'outliers', name: 'Outlier-heavy normal (1% at 50σ)', category: 'Pathological', description: 'A small fraction of values drawn with 50× larger σ.', source: gen('outliers', 16, 256, 42) },
  { id: 'sparse', name: 'Sparse (95% zeros)', category: 'Pathological', description: 'Mostly exact zeros: zero must stay exactly representable.', source: gen('sparse', 16, 64, 42, { density: 0.05 }) },
  { id: 'narrow', name: 'Narrow band 1.000 ± 0.001', category: 'Pathological', description: 'All values close to 1: symmetric grids waste range, low-precision floats lose the variation entirely.', tip: 'Compare symmetric vs asymmetric INT8, and BF16 vs FP16 casts.', source: gen('narrow', 8, 64, 42) },
  { id: 'lognormal', name: 'Log-normal, σ = 2.5', category: 'Pathological', description: 'Positive values spanning many orders of magnitude.', tip: 'Floating-point formats shine; uniform integer grids do not.', source: gen('lognormal', 16, 64, 42, { sigma: 2.5 }) },
  { id: 'student-t', name: "Student's t, ν = 2 (heavy tails)", category: 'Pathological', description: 'Power-law tails produce frequent extreme values.', source: gen('student-t', 16, 128, 42, { dof: 2 }) },
  { id: 'exponential', name: 'Exponential (skewed)', category: 'Pathological', description: 'All positive with a long right tail: asymmetric schemes avoid wasting the negative half of the grid.', source: gen('exponential', 16, 64, 42) },
  { id: 'model-weights', name: 'Weight matrix with outlier rows', category: 'Model-like', description: '64×256 fan-in-scaled normal weights; 5% of output channels (rows) are 8× larger.', tip: 'Per-tensor vs per-channel (axis 0) INT4.', source: gen('model-weights', 64, 256, 42) },
  { id: 'model-activations', name: 'Activations with outlier features', category: 'Model-like', description: '32 tokens × 128 features; two feature columns carry ~60× larger values.', tip: 'Per-tensor INT8 loses the ordinary features. Per-channel along axis 1 (per feature) fixes it — but real kernels often cannot scale activations per input feature.', source: gen('model-activations', 32, 128, 42) },
  { id: 'relu', name: 'Post-ReLU activations', category: 'Model-like', description: 'Half exact zeros, half positive values.', source: gen('relu', 16, 64, 42) },
  { id: 'laplace', name: 'Laplace-distributed weights', category: 'Model-like', description: 'Peaked distribution with heavier tails, typical of trained weights.', source: gen('laplace', 32, 128, 42, { scale: 0.05 }) },
  { id: 'digits-w1', name: 'Trained weights: digits MLP layer 1 (32×64)', category: 'Model-like', description: 'Real trained weights from the 8×8 digit classifier preset.', source: { kind: 'builtin', id: 'digits-w1' } },
  { id: 'spiral-w2', name: 'Trained weights: spiral MLP layer 2 (32×32)', category: 'Model-like', description: 'Real trained weights from the spiral classifier preset.', source: { kind: 'builtin', id: 'spiral-w2' } },
  { id: 'moons-w1-rescaled', name: 'Weights with a rescaled neuron (16×2)', category: 'Model-like', description: 'Two-moons layer 1 after a function-preserving ×32 rescaling of one neuron: one huge row.', source: { kind: 'builtin', id: 'moons-w1-rescaled' } },
  { id: 'digit-image', name: 'An 8×8 digit image (activations)', category: 'Model-like', description: 'Pixel intensities in [0, 1] — the input to the digits network.', source: { kind: 'builtin', id: 'digit-image' } },
];

export function builtinTensor(id: string): BuiltinTensor | undefined {
  return BUILTIN_TENSORS.find((b) => b.id === id);
}
