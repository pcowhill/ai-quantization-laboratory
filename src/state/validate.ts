/**
 * Runtime validation of experiment JSON (imports and persisted data).
 *
 * Every field is checked for type, range and allowed values; semantic checks
 * (quantization configs, network shapes, data sizes) reuse the engine
 * validators. Problems are reported with JSON paths; nothing is silently
 * repaired. Non-finite numbers and −0 are encoded in JSON as the strings
 * "NaN", "Infinity", "-Infinity" and "-0" (see `encodeJson`).
 */
import { isFormatId, isFloatFormatId } from '@/engine/formats/registry';
import { OUTLIER_METHODS } from '@/engine/calibration/outliers';
import { ACTIVATIONS, MAX_INPUTS, validateNetwork, validateNetworkQuant } from '@/engine/nn/network';
import { MAX_GENERATED_ELEMENTS, DISTRIBUTIONS } from '@/engine/random/distributions';
import { validateQuantConfig, type QuantConfig } from '@/engine/quant/types';
import { ROUNDING_MODE_IDS } from '@/engine/rounding';
import {
  SCHEMA_VERSION,
  type DataSource,
  type Experiment,
  type ExperimentFile,
  type ExperimentState,
  type Snapshot,
} from './schema';

export const MAX_DATA_ELEMENTS = MAX_GENERATED_ELEMENTS;
export const MAX_MATRIX_DIM = 64;
export const MAX_SAMPLES = 2000;

type Errors = string[];
type V<T> = (x: unknown, path: string, errs: Errors) => T;

// ------------------------------------------------------------------ JSON numbers
export function decodeNumber(x: unknown): number | undefined {
  if (typeof x === 'number') return x;
  switch (x) {
    case 'NaN':
      return NaN;
    case 'Infinity':
      return Infinity;
    case '-Infinity':
      return -Infinity;
    case '-0':
      return -0;
  }
  return undefined;
}

/** JSON.stringify that preserves NaN, ±Infinity and −0 as marker strings. */
export function encodeJson(value: unknown, space?: number): string {
  return JSON.stringify(
    value,
    function (_key, v: unknown) {
      if (typeof v === 'number') {
        if (Number.isNaN(v)) return 'NaN';
        if (v === Infinity) return 'Infinity';
        if (v === -Infinity) return '-Infinity';
        if (Object.is(v, -0)) return '-0';
      }
      return v;
    },
    space,
  );
}

// ------------------------------------------------------------------ combinators
const num =
  (opts: { min?: number; max?: number; int?: boolean; finite?: boolean } = {}): V<number> =>
  (x, path, errs) => {
    const v = decodeNumber(x);
    if (v === undefined) {
      errs.push(`${path}: expected a number`);
      return 0;
    }
    if ((opts.finite ?? true) && !Number.isFinite(v)) errs.push(`${path}: must be finite`);
    if (opts.int && !Number.isInteger(v)) errs.push(`${path}: must be an integer`);
    if (opts.min !== undefined && v < opts.min) errs.push(`${path}: must be ≥ ${opts.min}`);
    if (opts.max !== undefined && v > opts.max) errs.push(`${path}: must be ≤ ${opts.max}`);
    return v;
  };

const anyNum: V<number> = num({ finite: false });

const str =
  <T extends string = string>(allowed?: readonly string[], maxLen = 10000): V<T> =>
  (x, path, errs) => {
    if (typeof x !== 'string') {
      errs.push(`${path}: expected a string`);
      return '' as T;
    }
    if (x.length > maxLen) errs.push(`${path}: too long (max ${maxLen} characters)`);
    if (allowed && !allowed.includes(x)) errs.push(`${path}: "${x}" is not one of ${allowed.join(', ')}`);
    return x as T;
  };

const bool: V<boolean> = (x, path, errs) => {
  if (typeof x !== 'boolean') errs.push(`${path}: expected true/false`);
  return x === true;
};

const nullable =
  <T>(inner: V<T>): V<T | null> =>
  (x, path, errs) =>
    x === null ? null : inner(x, path, errs);

