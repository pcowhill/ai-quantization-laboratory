/**
 * Experiment state schema.
 *
 * An ExperimentState contains every input needed to reproduce every result in
 * every laboratory: data (or the seeded generator that produces it), formats,
 * quantization/calibration/arithmetic settings, network parameters, seeds and
 * relevant display settings. It is plain JSON (no typed arrays, no functions).
 */
import { DEFAULT_ARITH_CONFIG, type ArithConfig } from '@/engine/arith/dot';
import type { OutlierMethod } from '@/engine/calibration/outliers';
import type { IntAccumulator } from '@/engine/arith/matrix';
import type { FloatFormatId, FormatId, OverflowMode } from '@/engine/formats/types';
import type { ActivationCalibration, LayerQuant, NetworkDef } from '@/engine/nn/network';
import { makeQuantConfig, type QuantConfig } from '@/engine/quant/types';
import type { DistributionKind } from '@/engine/random/distributions';
import type { RoundingMode } from '@/engine/rounding';

export const SCHEMA_VERSION = 1;

export type LabId = 'inspector' | 'workbench' | 'matrix' | 'network';

export const LABS: { id: LabId; name: string; short: string; question: string }[] = [
  { id: 'inspector', name: 'Number Inspector', short: 'Numbers', question: 'How is this number represented?' },
  { id: 'workbench', name: 'Quantization Workbench', short: 'Quantization', question: 'What happens when I quantize it?' },
  { id: 'matrix', name: 'Matrix Laboratory', short: 'Matrices', question: 'How does that error affect matrix multiplication?' },
  { id: 'network', name: 'Neural Network Laboratory', short: 'Networks', question: "How does it affect a network's predictions?" },
];

// ---------------------------------------------------------------- Inspector
export interface InspectorState {
  /** Exact user input (decimal, hex float, fraction, inf, nan). */
  input: string;
  format: FormatId;
  rounding: RoundingMode;
  overflow: OverflowMode;
  ftz: boolean;
  seed: number;
  /** When non-null, the bit pattern (hex) the user edited directly; takes precedence over `input`. */
  bitsOverride: string | null;
  /** Formats shown in the comparison table. */
  compareFormats: FormatId[];
  /** Integer formats: scale used to map the real value to an integer (q = round(x / scale)). */
  intScale: number;
  /** Number of neighbours shown on each side. */
  neighbourCount: number;
}

// ---------------------------------------------------------------- Data sources
export type DataSource =
  | { kind: 'generator'; distribution: DistributionKind; params: Record<string, number>; rows: number; cols: number; seed: number }
  | { kind: 'builtin'; id: string }
  | { kind: 'manual'; rows: number; cols: number; values: number[] }
  | { kind: 'imported'; name: string; rows: number; cols: number; values: number[] };

export interface QuantVariant {
  id: string;
  name: string;
  enabled: boolean;
  config: QuantConfig;
}

// ---------------------------------------------------------------- Workbench
export interface WorkbenchState {
  source: DataSource;
  /** Catalog entry the source came from (null when edited/custom). */
  datasetId: string | null;
  variants: QuantVariant[];
  activeVariantId: string;
  /** Selected element index (row-major) or null. */
  selected: number | null;
  outlierMethod: OutlierMethod;
  outlierK: number;
  histogramBins: number;
  logCounts: boolean;
}

// ---------------------------------------------------------------- Matrix
export type MatrixOp = 'add' | 'scale' | 'dot' | 'matvec' | 'matmul';

export interface MatrixOperand {
  rows: number;
  cols: number;
  values: number[];
}

export interface MatrixState {
  op: MatrixOp;
  A: MatrixOperand;
  B: MatrixOperand;
  scalar: number;
  /** Operand storage quantization (null = keep FP64). */
  quantA: QuantConfig | null;
  quantB: QuantConfig | null;
  arith: ArithConfig;
  /** Integer kernel path (both operands INT-quantized). */
  integerPath: boolean;
  intAccumulator: IntAccumulator;
  selectedCell: [number, number];
  presetId: string | null;
}

