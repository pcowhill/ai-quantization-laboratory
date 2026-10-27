/**
 * Tensor quantization: calibration of per-block scales/zero-points and
 * element-wise quantization / dequantization.
 *
 * Integer targets (affine quantization):
 *     q = clamp(round(x / s) + z, qmin, qmax)        x̂ = s · (q − z)
 * Floating-point targets (scaled format conversion):
 *     q = convert_fmt(x / s)                          x̂ = s · q
 * Floating-point targets without scaling (plain cast):
 *     q = convert_fmt(x)                              x̂ = q
 *
 * The divisions x / s and products s · q are evaluated in FP64 (correctly
 * rounded); `round` / `convert_fmt` use the configured rounding mode exactly.
 */
import { exponentOf, isPowerOfTwo, pow2 } from '../float/double';
import { lastRound, roundFloat, RoundFlag, type RoundOptions } from '../float/round';
import { characteristics, FLOAT_FORMATS, getFormat } from '../formats/registry';
import type { FloatFormat, IntFormat } from '../formats/types';
import { intRange } from '../int/codec';
import { percentileSorted } from '../metrics/stats';
import { Rng } from '../random/prng';
import { roundToInteger, type RoundingMode } from '../rounding';
import { computeLayout, gatherBlocks, type BlockLayout } from './layout';
import { assertValidConfig, type QuantConfig, type ScaleFormat } from './types';

export interface MseSearchPoint {
  ratio: number;
  mse: number;
}

export interface BlockParams {
  /** Scale actually used (after rounding to the scale storage format). */
  scale: number;
  /** Scale before rounding to the storage format. */
  rawScale: number;
  zeroPoint: number;
  /** Real-valued clipping range chosen by calibration. */
  rangeLow: number;
  rangeHigh: number;
  /** Real values covered by the code grid with this scale/zero-point. */
  representableLow: number;
  representableHigh: number;
  /** All-zero block (any scale reproduces it exactly); a scale of 1 is used. */
  degenerate: boolean;
  scaleUnderflow: boolean;
  scaleOverflow: boolean;
  /** Number of elements in the block (including non-finite ones). */
  count: number;
  /** Elements whose quantized value was clamped/saturated. */
  saturated: number;
  /** MSE calibration trace (only when calibration = 'mse'). */
  search?: MseSearchPoint[];
  chosenRatio?: number;
}

export interface QuantResult {
  config: QuantConfig;
  shape: [number, number];
  original: Float64Array;
  /** Integer codes (int targets) or element values in the target format (float targets). */
  q: Float64Array;
  /** Dequantized (reconstructed) values. */
  recon: Float64Array;
  /** Per-element RoundFlag bitmask. */
  flags: Uint16Array;
  layout: BlockLayout;
  params: BlockParams[];
}

interface ElementContext {
  isFloat: boolean;
  floatFmt: FloatFormat | null;
  intFmt: IntFormat | null;
  qmin: number;
  qmax: number;
  /** Largest finite magnitude of the element grid (float max or int qmax). */
  gridMax: number;
  roundOpts: RoundOptions;
  mode: RoundingMode;
}

function makeContext(cfg: QuantConfig, rng?: Rng): ElementContext {
  const fmt = getFormat(cfg.format);
  const roundOpts: RoundOptions = {
    mode: cfg.rounding,
    overflow: cfg.overflow,
    ftz: cfg.ftz,
    rng: rng ? () => rng.next() : undefined,
  };
  if (fmt.kind === 'float') {
    const c = characteristics(fmt);
    return {
      isFloat: true,
      floatFmt: fmt,
      intFmt: null,
      qmin: -c.maxFinite,
      qmax: c.maxFinite,
      gridMax: c.maxFinite,
      roundOpts,
      mode: cfg.rounding,
    };
  }
  const { qmin, qmax } = intRange(fmt, cfg.narrowRange);
  return { isFloat: false, floatFmt: null, intFmt: fmt, qmin, qmax, gridMax: qmax, roundOpts, mode: cfg.rounding };
}