const arr =
  <T>(item: V<T>, opts: { min?: number; max?: number } = {}): V<T[]> =>
  (x, path, errs) => {
    if (!Array.isArray(x)) {
      errs.push(`${path}: expected an array`);
      return [];
    }
    if (opts.min !== undefined && x.length < opts.min) errs.push(`${path}: needs at least ${opts.min} entries`);
    if (opts.max !== undefined && x.length > opts.max) {
      errs.push(`${path}: at most ${opts.max} entries allowed`);
      return [];
    }
    return x.map((v, i) => item(v, `${path}[${i}]`, errs));
  };

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

const obj =
  <T>(fields: { [K in keyof T]: V<T[K]> }): V<T> =>
  (x, path, errs) => {
    if (!isObj(x)) {
      errs.push(`${path}: expected an object`);
      return {} as T;
    }
    const out = {} as T;
    for (const key of Object.keys(fields) as (keyof T)[]) {
      out[key] = fields[key](x[key as string], `${path}.${String(key)}`, errs);
    }
    return out;
  };

const record = (x: unknown, path: string, errs: Errors): Record<string, number> => {
  if (!isObj(x)) {
    errs.push(`${path}: expected an object`);
    return {};
  }
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(x)) out[k] = num()(v, `${path}.${k}`, errs);
  return out;
};

const formatId = str(['fp64', 'fp32', 'fp16', 'bf16', 'fp8_e4m3', 'fp8_e5m2', 'fp4_e2m1', 'fp8_e4m3fnuz', 'fp8_e5m2fnuz', 'int8', 'int4']);
const floatFormatId = str(['fp64', 'fp32', 'fp16', 'bf16', 'fp8_e4m3', 'fp8_e5m2', 'fp4_e2m1', 'fp8_e4m3fnuz', 'fp8_e5m2fnuz']);
const rounding = str(ROUNDING_MODE_IDS);
const overflow = str(['saturate', 'nonsaturate']);
const axis = (x: unknown, path: string, errs: Errors): 0 | 1 => num({ int: true, min: 0, max: 1 })(x, path, errs) as 0 | 1;

const quantConfigShape = obj<QuantConfig>({
  format: formatId as V<QuantConfig['format']>,
  scaling: str(['none', 'scaled']) as V<QuantConfig['scaling']>,
  scheme: str(['symmetric', 'asymmetric']) as V<QuantConfig['scheme']>,
  granularity: str(['tensor', 'channel', 'group']) as V<QuantConfig['granularity']>,
  axis,
  groupSize: num({ int: true, min: 1, max: 1 << 20 }),
  calibration: str(['minmax', 'percentile', 'mse', 'manual', 'pow2-mx']) as V<QuantConfig['calibration']>,
  percentile: num({ min: 0, max: 100 }),
  mseCandidates: num({ int: true, min: 1, max: 1000 }),
  mseMinRatio: num({ min: 0, max: 1 }),
  manualScale: num(),
  manualZeroPoint: num(),
  scaleFormat: str(['fp64', 'fp32', 'fp16', 'bf16', 'e8m0']) as V<QuantConfig['scaleFormat']>,
  rounding: rounding as V<QuantConfig['rounding']>,
  narrowRange: bool,
  overflow: overflow as V<QuantConfig['overflow']>,
  ftz: bool,
  seed: num({ int: true, min: 0, max: 4294967295 }),
});

const quantConfig: V<QuantConfig> = (x, path, errs) => {
  const before = errs.length;
  const cfg = quantConfigShape(x, path, errs);
  if (errs.length === before) {
    for (const issue of validateQuantConfig(cfg)) {
      if (issue.severity === 'error') errs.push(`${path}.${issue.field}: ${issue.message}`);
    }
  }
  return cfg;
};

const arithConfig = obj({
  productFormat: floatFormatId,
  accumulatorFormat: floatFormatId,
  outputFormat: floatFormatId,
  rounding,
  order: str(['sequential', 'pairwise', 'blocked', 'kahan']),
  blockSize: num({ int: true, min: 1, max: 1 << 20 }),
  outerFormat: floatFormatId,
  overflow,
  ftz: bool,
  seed: num({ int: true, min: 0, max: 4294967295 }),
}) as V<import('@/engine/arith/dot').ArithConfig>;