// ---------------------------------------------------------------- Network
export interface NetworkVariant {
  id: string;
  name: string;
  enabled: boolean;
  layers: LayerQuant[];
  activationCalibration: ActivationCalibration;
}

export interface NetworkState {
  presetId: string | null;
  network: NetworkDef;
  /** Evaluation inputs (rows of length inputSize). */
  samples: number[][];
  /** Optional class labels for the samples. */
  labels: number[] | null;
  selectedSample: number;
  variants: NetworkVariant[];
  activeVariantId: string;
  /** Selected element for inspection. */
  selection: { layer: number; unit: number | null; input: number | null } | null;
  showBoundary: boolean;
}

// ---------------------------------------------------------------- Experiment
export interface ExperimentState {
  schemaVersion: number;
  lab: LabId;
  inspector: InspectorState;
  workbench: WorkbenchState;
  matrix: MatrixState;
  network: NetworkState;
}

export interface Snapshot {
  id: string;
  name: string;
  createdAt: string;
  state: ExperimentState;
}

export interface Experiment {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  /** Experiment this one was branched/duplicated from. */
  parentId: string | null;
  notes: string;
  state: ExperimentState;
  snapshots: Snapshot[];
}

/** Export envelope written by "Export experiment". */
export interface ExperimentFile {
  format: 'ai-quantization-laboratory/experiment';
  schemaVersion: number;
  exportedAt: string;
  experiments: Experiment[];
}

// ---------------------------------------------------------------- Defaults
export function defaultInspector(): InspectorState {
  return {
    input: '0.1',
    format: 'fp16',
    rounding: 'nearest-even',
    overflow: 'nonsaturate',
    ftz: false,
    seed: 1,
    bitsOverride: null,
    compareFormats: ['fp64', 'fp32', 'fp16', 'bf16', 'fp8_e4m3', 'fp8_e5m2', 'fp4_e2m1', 'int8', 'int4'],
    intScale: 1,
    neighbourCount: 3,
  };
}

export function defaultWorkbench(): WorkbenchState {
  return {
    source: { kind: 'generator', distribution: 'normal', params: { mean: 0, std: 1 }, rows: 16, cols: 64, seed: 42 },
    datasetId: 'normal',
    variants: [
      { id: 'v1', name: 'INT8 per-tensor', enabled: true, config: makeQuantConfig({ format: 'int8' }) },
      { id: 'v2', name: 'INT4 per-tensor', enabled: true, config: makeQuantConfig({ format: 'int4' }) },
      { id: 'v3', name: 'FP8 E4M3 per-tensor', enabled: true, config: makeQuantConfig({ format: 'fp8_e4m3' }) },
    ],
    activeVariantId: 'v1',
    selected: null,
    outlierMethod: 'zscore',
    outlierK: 4,
    histogramBins: 64,
    logCounts: false,
  };
}

export function defaultMatrix(): MatrixState {
  return {
    op: 'matmul',
    A: { rows: 3, cols: 4, values: [0.5, -1.25, 2, 0.1, 1.5, 0.3, -0.7, 3.2, -2.2, 0.05, 1.1, -0.4] },
    B: { rows: 4, cols: 2, values: [1.2, -0.3, 0.4, 2.5, -1.1, 0.6, 0.9, -0.05] },
    scalar: 0.1,
    quantA: makeQuantConfig({ format: 'int8', granularity: 'channel', axis: 0 }),
    quantB: makeQuantConfig({ format: 'int8', granularity: 'channel', axis: 1 }),
    arith: { ...DEFAULT_ARITH_CONFIG },
    integerPath: false,
    intAccumulator: 'int32-wrap',
    selectedCell: [0, 0],
    presetId: null,
  };
}

export const FLOAT_ARITH_FORMATS: FloatFormatId[] = ['fp64', 'fp32', 'fp16', 'bf16', 'fp8_e4m3', 'fp8_e5m2'];