/** Rounds a scale to its storage format. */
export function storeScale(s: number, scaleFormat: ScaleFormat): { scale: number; underflow: boolean; overflow: boolean } {
  if (scaleFormat === 'fp64') return { scale: s, underflow: false, overflow: false };
  if (scaleFormat === 'e8m0') {
    // E8M0 holds only powers of two 2^k, k ∈ [−127, 127]. Round the scale UP to
    // the next power of two so the calibrated range is still covered.
    let k = exponentOf(s);
    if (!isPowerOfTwo(s)) k += 1;
    const underflow = k < -127;
    const overflow = k > 127;
    k = Math.min(127, Math.max(-127, k));
    return { scale: pow2(k), underflow, overflow };
  }
  const fmt = FLOAT_FORMATS[scaleFormat];
  const c = characteristics(fmt);
  let v = roundFloat(fmt, s, { mode: 'nearest-even', overflow: 'saturate' });
  const overflow = (lastRound.flags & RoundFlag.Saturated) !== 0;
  let underflow = false;
  if (v === 0) {
    v = c.minSubnormal;
    underflow = true;
  }
  return { scale: v, underflow, overflow };
}

/** Quantizes one element; writes flags to `out.flags`. Returns the code / element value. */
function quantizeElement(
  x: number,
  scale: number,
  zp: number,
  ctx: ElementContext,
  scaled: boolean,
  out: { flags: number; recon: number },
): number {
  if (ctx.isFloat) {
    const fmt = ctx.floatFmt!;
    const y = scaled ? x / scale : x;
    const q = roundFloat(fmt, y, ctx.roundOpts);
    let flags = lastRound.flags;
    if (Number.isNaN(x)) flags |= RoundFlag.Invalid;
    out.flags = flags;
    out.recon = scaled ? q * scale : q;
    return q;
  }
  if (Number.isNaN(x)) {
    // NaN has no integer encoding (OCP MX §5.3.4: implementation-defined). Map to the zero-point.
    out.flags = RoundFlag.Invalid;
    out.recon = 0;
    return zp;
  }
  const y = x / scale;
  let flags = 0;
  let r: number;
  if (!Number.isFinite(y)) {
    r = y > 0 ? ctx.qmax - zp + 1 : ctx.qmin - zp - 1;
    flags |= RoundFlag.Inexact;
  } else {
    r = roundToInteger(y, ctx.mode, ctx.roundOpts.rng);
    if (r !== y) flags |= RoundFlag.Inexact;
  }
  let q = r + zp;
  if (q > ctx.qmax) {
    q = ctx.qmax;
    flags |= RoundFlag.Saturated | RoundFlag.Overflow | RoundFlag.Inexact;
  } else if (q < ctx.qmin) {
    q = ctx.qmin;
    flags |= RoundFlag.Saturated | RoundFlag.Overflow | RoundFlag.Inexact;
  }
  const recon = scale * (q - zp);
  if (recon === 0 && x !== 0) flags |= RoundFlag.ZeroFromNonzero;
  out.flags = flags;
  out.recon = recon;
  return q;
}

interface RangeChoice {
  low: number;
  high: number;
}

function paramsFromRange(range: RangeChoice, cfg: QuantConfig, ctx: ElementContext): BlockParams {
  const symmetric = ctx.isFloat || cfg.scheme === 'symmetric';
  let rawScale: number;
  let degenerate = false;
  if (symmetric) {
    const amax = Math.max(Math.abs(range.low), Math.abs(range.high));
    if (amax === 0) {
      degenerate = true;
      rawScale = 1;
    } else {
      rawScale = amax / ctx.gridMax;
    }
  } else {
    const width = range.high - range.low;
    if (width === 0) {
      degenerate = true;
      rawScale = 1;
    } else {
      rawScale = width / (ctx.qmax - ctx.qmin);
    }
  }
  let rawUnderflow = false;
  let rawOverflow = false;
  if (rawScale === 0) {
    // amax / qmax underflowed in FP64 (subnormal ranges): use the smallest positive double.
    rawScale = Number.MIN_VALUE;
    rawUnderflow = true;
  } else if (!Number.isFinite(rawScale)) {
    // Range wider than FP64 can express as a scale (e.g. hi − lo overflows).
    rawScale = Number.MAX_VALUE;
    rawOverflow = true;
  }
  const stored = degenerate ? { scale: 1, underflow: false, overflow: false } : storeScale(rawScale, cfg.scaleFormat);
  stored.underflow ||= rawUnderflow;
  stored.overflow ||= rawOverflow;
  const scale = stored.scale;
  let zeroPoint = 0;
  if (!symmetric) {
    zeroPoint = roundToInteger(ctx.qmin - range.low / scale, 'nearest-even');
    zeroPoint = Math.min(ctx.qmax, Math.max(ctx.qmin, zeroPoint));
  }
  return finishParams(scale, rawScale, zeroPoint, range, degenerate, stored.underflow, stored.overflow, ctx);
}