const dataSource: V<DataSource> = (x, path, errs) => {
  if (!isObj(x)) {
    errs.push(`${path}: expected an object`);
    return { kind: 'builtin', id: '' };
  }
  switch (x.kind) {
    case 'generator': {
      const g = obj({
        kind: str(['generator']) as V<'generator'>,
        distribution: str(DISTRIBUTIONS.map((d) => d.kind)) as V<import('@/engine/random/distributions').DistributionKind>,
        params: record,
        rows: num({ int: true, min: 1, max: 4096 }),
        cols: num({ int: true, min: 1, max: 1 << 20 }),
        seed: num({ int: true, min: 0, max: 4294967295 }),
      })(x, path, errs);
      if (g.rows * g.cols > MAX_DATA_ELEMENTS) errs.push(`${path}: at most ${MAX_DATA_ELEMENTS} elements`);
      return g;
    }
    case 'builtin':
      return obj({ kind: str(['builtin']) as V<'builtin'>, id: str() })(x, path, errs);
    case 'manual':
    case 'imported': {
      const d = obj({
        kind: str(['manual', 'imported']) as V<'manual'>,
        name: (v: unknown, p: string, e: Errors) => (x.kind === 'imported' ? str(undefined, 200)(v, p, e) : ''),
        rows: num({ int: true, min: 1, max: 4096 }),
        cols: num({ int: true, min: 1, max: 1 << 20 }),
        values: arr(anyNum, { min: 1, max: MAX_DATA_ELEMENTS }),
      })(x, path, errs);
      if (d.values.length !== d.rows * d.cols) errs.push(`${path}.values: expected ${d.rows}×${d.cols} = ${d.rows * d.cols} values, found ${d.values.length}`);
      if (x.kind === 'manual') return { kind: 'manual', rows: d.rows, cols: d.cols, values: d.values };
      return { kind: 'imported', name: d.name, rows: d.rows, cols: d.cols, values: d.values };
    }
    default:
      errs.push(`${path}.kind: unknown data source "${String(x.kind)}"`);
      return { kind: 'builtin', id: '' };
  }
};

const matrixOperand: V<{ rows: number; cols: number; values: number[] }> = (x, path, errs) => {
  const m = obj({
    rows: num({ int: true, min: 1, max: MAX_MATRIX_DIM }),
    cols: num({ int: true, min: 1, max: MAX_MATRIX_DIM }),
    values: arr(anyNum, { max: MAX_MATRIX_DIM * MAX_MATRIX_DIM }),
  })(x, path, errs);
  if (m.values.length !== m.rows * m.cols) errs.push(`${path}.values: expected ${m.rows * m.cols} values, found ${m.values.length}`);
  return m;
};

const layerQuant = obj({
  weight: nullable(quantConfig),
  activation: nullable(quantConfig),
  arith: nullable(arithConfig),
});

const networkDef = obj({
  inputSize: num({ int: true, min: 1, max: MAX_INPUTS }),
  layers: arr(
    obj({
      units: num({ int: true, min: 1, max: 64 }),
      activation: str(ACTIVATIONS.map((a) => a.id)) as V<import('@/engine/nn/network').Activation>,
      weights: arr(num(), { max: 64 * 64 }),
      bias: arr(num(), { max: 64 }),
    }),
    { min: 1, max: 8 },
  ),
  output: str(['softmax', 'sigmoid', 'identity']) as V<import('@/engine/nn/network').OutputMode>,
  inputNames: (x: unknown, p: string, e: Errors) => (x === undefined ? undefined : arr(str(undefined, 100), { max: 64 })(x, p, e)),
  outputNames: (x: unknown, p: string, e: Errors) => (x === undefined ? undefined : arr(str(undefined, 100), { max: 64 })(x, p, e)),
}) as V<import('@/engine/nn/network').NetworkDef>;

