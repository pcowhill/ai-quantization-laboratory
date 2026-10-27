/**
 * Mapping between tensor elements and the scaling blocks that share a scale.
 */
import type { Granularity } from './types';

export interface BlockLayout {
  /** Block index of each element (row-major element order). */
  blockOf: Int32Array;
  blockCount: number;
  /** Number of elements in each block. */
  blockSizes: Int32Array;
  /** Human-readable description of each block, e.g. "row 3, cols 32–63". */
  describe: (block: number) => string;
}

export function computeLayout(
  shape: [number, number],
  granularity: Granularity,
  axis: 0 | 1,
  groupSize: number,
): BlockLayout {
  const [rows, cols] = shape;
  const n = rows * cols;
  const blockOf = new Int32Array(n);
  let blockCount: number;
  let describe: (b: number) => string;
  if (granularity === 'tensor') {
    blockCount = 1;
    describe = () => 'whole tensor';
  } else if (granularity === 'channel') {
    if (axis === 0) {
      blockCount = rows;
      for (let r = 0; r < rows; r++) blockOf.fill(r, r * cols, (r + 1) * cols);
      describe = (b) => `row ${b}`;
    } else {
      blockCount = cols;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) blockOf[r * cols + c] = c;
      describe = (b) => `column ${b}`;
    }
  } else {
    const g = Math.max(1, Math.floor(groupSize));
    if (axis === 0) {
      const perRow = Math.ceil(cols / g);
      blockCount = rows * perRow;
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) blockOf[r * cols + c] = r * perRow + Math.floor(c / g);
      describe = (b) => {
        const r = Math.floor(b / perRow);
        const k = b % perRow;
        return `row ${r}, columns ${k * g}–${Math.min(cols, (k + 1) * g) - 1}`;
      };
    } else {
      const perCol = Math.ceil(rows / g);
      blockCount = cols * perCol;
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) blockOf[r * cols + c] = c * perCol + Math.floor(r / g);
      describe = (b) => {
        const c = Math.floor(b / perCol);
        const k = b % perCol;
        return `column ${c}, rows ${k * g}–${Math.min(rows, (k + 1) * g) - 1}`;
      };
    }
  }
  const blockSizes = new Int32Array(blockCount);
  for (let i = 0; i < n; i++) blockSizes[blockOf[i]!]!++;
  return { blockOf, blockCount, blockSizes, describe };
}

/** Gathers the values of each block (preserving element order). */
export function gatherBlocks(data: ArrayLike<number>, layout: BlockLayout): Float64Array[] {
  const blocks = Array.from(layout.blockSizes, (s) => new Float64Array(s));
  const fill = new Int32Array(layout.blockCount);
  for (let i = 0; i < data.length; i++) {
    const b = layout.blockOf[i]!;
    blocks[b]![fill[b]!++] = data[i]!;
  }
  return blocks;
}
