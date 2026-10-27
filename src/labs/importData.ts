/**
 * Parsing of user-supplied numeric data (CSV / JSON / manual text). Inputs
 * are validated strictly: malformed cells and ragged rows are reported with
 * their location, never guessed or dropped silently.
 */
import { MAX_DATA_ELEMENTS } from '@/state/validate';

export interface ParsedTable {
  rows: number;
  cols: number;
  values: number[];
  notes: string[];
}

export class DataParseError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.slice(0, 5).join(' '));
    this.name = 'DataParseError';
  }
}

const SPECIAL: Record<string, number> = {
  nan: NaN,
  inf: Infinity,
  '+inf': Infinity,
  infinity: Infinity,
  '+infinity': Infinity,
  '-inf': -Infinity,
  '-infinity': -Infinity,
};

/** Parses one cell; returns null when it is not a number. */
export function parseCell(raw: string): number | null {
  const t = raw.trim().replace(/^"(.*)"$/, '$1').replace(/−/g, '-');
  if (t === '') return null;
  const lower = t.toLowerCase();
  if (lower in SPECIAL) return SPECIAL[lower]!;
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t) && !/^[+-]?0[xX][0-9a-fA-F]+$/.test(t)) return null;
  const v = Number(t);
  return Number.isNaN(v) ? null : v;
}

function detectDelimiter(line: string): RegExp {
  if (line.includes('\t')) return /\t/;
  if (line.includes(';')) return /;/;
  if (line.includes(',')) return /,/;
  return /\s+/;
}

/** Parses CSV / TSV / whitespace-separated text into a rows×cols table. */
export function parseDelimited(text: string): ParsedTable {
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'));
  if (lines.length === 0) throw new DataParseError(['The input contains no data.']);
  const delim = detectDelimiter(lines[0]!);
  const notes: string[] = [];
  const problems: string[] = [];
  let start = 0;
  // A first row with no numeric cells is treated as a header.
  const firstCells = lines[0]!.split(delim);
  if (firstCells.every((c) => parseCell(c) === null)) {
    start = 1;
    notes.push(`Skipped header row: ${firstCells.map((c) => c.trim()).join(', ')}`);
  }
  const rows: number[][] = [];
  for (let i = start; i < lines.length; i++) {
    const cells = lines[i]!.split(delim);
    const row: number[] = [];
    cells.forEach((c, j) => {
      const v = parseCell(c);
      if (v === null) problems.push(`Line ${i + 1}, column ${j + 1}: "${c.trim()}" is not a number.`);
      else row.push(v);
    });
    rows.push(row);
    if (problems.length > 20) break;
  }
  if (problems.length) throw new DataParseError(problems);
  if (rows.length === 0) throw new DataParseError(['No numeric rows found.']);
  const cols = rows[0]!.length;
  rows.forEach((r, i) => {
    if (r.length !== cols) problems.push(`Row ${i + 1} has ${r.length} values but the first row has ${cols}. All rows must have the same length.`);
  });
  if (problems.length) throw new DataParseError(problems);
  return finish(rows.length, cols, rows.flat(), notes);
}

/**
 * Parses JSON: an array of numbers (one row), an array of equal-length
 * arrays (a matrix), or {"rows", "cols", "values"}. The strings "NaN",
 * "Infinity", "-Infinity" and "-0" are accepted as numbers.
 */
export function parseJsonData(text: string): ParsedTable {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new DataParseError([`Invalid JSON: ${(e as Error).message}`]);
  }
  const num = (x: unknown, where: string): number => {
    if (typeof x === 'number') return x;
    if (typeof x === 'string') {
      const v = x === '-0' ? -0 : parseCell(x);
      if (v !== null) return v;
    }
    throw new DataParseError([`${where}: ${JSON.stringify(x)} is not a number.`]);
  };
  if (Array.isArray(raw)) {
    if (raw.length === 0) throw new DataParseError(['The array is empty.']);
    if (raw.every((r) => Array.isArray(r))) {
      const rows = raw as unknown[][];
      const cols = rows[0]!.length;
      const problems: string[] = [];
      rows.forEach((r, i) => {
        if (r.length !== cols) problems.push(`Row ${i} has ${r.length} values; expected ${cols}.`);
      });
      if (problems.length) throw new DataParseError(problems);
      return finish(rows.length, cols, rows.flatMap((r, i) => r.map((x, j) => num(x, `[${i}][${j}]`))), []);
    }
    return finish(1, raw.length, raw.map((x, i) => num(x, `[${i}]`)), []);
  }
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    const rows = num(o.rows, 'rows');
    const cols = num(o.cols, 'cols');
    if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || cols < 1) throw new DataParseError(['rows and cols must be positive integers.']);
    if (!Array.isArray(o.values)) throw new DataParseError(['"values" must be an array of numbers.']);
    if (o.values.length !== rows * cols) throw new DataParseError([`"values" has ${o.values.length} entries; rows × cols = ${rows * cols}.`]);
    return finish(rows, cols, o.values.map((x, i) => num(x, `values[${i}]`)), []);
  }
  throw new DataParseError(['Expected an array of numbers, an array of arrays, or {"rows", "cols", "values"}.']);
}

function finish(rows: number, cols: number, values: number[], notes: string[]): ParsedTable {
  if (values.length === 0) throw new DataParseError(['No values found.']);
  if (values.length > MAX_DATA_ELEMENTS) throw new DataParseError([`Too many values (${values.length}); the limit is ${MAX_DATA_ELEMENTS}.`]);
  const nonFinite = values.filter((v) => !Number.isFinite(v)).length;
  if (nonFinite) notes.push(`${nonFinite} non-finite value(s) (NaN/±∞) included; they are flagged and excluded from calibration and metrics.`);
  return { rows, cols, values, notes };
}

/** Chooses the parser from the file name / content. */
export function parseDataFile(name: string, text: string): ParsedTable {
  const t = text.trim();
  if (name.toLowerCase().endsWith('.json') || t.startsWith('[') || t.startsWith('{')) return parseJsonData(t);
  return parseDelimited(text);
}