const stateShape = obj<ExperimentState>({
  schemaVersion: num({ int: true, min: 1, max: SCHEMA_VERSION }),
  lab: str(['inspector', 'workbench', 'matrix', 'network']) as V<ExperimentState['lab']>,
  inspector: obj({
    input: str(undefined, 5000),
    format: formatId,
    rounding,
    overflow,
    ftz: bool,
    seed: num({ int: true, min: 0, max: 4294967295 }),
    bitsOverride: nullable((x, p, e) => {
      const s = str(undefined, 32)(x, p, e);
      if (!/^[0-9a-fA-F]+$/.test(s)) e.push(`${p}: expected a hexadecimal bit pattern`);
      return s;
    }),
    compareFormats: arr(formatId, { max: 16 }),
    intScale: num({ min: 0 }),
    neighbourCount: num({ int: true, min: 0, max: 20 }),
  }) as V<ExperimentState['inspector']>,
  workbench: obj({
    source: dataSource,
    datasetId: nullable(str(undefined, 64)),
    variants: arr(obj({ id: str(undefined, 64), name: str(undefined, 200), enabled: bool, config: quantConfig }), { min: 1, max: 8 }),
    activeVariantId: str(undefined, 64),
    selected: nullable(num({ int: true, min: 0 })),
    outlierMethod: str(OUTLIER_METHODS.map((m) => m.id)),
    outlierK: num({ min: 0 }),
    histogramBins: num({ int: true, min: 4, max: 512 }),
    logCounts: bool,
  }) as V<ExperimentState['workbench']>,
  matrix: obj({
    op: str(['add', 'scale', 'dot', 'matvec', 'matmul']),
    A: matrixOperand,
    B: matrixOperand,
    scalar: num(),
    quantA: nullable(quantConfig),
    quantB: nullable(quantConfig),
    arith: arithConfig,
    integerPath: bool,
    intAccumulator: str(['int32-wrap', 'int32-saturate', 'exact']),
    selectedCell: arr(num({ int: true, min: 0 }), { min: 2, max: 2 }),
    presetId: nullable(str(undefined, 64)),
  }) as V<ExperimentState['matrix']>,
  network: obj({
    presetId: nullable(str(undefined, 64)),
    network: networkDef,
    samples: arr(arr(num(), { max: MAX_INPUTS }), { min: 1, max: MAX_SAMPLES }),
    labels: nullable(arr(num({ int: true, min: 0 }), { max: MAX_SAMPLES })),
    selectedSample: num({ int: true, min: 0 }),
    variants: arr(
      obj({
        id: str(undefined, 64),
        name: str(undefined, 200),
        enabled: bool,
        layers: arr(layerQuant, { max: 8 }),
        activationCalibration: str(['dynamic', 'static']),
      }),
      { min: 1, max: 6 },
    ),
    activeVariantId: str(undefined, 64),
    selection: nullable(obj({ layer: num({ int: true, min: 0 }), unit: nullable(num({ int: true, min: 0 })), input: nullable(num({ int: true, min: 0 })) })),
    showBoundary: bool,
  }) as V<ExperimentState['network']>,
});

/** Validates a complete experiment state, including cross-field semantics. */
export function validateState(x: unknown, path = 'state'): { state: ExperimentState; errors: string[] } {
  const errs: Errors = [];
  const state = stateShape(x, path, errs);
  if (errs.length > 0) return { state, errors: errs };
  // Semantic checks
  const net = state.network;
  for (const issue of validateNetwork(net.network)) errs.push(`${path}.network.network.${issue.path}: ${issue.message}`);
  net.samples.forEach((s, i) => {
    if (s.length !== net.network.inputSize) errs.push(`${path}.network.samples[${i}]: expected ${net.network.inputSize} values`);
  });
  if (net.labels && net.labels.length !== net.samples.length) errs.push(`${path}.network.labels: one label per sample required`);
  if (net.selectedSample >= net.samples.length) errs.push(`${path}.network.selectedSample: out of range`);
  if (errs.length === 0) {
    net.variants.forEach((v, i) => {
      for (const issue of validateNetworkQuant(net.network, { layers: v.layers, activationCalibration: v.activationCalibration })) {
        errs.push(`${path}.network.variants[${i}].${issue.path}: ${issue.message}`);
      }
    });
  }
  if (!net.variants.some((v) => v.id === net.activeVariantId)) errs.push(`${path}.network.activeVariantId: no such variant`);
  const wb = state.workbench;
  if (!wb.variants.some((v) => v.id === wb.activeVariantId)) errs.push(`${path}.workbench.activeVariantId: no such variant`);
  if (new Set(wb.variants.map((v) => v.id)).size !== wb.variants.length) errs.push(`${path}.workbench.variants: duplicate ids`);
  for (const f of state.inspector.compareFormats) if (!isFormatId(f)) errs.push(`${path}.inspector.compareFormats: unknown format ${f}`);
  if (!isFloatFormatId(state.matrix.arith.accumulatorFormat)) errs.push(`${path}.matrix.arith.accumulatorFormat: must be a floating-point format`);
  return { state, errors: errs };
}

