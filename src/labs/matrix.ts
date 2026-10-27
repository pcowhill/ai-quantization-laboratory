/**
 * Matrix Laboratory computations (pure).
 *
 * Four stages are separated explicitly:
 *   1. storage: operands are quantized and dequantized (x → x̂);
 *   2. arithmetic: products/sums are rounded per the ArithConfig;
 *   3. accumulation order and precision;
 *   4. comparison against exact results of the original and stored operands.
 */
import { ArithMachine, FP64_ARITH, type DotResult } from '@/engine/arith/dot';
import { exactDot, ExactSum } from '@/engine/arith/exact';
import { integerMatmul, integerPathSupport, matmul, matmulEntryTrace, matrix, scalarMultiply, vectorAdd, type Matrix } from '@/engine/arith/matrix';
import { computeErrorMetrics, type ErrorMetrics } from '@/engine/metrics/error';
import { quantizeTensor, type QuantResult } from '@/engine/quant/quantize';
import { validateQuantConfig } from '@/engine/quant/types';
import type { MatrixOp, MatrixOperand, MatrixState } from '@/state/schema';

export interface MatrixIssue {
  severity: 'error' | 'warning';
  message: string;
}

export interface MatrixEvaluation {
  issues: MatrixIssue[];
  A: Matrix;
  B: Matrix | null;
  qA: QuantResult | null;
  qB: QuantResult | null;
  /** Stored (dequantized) operands. */
  storedA: Matrix;
  storedB: Matrix | null;
  /** FP64 arithmetic on the original operands. */
  baseline: Float64Array;
  /** Exact result for the original operands (rounded once to FP64). */
  exactOriginal: Float64Array;
  /** Exact result for the stored operands. */
  exactStored: Float64Array;
  /** Simulated low-precision result. */
  simulated: Float64Array;
  /** Integer-kernel result, when enabled and supported. */
  integer: Float64Array | null;
  integerInfo: { int32Overflows: number; maxAbsPartial: number; segments: number } | null;
  integerUnsupported: string | null;
  outRows: number;
  outCols: number;
  metrics: ErrorMetrics;
  flags: number;
  trace: DotResult | null;
}

export function shapeIssues(op: MatrixOp, A: MatrixOperand, B: MatrixOperand): MatrixIssue[] {
  const out: MatrixIssue[] = [];
  const e = (m: string) => out.push({ severity: 'error', message: m });
  if (A.values.length !== A.rows * A.cols) e(`A has ${A.values.length} values but is declared ${A.rows}×${A.cols}.`);
  if (B.values.length !== B.rows * B.cols) e(`B has ${B.values.length} values but is declared ${B.rows}×${B.cols}.`);
  switch (op) {
    case 'add':
      if (A.rows !== B.rows || A.cols !== B.cols) e(`Element-wise addition needs equal shapes (A is ${A.rows}×${A.cols}, B is ${B.rows}×${B.cols}).`);
      break;
    case 'dot':
      if (A.rows !== 1) e('For a dot product, A must be a row vector (1×K).');
      if (B.cols !== 1) e('For a dot product, B must be a column vector (K×1).');
      if (A.cols !== B.rows) e(`Lengths differ: A has ${A.cols} elements, B has ${B.rows}.`);
      break;
    case 'matvec':
      if (B.cols !== 1) e('For matrix–vector multiplication, B must be a column vector (K×1).');
      if (A.cols !== B.rows) e(`Inner dimensions differ: A is ${A.rows}×${A.cols}, B is ${B.rows}×1.`);
      break;
    case 'matmul':
      if (A.cols !== B.rows) e(`Inner dimensions differ: A is ${A.rows}×${A.cols}, B is ${B.rows}×${B.cols}.`);
      break;
    case 'scale':
      break;
  }
  return out;
}

/** Reshapes operands to fit an operation (an explicit, user-initiated action). */
export function conformOperands(op: MatrixOp, A: MatrixOperand, B: MatrixOperand): { A: MatrixOperand; B: MatrixOperand } {
  const resize = (m: MatrixOperand, rows: number, cols: number): MatrixOperand => {
    const values: number[] = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) values.push(r < m.rows && c < m.cols ? m.values[r * m.cols + c]! : 0);
    return { rows, cols, values };
  };
  switch (op) {
    case 'add':
      return { A, B: resize(B, A.rows, A.cols) };
    case 'dot':
      return { A: resize(A, 1, A.cols), B: resize(B, A.cols, 1) };
    case 'matvec':
      return { A, B: resize(B, A.cols, 1) };
    case 'matmul':
      return { A, B: resize(B, A.cols, B.cols) };
    default:
      return { A, B };
  }
}

function quantOperand(m: Matrix, cfg: MatrixState['quantA'], name: string, issues: MatrixIssue[]): { q: QuantResult | null; stored: Matrix } {
  if (!cfg) return { q: null, stored: m };
  const errs = validateQuantConfig(cfg, [m.rows, m.cols]);
  for (const i of errs) issues.push({ severity: i.severity, message: `${name}: ${i.message}` });
  if (errs.some((i) => i.severity === 'error')) return { q: null, stored: m };
  const q = quantizeTensor(m.data, [m.rows, m.cols], cfg);
  return { q, stored: matrix(m.rows, m.cols, q.recon) };
}