function finishParams(
  scale: number,
  rawScale: number,
  zeroPoint: number,
  range: RangeChoice,
  degenerate: boolean,
  scaleUnderflow: boolean,
  scaleOverflow: boolean,
  ctx: ElementContext,
): BlockParams {
  return {
    scale,
    rawScale,
    zeroPoint,
    rangeLow: range.low,
    rangeHigh: range.high,
    representableLow: scale * (ctx.qmin - zeroPoint),
    representableHigh: scale * (ctx.qmax - zeroPoint),
    degenerate,
    scaleUnderflow,
    scaleOverflow,
    count: 0,
    saturated: 0,
  };
}

/** MSE of fake-quantizing `values` with the given parameters (deterministic rounding). */
export function blockMse(values: Float64Array, p: BlockParams, ctx: ElementContext): number {
  const out = { flags: 0, recon: 0 };
  let sum = 0;
  let n = 0;
  for (let i = 0; i < values.length; i++) {
    const x = values[i]!;
    if (!Number.isFinite(x)) continue;
    quantizeElement(x, p.scale, p.zeroPoint, ctx, true, out);
    const d = Number.isFinite(out.recon) ? out.recon - x : Infinity;
    sum += d * d;
    n++;
  }
  return n === 0 ? 0 : sum / n;
}

/** Calibrates scale / zero-point for one block of values. */
export function calibrateBlock(values: Float64Array, cfg: QuantConfig, ctx: ElementContext): BlockParams {
  const finite = values.filter((v) => Number.isFinite(v));
  let min = Infinity;
  let max = -Infinity;
  let amax = 0;
  for (const v of finite) {
    if (v < min) min = v;
    if (v > max) max = v;
    const a = Math.abs(v);
    if (a > amax) amax = a;
  }
  if (finite.length === 0) {
    min = 0;
    max = 0;
  }
  const symmetric = ctx.isFloat || cfg.scheme === 'symmetric';
  // Asymmetric ranges always include zero so that 0 is exactly representable.
  const minmaxRange: RangeChoice = symmetric
    ? { low: -amax, high: amax }
    : { low: Math.min(min, 0), high: Math.max(max, 0) };

  switch (cfg.calibration) {
    case 'minmax':
      return paramsFromRange(minmaxRange, cfg, ctx);
    case 'percentile': {
      if (finite.length === 0) return paramsFromRange(minmaxRange, cfg, ctx);
      if (symmetric) {
        const abs = Float64Array.from(finite, Math.abs).sort();
        const a = percentileSorted(abs, cfg.percentile);
        return paramsFromRange({ low: -a, high: a }, cfg, ctx);
      }
      const sorted = Float64Array.from(finite).sort();
      const lo = Math.min(0, percentileSorted(sorted, 100 - cfg.percentile));
      const hi = Math.max(0, percentileSorted(sorted, cfg.percentile));
      return paramsFromRange({ low: lo, high: hi }, cfg, ctx);
    }
    case 'mse': {
      // Grid search over clipping ratios α_k = αmin + (1 − αmin)·k/N, k = 1…N
      // (α = 1 is plain min/max). The candidate with the smallest MSE wins;
      // ties go to the larger α. This is a grid search, not a proof of optimality.
      const N = cfg.mseCandidates;
      const amin = cfg.mseMinRatio;
      const evalCtx: ElementContext =
        ctx.mode === 'stochastic' ? { ...ctx, mode: 'nearest-even', roundOpts: { ...ctx.roundOpts, mode: 'nearest-even', rng: undefined } } : ctx;
      const search: MseSearchPoint[] = [];
      let best: BlockParams | null = null;
      let bestMse = Infinity;
      let bestRatio = 1;
      for (let k = N; k >= 1; k--) {
        const ratio = N === 1 ? 1 : amin + ((1 - amin) * k) / N;
        const p = paramsFromRange({ low: minmaxRange.low * ratio, high: minmaxRange.high * ratio }, cfg, ctx);
        const mse = blockMse(finite, p, evalCtx);
        search.push({ ratio, mse });
        if (mse < bestMse) {
          bestMse = mse;
          best = p;
          bestRatio = ratio;
        }
      }
      search.reverse();
      const chosen = best ?? paramsFromRange(minmaxRange, cfg, ctx);
      return { ...chosen, search, chosenRatio: bestRatio };
    }
    case 'manual': {
      const scale = cfg.manualScale;
      const zp = symmetric ? 0 : cfg.manualZeroPoint;
      return finishParams(scale, scale, zp, minmaxRange, false, false, false, ctx);
    }
    case 'pow2-mx': {
      // OCP MX v1.0 §6.3: X = (largest power of two ≤ max|V|) / (largest power
      // of two representable in the element type), stored as E8M0 (2^k, |k| ≤ 127).
      const emaxElem = exponentOf(ctx.gridMax);
      if (amax === 0) {
        return finishParams(pow2(-127), pow2(-127), 0, minmaxRange, true, false, false, ctx);
      }
      let k = exponentOf(amax) - emaxElem;
      const underflow = k < -127;
      const overflow = k > 127;
      k = Math.min(127, Math.max(-127, k));
      const stored = storeScale(pow2(k), cfg.scaleFormat);
      return finishParams(
        stored.scale,
        pow2(k),
        0,
        minmaxRange,
        false,
        underflow || stored.underflow,
        overflow || stored.overflow,
        ctx,
      );
    }
  }
}