const isoDate = (x: unknown, path: string, errs: Errors) => {
  const s = str(undefined, 64)(x, path, errs);
  if (s && Number.isNaN(Date.parse(s))) errs.push(`${path}: not a valid date`);
  return s;
};

export function validateExperiment(x: unknown, path = 'experiment'): { experiment: Experiment; errors: string[] } {
  const errs: Errors = [];
  if (!isObj(x)) return { experiment: {} as Experiment, errors: [`${path}: expected an object`] };
  const head = obj({
    id: str(undefined, 64),
    name: str(undefined, 200),
    createdAt: isoDate,
    updatedAt: isoDate,
    parentId: nullable(str(undefined, 64)),
    notes: str(undefined, 20000),
  })(x, path, errs);
  const { state, errors } = validateState(x.state, `${path}.state`);
  errs.push(...errors);
  const snapshots: Snapshot[] = [];
  if (!Array.isArray(x.snapshots)) errs.push(`${path}.snapshots: expected an array`);
  else if (x.snapshots.length > 100) errs.push(`${path}.snapshots: at most 100 snapshots`);
  else {
    x.snapshots.forEach((s: unknown, i: number) => {
      const p = `${path}.snapshots[${i}]`;
      if (!isObj(s)) {
        errs.push(`${p}: expected an object`);
        return;
      }
      const sh = obj({ id: str(undefined, 64), name: str(undefined, 200), createdAt: isoDate })(s, p, errs);
      const r = validateState(s.state, `${p}.state`);
      errs.push(...r.errors);
      snapshots.push({ ...sh, state: r.state });
    });
  }
  return { experiment: { ...head, state, snapshots }, errors: errs };
}

/** Parses an exported experiment file (JSON text). */
export function parseExperimentFile(text: string): { experiments: Experiment[]; errors: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { experiments: [], errors: [`The file is not valid JSON: ${(e as Error).message}`] };
  }
  if (!isObj(raw)) return { experiments: [], errors: ['Expected a JSON object.'] };
  if (raw.format !== 'ai-quantization-laboratory/experiment') {
    return { experiments: [], errors: ['This is not an AI Quantization Laboratory experiment file (missing "format" marker).'] };
  }
  const version = decodeNumber(raw.schemaVersion);
  if (version === undefined || !Number.isInteger(version)) return { experiments: [], errors: ['Missing schemaVersion.'] };
  if (version > SCHEMA_VERSION) {
    return { experiments: [], errors: [`The file uses schema version ${version}; this application supports up to ${SCHEMA_VERSION}. Please update the application.`] };
  }
  const migrated = migrate(raw, version);
  if (!Array.isArray(migrated.experiments) || migrated.experiments.length === 0) {
    return { experiments: [], errors: ['The file contains no experiments.'] };
  }
  const experiments: Experiment[] = [];
  const errors: string[] = [];
  migrated.experiments.forEach((e: unknown, i: number) => {
    const r = validateExperiment(e, `experiments[${i}]`);
    if (r.errors.length) errors.push(...r.errors);
    else experiments.push(r.experiment);
  });
  return { experiments: errors.length ? [] : experiments, errors };
}

/**
 * Schema migrations: each step upgrades version n to n + 1. Version 1 is the
 * first public schema, so there is nothing to migrate yet; the hook exists so
 * future versions can upgrade old files instead of rejecting them.
 */
export function migrate(raw: Record<string, unknown>, fromVersion: number): Record<string, unknown> {
  let current = raw;
  for (let v = fromVersion; v < SCHEMA_VERSION; v++) {
    current = { ...current, schemaVersion: v + 1 };
  }
  return current;
}

export function makeExperimentFile(experiments: Experiment[]): ExperimentFile {
  return {
    format: 'ai-quantization-laboratory/experiment',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    experiments,
  };
}
