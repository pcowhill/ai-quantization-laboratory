import type { FormatId, OverflowMode } from '../formats/types';
import { getFormat, isFloatFormatId, isFormatId } from '../formats/registry';
import { isRoundingMode, type RoundingMode } from '../rounding';

export type Granularity = 'tensor' | 'channel' | 'group';
export type QuantScheme = 'symmetric' | 'asymmetric';
export type Scaling = 'none' | 'scaled';
export type CalibrationMethod = 'minmax' | 'percentile' | 'mse' | 'manual' | 'pow2-mx';
export type ScaleFormat = 'fp64' | 'fp32' | 'fp16' | 'bf16' | 'e8m0';

/**
 * Complete description of a quantization scheme for one tensor.
 *
 * Tensors are 2-D and row-major with shape [rows, cols] (a vector is [1, n]).
 * - granularity `tensor`: one scale (and zero-point) for the whole tensor.
 * - granularity `channel`: one per slice along `axis` (axis 0 → one per row,
 *   axis 1 → one per column).
 * - granularity `group`: each channel slice along `axis` is divided into
 *   contiguous groups of `groupSize` elements along the other axis (axis 0 →
 *   groups run along each row). The last group of a slice may be shorter.
 */
export interface QuantConfig {
  format: FormatId;
  /** `none` = direct cast to a floating-point format without any scale. */
  scaling: Scaling;
  scheme: QuantScheme;
  granularity: Granularity;
  axis: 0 | 1;
  groupSize: number;
  calibration: CalibrationMethod;
  /** Percentile used by `percentile` calibration, in (0, 100]. */
  percentile: number;
  /** Number of clipping ratios evaluated by `mse` calibration. */
  mseCandidates: number;
  /** Smallest clipping ratio evaluated by `mse` calibration, in (0, 1]. */
  mseMinRatio: number;
  manualScale: number;
  manualZeroPoint: number;
  /** Precision in which scales are stored (they are rounded to it). */
  scaleFormat: ScaleFormat;
  rounding: RoundingMode;
  /** Integer targets: restrict codes to [−qmax, qmax]. */
  narrowRange: boolean;
  /** Floating-point targets: saturating or non-saturating overflow. */
  overflow: OverflowMode;
  /** Floating-point targets: flush subnormal results to zero. */
  ftz: boolean;
  /** Seed for stochastic rounding. */
  seed: number;
}

export const DEFAULT_QUANT_CONFIG: QuantConfig = {
  format: 'int8',
  scaling: 'scaled',
  scheme: 'symmetric',
  granularity: 'tensor',
  axis: 0,
  groupSize: 32,
  calibration: 'minmax',
  percentile: 99.9,
  mseCandidates: 100,
  mseMinRatio: 0.2,
  manualScale: 0.01,
  manualZeroPoint: 0,
  scaleFormat: 'fp32',
  rounding: 'nearest-even',
  narrowRange: false,
  overflow: 'saturate',
  ftz: false,
  seed: 1,
};

export function makeQuantConfig(partial: Partial<QuantConfig> = {}): QuantConfig {
  return { ...DEFAULT_QUANT_CONFIG, ...partial };
}

export interface ConfigIssue {
  field: keyof QuantConfig;
  severity: 'error' | 'warning';
  message: string;
}

export class QuantConfigError extends Error {
  constructor(readonly issues: ConfigIssue[]) {
    super(issues.map((i) => i.message).join(' '));
    this.name = 'QuantConfigError';
  }
}

export const MAX_MSE_CANDIDATES = 1000;

/**
 * Lists every problem with a configuration. Invalid combinations are
 * reported, never silently changed.
 */