/** Quantizes a row-major tensor according to `cfg`. Throws QuantConfigError on invalid input. */
export function quantizeTensor(data: ArrayLike<number>, shape: [number, number], cfg: QuantConfig): QuantResult {
  const [rows, cols] = shape;
  if (rows * cols !== data.length) throw new RangeError(`Shape ${rows}×${cols} does not match ${data.length} elements`);
  assertValidConfig(cfg, shape);
  const original = Float64Array.from(data);
  const n = original.length;
  const rng = cfg.rounding === 'stochastic' ? new Rng(cfg.seed) : undefined;
  const ctx = makeContext(cfg, rng);
  const scaled = cfg.scaling === 'scaled';
  const layout = scaled
    ? computeLayout(shape, cfg.granularity, cfg.axis, cfg.groupSize)
    : computeLayout(shape, 'tensor', 0, 1);
  let params: BlockParams[];
  if (scaled) {
    const blocks = gatherBlocks(original, layout);
    params = blocks.map((b) => calibrateBlock(b, cfg, ctx));
  } else {
    const c = characteristics(ctx.floatFmt!);
    params = [
      {
        scale: 1,
        rawScale: 1,
        zeroPoint: 0,
        rangeLow: -c.maxFinite,
        rangeHigh: c.maxFinite,
        representableLow: -c.maxFinite,
        representableHigh: c.maxFinite,
        degenerate: false,
        scaleUnderflow: false,
        scaleOverflow: false,
        count: 0,
        saturated: 0,
      },
    ];
  }
  const q = new Float64Array(n);
  const recon = new Float64Array(n);
  const flags = new Uint16Array(n);
  const out = { flags: 0, recon: 0 };
  for (let i = 0; i < n; i++) {
    const p = params[layout.blockOf[i]!]!;
    q[i] = quantizeElement(original[i]!, p.scale, p.zeroPoint, ctx, scaled, out);
    recon[i] = out.recon;
    flags[i] = out.flags;
    p.count++;
    if (out.flags & (RoundFlag.Saturated | RoundFlag.Overflow)) p.saturated++;
  }
  return { config: cfg, shape: [rows, cols], original, q, recon, flags, layout, params };
}

/**
 * Quantizes a single value with explicit parameters (used by inspectors and
 * by the arithmetic / neural-network simulators).
 */
export function quantizeValue(
  x: number,
  cfg: QuantConfig,
  scale: number,
  zeroPoint: number,
  rng?: Rng,
): { q: number; recon: number; flags: number } {
  const ctx = makeContext(cfg, rng);
  const out = { flags: 0, recon: 0 };
  const q = quantizeElement(x, scale, zeroPoint, ctx, cfg.scaling === 'scaled', out);
  return { q, recon: out.recon, flags: out.flags };
}

/**
 * Calibrates one parameter set from arbitrary values using `cfg`'s scheme and
 * calibration method (used e.g. for static activation calibration, where a
 * block's values are gathered from many input samples).
 */
export function calibrateValues(values: ArrayLike<number>, cfg: QuantConfig): BlockParams {
  assertValidConfig(cfg);
  return calibrateBlock(Float64Array.from(values), cfg, makeContext(cfg));
}

/** Largest magnitude of the element grid (format max finite or integer qmax). */
export function elementGridMax(cfg: QuantConfig): number {
  return makeContext(cfg).gridMax;
}

export type { ElementContext };
