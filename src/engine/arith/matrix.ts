/**
 * Vector and matrix operations built on the simulated arithmetic machine,
 * plus an integer-arithmetic path for integer-quantized operands.
 */
import { roundFloat } from '../float/round';
import { twoSum } from '../float/double';
import { FLOAT_FORMATS } from '../formats/registry';
import type { FloatFormatId } from '../formats/types';
import type { QuantResult } from '../quant/quantize';
import { ArithMachine, type ArithConfig, type DotResult } from './dot';
import { ExactSum } from './exact';

export interface Matrix {
  rows: number;
  cols: number;
  /** Row-major values. */
  data: Float64Array;
}

export function matrix(rows: number, cols: number, data?: ArrayLike<number>): Matrix {
  const d = data ? Float64Array.from(data) : new Float64Array(rows * cols);
  if (d.length !== rows * cols) throw new RangeError(`Expected ${rows * cols} values, got ${d.length}`);
  return { rows, cols, data: d };
}

export function getRow(m: Matrix, r: number): Float64Array {
  return m.data.subarray(r * m.cols, (r + 1) * m.cols);
}

export function getCol(m: Matrix, c: number): Float64Array {
  const out = new Float64Array(m.rows);
  for (let r = 0; r < m.rows; r++) out[r] = m.data[r * m.cols + c]!;
  return out;
}

export interface MatmulResult {
  value: Matrix;
  /** Exact product of the given operands, each entry rounded once to FP64. */
  exact: Matrix;
  /** OR of the rounding flags of every operation. */
  flags: number;
  /** Per-entry flags. */
  entryFlags: Uint16Array;
}

/** C = A·B with simulated arithmetic. */
export function matmul(A: Matrix, B: Matrix, cfg: ArithConfig): MatmulResult {
  if (A.cols !== B.rows) throw new RangeError(`Inner dimensions differ: ${A.rows}×${A.cols} · ${B.rows}×${B.cols}`);
  const machine = new ArithMachine(cfg);
  const C = matrix(A.rows, B.cols);
  const E = matrix(A.rows, B.cols);
  const entryFlags = new Uint16Array(A.rows * B.cols);
  let flags = 0;
  const cols = Array.from({ length: B.cols }, (_, j) => getCol(B, j));
  for (let i = 0; i < A.rows; i++) {
    const row = getRow(A, i);
    for (let j = 0; j < B.cols; j++) {
      const r = machine.dot(row, cols[j]!);
      C.data[i * B.cols + j] = r.value;
      E.data[i * B.cols + j] = r.exact;
      entryFlags[i * B.cols + j] = r.flags;
      flags |= r.flags;
    }
  }
  return { value: C, exact: E, flags, entryFlags };
}

/** Step-by-step trace of one entry C[i, j] of A·B. */
export function matmulEntryTrace(A: Matrix, B: Matrix, i: number, j: number, cfg: ArithConfig): DotResult {
  // Stochastic rounding draws depend on evaluation order; replay the full
  // product up to (i, j) so the trace matches the matrix result exactly.
  const machine = new ArithMachine(cfg);
  const cols = Array.from({ length: B.cols }, (_, k) => getCol(B, k));
  for (let r = 0; r < A.rows; r++) {
    const row = getRow(A, r);
    for (let c = 0; c < B.cols; c++) {
      if (r === i && c === j) return machine.dot(row, cols[c]!, true);
      if (cfg.rounding === 'stochastic') machine.dot(row, cols[c]!);
    }
  }
  throw new RangeError('Entry out of range');
}

export interface ElementwiseResult {
  value: Float64Array;
  exact: Float64Array;
  flags: number;
}

/** c = a + b element-wise, each sum rounded to the accumulator format. */
export function vectorAdd(a: ArrayLike<number>, b: ArrayLike<number>, cfg: ArithConfig): ElementwiseResult {
  if (a.length !== b.length) throw new RangeError('Vectors must have equal length');
  const m = new ArithMachine(cfg);
  const value = new Float64Array(a.length);
  const exact = new Float64Array(a.length);
  for (let i = 0; i < a.length; i++) {
    value[i] = m.round(cfg.outputFormat, m.add(a[i]!, b[i]!));
    exact[i] = new ExactSum().add(a[i]!).add(b[i]!).toNumber();
  }
  return { value, exact, flags: m.flags };
}

/** c = α·a element-wise, each product rounded to the product format. */
export function scalarMultiply(alpha: number, a: ArrayLike<number>, cfg: ArithConfig): ElementwiseResult {
  const m = new ArithMachine(cfg);
  const value = new Float64Array(a.length);
  const exact = new Float64Array(a.length);
  for (let i = 0; i < a.length; i++) {
    value[i] = m.round(cfg.outputFormat, m.mul(alpha, a[i]!));
    exact[i] = new ExactSum().addProduct(alpha, a[i]!).toNumber();
  }
  return { value, exact, flags: m.flags };
}

// ---------------------------------------------------------------------------
// Integer path
// ---------------------------------------------------------------------------

