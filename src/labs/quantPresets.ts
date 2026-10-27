import type { QuantConfig } from '@/engine/quant/types';

export interface QuantPreset {
  id: string;
  name: string;
  description: string;
  config: Partial<QuantConfig>;
}

const BASE: Partial<QuantConfig> = { rounding: 'nearest-even', ftz: false, narrowRange: false };

export const QUANT_PRESETS: QuantPreset[] = [
  { id: 'int8-tensor', name: 'INT8 symmetric, per-tensor', description: 'One FP32 scale for the whole tensor.', config: { ...BASE, format: 'int8', scaling: 'scaled', scheme: 'symmetric', granularity: 'tensor', calibration: 'minmax', scaleFormat: 'fp32' } },
  { id: 'int8-channel', name: 'INT8 symmetric, per-channel (rows)', description: 'One FP32 scale per row (e.g. per output channel of W[out, in]).', config: { ...BASE, format: 'int8', scaling: 'scaled', scheme: 'symmetric', granularity: 'channel', axis: 0, calibration: 'minmax', scaleFormat: 'fp32' } },
  { id: 'int8-asym', name: 'INT8 asymmetric, per-tensor', description: 'Scale and zero-point for one-sided or offset data.', config: { ...BASE, format: 'int8', scaling: 'scaled', scheme: 'asymmetric', granularity: 'tensor', calibration: 'minmax', scaleFormat: 'fp32' } },
  { id: 'int4-g128', name: 'INT4 asymmetric, groups of 128 (FP16 scales)', description: 'A common weight-only layout: groups of 128 along each row, FP16 scale and INT4 zero-point per group. (Layout only — no GPTQ/AWQ optimisation.)', config: { ...BASE, format: 'int4', scaling: 'scaled', scheme: 'asymmetric', granularity: 'group', axis: 0, groupSize: 128, calibration: 'minmax', scaleFormat: 'fp16' } },
  { id: 'int4-g32', name: 'INT4 symmetric, groups of 32', description: 'Small groups adapt the scale to local magnitude.', config: { ...BASE, format: 'int4', scaling: 'scaled', scheme: 'symmetric', granularity: 'group', axis: 0, groupSize: 32, calibration: 'minmax', scaleFormat: 'fp16' } },
  { id: 'fp8-e4m3-tensor', name: 'FP8 E4M3, per-tensor scale', description: 'Scale = amax / 448 (FP32), saturating conversion.', config: { ...BASE, format: 'fp8_e4m3', scaling: 'scaled', scheme: 'symmetric', granularity: 'tensor', calibration: 'minmax', scaleFormat: 'fp32', overflow: 'saturate' } },
  { id: 'fp8-e5m2-tensor', name: 'FP8 E5M2, per-tensor scale', description: 'Wider range, less precision; scale = amax / 57344.', config: { ...BASE, format: 'fp8_e5m2', scaling: 'scaled', scheme: 'symmetric', granularity: 'tensor', calibration: 'minmax', scaleFormat: 'fp32', overflow: 'saturate' } },
  { id: 'mxfp8-e4m3', name: 'MXFP8 (E4M3), OCP MX v1.0', description: 'Blocks of 32, E8M0 power-of-two shared scale per OCP MX §6.3, saturating E4M3 elements, RNE.', config: { ...BASE, format: 'fp8_e4m3', scaling: 'scaled', scheme: 'symmetric', granularity: 'group', axis: 0, groupSize: 32, calibration: 'pow2-mx', scaleFormat: 'e8m0', overflow: 'saturate' } },
  { id: 'mxfp8-e5m2', name: 'MXFP8 (E5M2), OCP MX v1.0', description: 'Blocks of 32, E8M0 scales, saturating E5M2 elements, RNE.', config: { ...BASE, format: 'fp8_e5m2', scaling: 'scaled', scheme: 'symmetric', granularity: 'group', axis: 0, groupSize: 32, calibration: 'pow2-mx', scaleFormat: 'e8m0', overflow: 'saturate' } },
  { id: 'mxfp4', name: 'MXFP4 (E2M1), OCP MX v1.0', description: 'Blocks of 32, E8M0 power-of-two scale per OCP MX §6.3, FP4 E2M1 elements (saturating), RNE: 4.25 bits/value.', config: { ...BASE, format: 'fp4_e2m1', scaling: 'scaled', scheme: 'symmetric', granularity: 'group', axis: 0, groupSize: 32, calibration: 'pow2-mx', scaleFormat: 'e8m0', overflow: 'saturate' } },
  { id: 'mxint8', name: 'MXINT8-equivalent, OCP MX v1.0', description: 'Blocks of 32, E8M0 scales, symmetric INT8 [−127, 127]. (MX INT8 carries an implicit 2^−6; here it is folded into the power-of-two scale, which is numerically equivalent.)', config: { ...BASE, format: 'int8', scaling: 'scaled', scheme: 'symmetric', narrowRange: true, granularity: 'group', axis: 0, groupSize: 32, calibration: 'pow2-mx', scaleFormat: 'e8m0' } },
  { id: 'bf16-cast', name: 'BF16 cast', description: 'Plain conversion to BF16, no scale.', config: { ...BASE, format: 'bf16', scaling: 'none', overflow: 'nonsaturate' } },
  { id: 'fp16-cast', name: 'FP16 cast', description: 'Plain conversion to FP16, no scale (watch for overflow above 65504).', config: { ...BASE, format: 'fp16', scaling: 'none', overflow: 'nonsaturate' } },
  { id: 'fp8-cast', name: 'FP8 E4M3 cast (no scale)', description: 'Direct conversion: values outside ±448 saturate, tiny values underflow.', config: { ...BASE, format: 'fp8_e4m3', scaling: 'none', overflow: 'saturate' } },
];