export function evaluateMatrix(s: MatrixState): MatrixEvaluation {
  const issues = shapeIssues(s.op, s.A, s.B);
  const A = matrix(s.A.rows, s.A.cols, s.A.values.length === s.A.rows * s.A.cols ? s.A.values : new Array(s.A.rows * s.A.cols).fill(0));
  const usesB = s.op !== 'scale';
  const B = usesB ? matrix(s.B.rows, s.B.cols, s.B.values.length === s.B.rows * s.B.cols ? s.B.values : new Array(s.B.rows * s.B.cols).fill(0)) : null;
  const qa = quantOperand(A, s.quantA, 'Operand A', issues);
  const qb = B ? quantOperand(B, s.quantB, 'Operand B', issues) : { q: null, stored: null };
  const hasError = issues.some((i) => i.severity === 'error');
  let baseline: Float64Array;
  let exactOriginal: Float64Array;
  let exactStored: Float64Array;
  let simulated: Float64Array;
  let outRows = A.rows;
  let outCols = A.cols;
  let flags = 0;
  let trace: DotResult | null = null;
  let integer: Float64Array | null = null;
  let integerInfo: MatrixEvaluation['integerInfo'] = null;
  let integerUnsupported: string | null = null;

  if (hasError) {
    const z = new Float64Array(0);
    return {
      issues, A, B, qA: qa.q, qB: qb.q, storedA: qa.stored, storedB: qb.stored,
      baseline: z, exactOriginal: z, exactStored: z, simulated: z, integer: null, integerInfo: null, integerUnsupported: null,
      outRows: 0, outCols: 0, metrics: computeErrorMetrics([], []), flags: 0, trace: null,
    };
  }

  if (s.op === 'add') {
    baseline = vectorAdd(A.data, B!.data, FP64_ARITH).value;
    exactOriginal = vectorAdd(A.data, B!.data, FP64_ARITH).exact;
    const sim = vectorAdd(qa.stored.data, qb.stored!.data, s.arith);
    simulated = sim.value;
    exactStored = sim.exact;
    flags = sim.flags;
  } else if (s.op === 'scale') {
    baseline = scalarMultiply(s.scalar, A.data, FP64_ARITH).value;
    exactOriginal = scalarMultiply(s.scalar, A.data, FP64_ARITH).exact;
    const sim = scalarMultiply(s.scalar, qa.stored.data, s.arith);
    simulated = sim.value;
    exactStored = sim.exact;
    flags = sim.flags;
  } else {
    const base = matmul(A, B!, FP64_ARITH);
    baseline = base.value.data;
    exactOriginal = base.exact.data;
    const sim = matmul(qa.stored, qb.stored!, s.arith);
    simulated = sim.value.data;
    exactStored = sim.exact.data;
    flags = sim.flags;
    outRows = A.rows;
    outCols = B!.cols;
    const [i, j] = s.selectedCell;
    if (i < outRows && j < outCols) trace = matmulEntryTrace(qa.stored, qb.stored!, i, j, s.arith);
    if (s.integerPath) {
      if (!qa.q || !qb.q) integerUnsupported = 'Both operands must be quantized to an integer format.';
      else {
        const sup = integerPathSupport(qa.q, qb.q);
        if (!sup.ok) integerUnsupported = sup.reason ?? 'Unsupported';
        else {
          const r = integerMatmul(qa.q, qb.q, { accumulator: s.intAccumulator, rescaleFormat: s.arith.accumulatorFormat, outputFormat: s.arith.outputFormat });
          integer = r.value.data;
          integerInfo = { int32Overflows: r.int32Overflows, maxAbsPartial: r.maxAbsPartial, segments: r.segments };
        }
      }
    }
  }
  return {
    issues,
    A,
    B,
    qA: qa.q,
    qB: qb.q,
    storedA: qa.stored,
    storedB: qb.stored,
    baseline,
    exactOriginal,
    exactStored,
    simulated,
    integer,
    integerInfo,
    integerUnsupported,
    outRows,
    outCols,
    metrics: computeErrorMetrics(exactOriginal, simulated),
    flags,
    trace,
  };
}

/** Error split for one output entry: total = storage + arithmetic (exactly, up to final FP64 rounding). */
export function errorSplit(e: MatrixEvaluation, k: number): { total: number; storage: number; arithmetic: number } {
  const total = new ExactSum().add(e.simulated[k]!).add(-e.exactOriginal[k]!).toNumber();
  const storage = new ExactSum().add(e.exactStored[k]!).add(-e.exactOriginal[k]!).toNumber();
  const arithmetic = new ExactSum().add(e.simulated[k]!).add(-e.exactStored[k]!).toNumber();
  return { total, storage, arithmetic };
}

export { exactDot, ArithMachine };