export type IntAccumulator = 'int32-wrap' | 'int32-saturate' | 'exact';

export interface IntegerPathConfig {
  accumulator: IntAccumulator;
  /** Format of the floating-point accumulator that combines rescaled block sums. */
  rescaleFormat: FloatFormatId;
  outputFormat: FloatFormatId;
}

export interface IntegerMatmulResult {
  value: Matrix;
  /** Number of entries whose integer accumulator left the INT32 range. */
  int32Overflows: number;
  /** Largest |integer partial sum| encountered (exact, before any wrap/saturation). */
  maxAbsPartial: number;
  segments: number;
}

const INT32_MAX = 2147483647;
const INT32_MIN = -2147483648;

/**
 * Checks whether two integer-quantized operands support the integer path:
 * A's blocks must not straddle rows and B's blocks must not straddle columns,
 * so every block of a reduction shares one (scale, zero-point) per operand.
 */
export function integerPathSupport(qa: QuantResult, qb: QuantResult): { ok: boolean; reason?: string } {
  const fa = qa.config;
  const fb = qb.config;
  if (!fa.format.startsWith('int') || !fb.format.startsWith('int')) {
    return { ok: false, reason: 'Both operands must be quantized to an integer format (INT8/INT4).' };
  }
  const aOk = fa.granularity === 'tensor' || fa.axis === 0;
  const bOk = fb.granularity === 'tensor' || fb.axis === 1;
  if (!aOk) return { ok: false, reason: 'A must be scaled per tensor, per row (axis 0) or in groups along each row.' };
  if (!bOk) return { ok: false, reason: 'B must be scaled per tensor, per column (axis 1) or in groups along each column.' };
  return { ok: true };
}

/**
 * C = A·B computed as real integer kernels do:
 *   C[i,j] = Σ_segments s_A·s_B · Σ_{k∈segment} (q_A[i,k] − z_A)(q_B[k,j] − z_B)
 * where segments are maximal runs of k sharing one scale per operand. Integer
 * sums use an INT32 accumulator (wrapping or saturating) or exact integers;
 * each rescaled segment sum is rounded to `rescaleFormat` and accumulated there.
 */
export function integerMatmul(qa: QuantResult, qb: QuantResult, cfg: IntegerPathConfig): IntegerMatmulResult {
  const support = integerPathSupport(qa, qb);
  if (!support.ok) throw new Error(support.reason);
  const [M, K] = qa.shape;
  const [K2, N] = qb.shape;
  if (K !== K2) throw new RangeError('Inner dimensions differ');
  const out = matrix(M, N);
  let overflows = 0;
  let maxAbsPartial = 0;
  let segmentCount = 0;
  const rescale = FLOAT_FORMATS[cfg.rescaleFormat];
  const output = FLOAT_FORMATS[cfg.outputFormat];
  const opts = { mode: 'nearest-even' as const, overflow: 'nonsaturate' as const };
  for (let i = 0; i < M; i++) {
    for (let j = 0; j < N; j++) {
      let acc = 0;
      let segAcc = 0;
      let trueAcc = 0; // exact (unwrapped) segment sum, for reporting
      let overflowed = false;
      let prevKey = '';
      let sa = 0;
      let sb = 0;
      const flush = () => {
        // s_A·s_B·Σ is formed exactly and rounded once to the rescale format.
        const term = new ExactSum().addProduct3(sa, sb, segAcc).roundTo(rescale, opts);
        const [s, t] = twoSum(acc, term);
        acc = roundFloat(rescale, s, opts, t);
        segmentCount++;
      };
      for (let k = 0; k < K; k++) {
        const ia = i * K + k;
        const ib = k * N + j;
        const pa = qa.params[qa.layout.blockOf[ia]!]!;
        const pb = qb.params[qb.layout.blockOf[ib]!]!;
        const key = `${qa.layout.blockOf[ia]}:${qb.layout.blockOf[ib]}`;
        if (key !== prevKey) {
          if (prevKey !== '') flush();
          prevKey = key;
          sa = pa.scale;
          sb = pb.scale;
          segAcc = 0;
          trueAcc = 0;
        }
        const prod = (qa.q[ia]! - pa.zeroPoint) * (qb.q[ib]! - pb.zeroPoint);
        trueAcc += prod;
        maxAbsPartial = Math.max(maxAbsPartial, Math.abs(trueAcc));
        let next = segAcc + prod;
        if (next > INT32_MAX || next < INT32_MIN) {
          overflowed = true;
          if (cfg.accumulator === 'int32-wrap') next = next | 0;
          else if (cfg.accumulator === 'int32-saturate') next = next > 0 ? INT32_MAX : INT32_MIN;
        }
        segAcc = next;
      }
      if (prevKey !== '') flush();
      if (overflowed) overflows++;
      out.data[i * N + j] = roundFloat(output, acc, opts);
    }
  }
  return { value: out, int32Overflows: overflows, maxAbsPartial, segments: segmentCount };
}