export function validateQuantConfig(cfg: QuantConfig, shape?: [number, number]): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const err = (field: keyof QuantConfig, message: string) => issues.push({ field, severity: 'error', message });
  if (!isFormatId(cfg.format)) {
    err('format', `Unknown format "${String(cfg.format)}".`);
    return issues;
  }
  const isFloat = isFloatFormatId(cfg.format);
  const fmt = getFormat(cfg.format);
  if (!isRoundingMode(cfg.rounding)) err('rounding', `Unknown rounding mode "${String(cfg.rounding)}".`);
  if (cfg.scaling !== 'none' && cfg.scaling !== 'scaled') err('scaling', 'Scaling must be "none" or "scaled".');
  if (!isFloat && cfg.scaling === 'none') {
    err('scaling', `${fmt.name} is an integer format: a scale is required to map real values onto integers.`);
  }
  if (cfg.scheme !== 'symmetric' && cfg.scheme !== 'asymmetric') err('scheme', 'Scheme must be symmetric or asymmetric.');
  if (isFloat && cfg.scheme === 'asymmetric' && cfg.scaling === 'scaled') {
    err('scheme', 'Asymmetric (zero-point) quantization is defined here for integer targets only; floating-point targets use a scale without zero-point.');
  }
  if (cfg.scaling === 'scaled') {
    if (!['tensor', 'channel', 'group'].includes(cfg.granularity)) err('granularity', 'Unknown granularity.');
    if (cfg.axis !== 0 && cfg.axis !== 1) err('axis', 'Axis must be 0 or 1.');
    if (cfg.granularity === 'group') {
      if (!Number.isInteger(cfg.groupSize) || cfg.groupSize < 1) err('groupSize', 'Group size must be a positive integer.');
      else if (shape) {
        const len = cfg.axis === 0 ? shape[1] : shape[0];
        if (cfg.groupSize > len) {
          issues.push({
            field: 'groupSize',
            severity: 'warning',
            message: `Group size ${cfg.groupSize} exceeds the slice length ${len}; each slice forms a single (shorter) group, equivalent to per-channel scaling.`,
          });
        } else if (len % cfg.groupSize !== 0) {
          issues.push({
            field: 'groupSize',
            severity: 'warning',
            message: `Slice length ${len} is not a multiple of group size ${cfg.groupSize}; the last group in each slice has ${len % cfg.groupSize} elements.`,
          });
        }
      }
    }
    switch (cfg.calibration) {
      case 'minmax':
        break;
      case 'percentile':
        if (!(cfg.percentile > 0 && cfg.percentile <= 100)) err('percentile', 'Percentile must be in (0, 100].');
        break;
      case 'mse':
        if (!Number.isInteger(cfg.mseCandidates) || cfg.mseCandidates < 1 || cfg.mseCandidates > MAX_MSE_CANDIDATES) {
          err('mseCandidates', `MSE search needs between 1 and ${MAX_MSE_CANDIDATES} candidates.`);
        }
        if (!(cfg.mseMinRatio > 0 && cfg.mseMinRatio <= 1)) err('mseMinRatio', 'Smallest clipping ratio must be in (0, 1].');
        break;
      case 'manual':
        if (!(Number.isFinite(cfg.manualScale) && cfg.manualScale > 0)) err('manualScale', 'Scale must be a finite positive number.');
        if (!isFloat && cfg.scheme === 'asymmetric' && fmt.kind === 'int') {
          const qmin = cfg.narrowRange ? -fmt.max : fmt.min;
          if (!Number.isInteger(cfg.manualZeroPoint) || cfg.manualZeroPoint < qmin || cfg.manualZeroPoint > fmt.max) {
            err('manualZeroPoint', `Zero-point must be an integer in [${qmin}, ${fmt.max}].`);
          }
        }
        break;
      case 'pow2-mx':
        if (cfg.scheme === 'asymmetric') err('calibration', 'The MX power-of-two scale rule is symmetric (no zero-point).');
        break;
      default:
        err('calibration', 'Unknown calibration method.');
    }
    if (!['fp64', 'fp32', 'fp16', 'bf16', 'e8m0'].includes(cfg.scaleFormat)) err('scaleFormat', 'Unknown scale format.');
  }
  if (cfg.rounding === 'stochastic' && !Number.isFinite(cfg.seed)) err('seed', 'Stochastic rounding needs a finite seed.');
  return issues;
}

export function assertValidConfig(cfg: QuantConfig, shape?: [number, number]): void {
  const errors = validateQuantConfig(cfg, shape).filter((i) => i.severity === 'error');
  if (errors.length > 0) throw new QuantConfigError(errors);
}
