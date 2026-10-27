/**
 * Number Inspector computations (pure; no Vue). Given the inspector state,
 * produce everything the views display: the stored value, its bits and
 * fields, exact errors, neighbours and a cross-format comparison.
 */
import { bitsToBinary, bitsToHex, decode, encode, nextDownIn, nextUpIn, type FloatClass } from '@/engine/float/codec';
import { exponentOf, pow2 } from '@/engine/float/double';
import {
  exactDecimal,
  fractionAbs,
  fractionDiv,
  fractionFromNumber,
  fractionSub,
  fractionToNumber,
  parseExact,
  roundFractionToInteger,
  roundParsed,
  shortestDecimal,
  toFraction,
  type Fraction,
  type ParsedNumber,
} from '@/engine/float/rational';
import { lastRound, RoundFlag } from '@/engine/float/round';
import { characteristics, getFormat } from '@/engine/formats/registry';
import type { FloatFormat, FormatId, IntFormat } from '@/engine/formats/types';
import { decodeInt, encodeInt } from '@/engine/int/codec';
import { Rng } from '@/engine/random/prng';
import type { InspectorState } from '@/state/schema';

export interface FieldInfo {
  name: 'sign' | 'exponent' | 'fraction' | 'integer';
  /** Bit positions [hi, lo] (hi = most significant, counted from the left of the pattern). */
  start: number;
  length: number;
  bits: string;
  value: bigint;
  meaning: string;
}

export interface InspectedValue {
  formatId: FormatId;
  formatName: string;
  /** Exact parsed input (null when the value comes from edited bits). */
  input: ParsedNumber | null;
  /** Stored (reconstructed) value as a double; NaN for NaN. */
  value: number;
  /** Integer code for integer formats. */
  code: number | null;
  bits: bigint;
  width: number;
  binary: string;
  hex: string;
  cls: FloatClass | 'integer';
  fields: FieldInfo[];
  formula: string;
  flags: number;
  flagLabels: string[];
  exactStored: string;
  shortest: string;
  absError: number | null;
  relError: number | null;
  /** Error measured in units of the spacing (ulp) at the stored value. */
  ulpError: number | null;
  spacing: number | null;
  notes: string[];
}

export function flagLabels(flags: number): string[] {
  const out: string[] = [];
  if (flags & RoundFlag.Inexact) out.push('inexact');
  if (flags & RoundFlag.Overflow) out.push('overflow');
  if (flags & RoundFlag.Saturated) out.push('saturated');
  if (flags & RoundFlag.Underflow) out.push('underflow');
  if (flags & RoundFlag.Flushed) out.push('flushed to zero');
  if (flags & RoundFlag.Subnormal) out.push('subnormal result');
  if (flags & RoundFlag.ZeroFromNonzero) out.push('non-zero → zero');
  if (flags & RoundFlag.Invalid) out.push('invalid (not representable)');
  if (flags & RoundFlag.NaNResult) out.push('NaN result');
  if (flags & RoundFlag.InfResult) out.push('∞ result');
  return out;
}

/** Spacing between adjacent representable values at |v| (the "ulp" of the binade). */
export function spacingAt(fmt: FloatFormat, v: number): number | null {
  if (!Number.isFinite(v)) return null;
  const c = characteristics(fmt);
  const a = Math.abs(v);
  const e = a === 0 ? c.emin : Math.max(exponentOf(a), c.emin);
  return pow2(e - fmt.fractionBits);
}

/** Exact decimal, abbreviated when very long. */
function exactShort(v: number): string {
  const e = exactDecimal(v);
  return e.length <= 40 ? e : `${e.slice(0, 38)}…`;
}

function floatFields(fmt: FloatFormat, bits: bigint): { fields: FieldInfo[]; formula: string } {
  const d = decode(fmt, bits);
  const bin = bitsToBinary(bits, fmt.totalBits);
  const e = fmt.exponentBits;
  const m = fmt.fractionBits;
  const fields: FieldInfo[] = [
    { name: 'sign', start: 0, length: 1, bits: bin.slice(0, 1), value: BigInt(d.sign), meaning: d.sign ? 'negative (−)' : 'positive (+)' },
    { name: 'exponent', start: 1, length: e, bits: bin.slice(1, 1 + e), value: BigInt(d.exponent), meaning: '' },
    { name: 'fraction', start: 1 + e, length: m, bits: bin.slice(1 + e), value: d.fraction, meaning: '' },
  ];
  const c = characteristics(fmt);
  const signStr = d.sign ? '−' : '+';
  let formula: string;
  const fracStr = `${d.fraction}/2^${m}`;
  switch (d.cls) {
    case 'nan':
      fields[1]!.meaning = 'special';
      fields[2]!.meaning = 'NaN payload';
      formula = fmt.special === 'fnuz' ? 'NaN (the single FNUZ NaN pattern 1.0…0.0…0)' : fmt.special === 'fn' ? 'NaN (E4M3 reserves only S.1111.111)' : 'NaN (all-ones exponent, non-zero fraction)';
      break;
    case 'infinity':
      fields[1]!.meaning = 'all ones → special';
      fields[2]!.meaning = 'zero → infinity';
      formula = `${signStr}∞`;
      break;
    case 'zero':
      fields[1]!.meaning = `0 → zero/subnormal`;
      fields[2]!.meaning = '0';
      formula = `${signStr}0`;
      break;
    case 'subnormal':
      fields[1]!.meaning = `0 → subnormal, exponent fixed at emin = ${c.emin}`;
      fields[2]!.meaning = `0.f = ${fracStr} = ${d.significand}`;
      formula = `(−1)^${d.sign} × 2^${c.emin} × (0 + ${fracStr}) = ${exactShort(d.value)}`;
      break;
    default:
      fields[1]!.meaning = `${d.exponent} − bias ${fmt.bias} = ${d.exponent - fmt.bias}`;
      fields[2]!.meaning = `1.f = 1 + ${fracStr} = ${d.significand}`;
      formula = `(−1)^${d.sign} × 2^(${d.exponent}−${fmt.bias}) × (1 + ${fracStr}) = ${exactShort(d.value)}`;
  }
  return { fields, formula };
}

function intFields(fmt: IntFormat, bits: bigint, q: number): { fields: FieldInfo[]; formula: string } {
  const bin = bitsToBinary(bits, fmt.totalBits);
  const fields: FieldInfo[] = [
    { name: 'sign', start: 0, length: 1, bits: bin.slice(0, 1), value: BigInt(bin[0]!), meaning: `weight −2^${fmt.totalBits - 1}` },
    { name: 'integer', start: 1, length: fmt.totalBits - 1, bits: bin.slice(1), value: BigInt('0b' + bin.slice(1)), meaning: `weights 2^${fmt.totalBits - 2} … 2^0` },
  ];
  const sign = bin[0] === '1' ? -(2 ** (fmt.totalBits - 1)) : 0;
  const rest = Number(BigInt('0b' + bin.slice(1)));
  return { fields, formula: `${sign} + ${rest} = ${q} (two's complement)` };
}

function errors(input: ParsedNumber | null, value: number | Fraction): { abs: number | null; rel: number | null; absFrac: Fraction | null } {
  if (!input) return { abs: null, rel: null, absFrac: null };
  const x = toFraction(input);
  const v = typeof value === 'number' ? fractionFromNumber(value) : value;
  if (!x || !v) return { abs: null, rel: null, absFrac: null };
  const d = fractionAbs(fractionSub(v, x));
  const rel = fractionDiv(d, fractionAbs(x));
  return {
    abs: fractionToNumber(d),
    rel: rel === null ? (d.num === 0n ? 0 : null) : fractionToNumber(rel),
    absFrac: d,
  };
}

export interface InspectorOptions {
  formatId: FormatId;
  rounding: InspectorState['rounding'];
  overflow: InspectorState['overflow'];
  ftz: boolean;
  seed: number;
  intScale: number;
}

/** Converts an exact input to one format and describes the result. */
export function inspectParsed(input: ParsedNumber, o: InspectorOptions): InspectedValue {
  const fmt = getFormat(o.formatId);
  if (fmt.kind === 'float') {
    const rng = new Rng(o.seed);
    const value = roundParsed(fmt, input, { mode: o.rounding, overflow: o.overflow, ftz: o.ftz, rng: () => rng.next() });
    const flags = lastRound.flags;
    let bits: bigint;
    if (Number.isNaN(value) && !characteristics(fmt).hasNaN) bits = 0n;
    else bits = encode(fmt, value);
    return describeFloat(fmt, bits, input, flags);
  }
  // Integer: q = clamp(round(x / scale)) computed exactly from the rational input.
  const x = toFraction(input);
  const notes: string[] = [];
  let q: number;
  let flags = 0;
  const scaleFrac = fractionFromNumber(o.intScale);
  if (input.kind === 'nan') {
    q = 0;
    flags = RoundFlag.Invalid;
    notes.push('NaN has no integer encoding; shown as 0 and flagged invalid.');
  } else if (input.kind === 'inf') {
    q = input.negative ? fmt.min : fmt.max;
    flags = RoundFlag.Saturated | RoundFlag.Overflow;
  } else if (!scaleFrac || scaleFrac.num <= 0n) {
    q = 0;
    flags = RoundFlag.Invalid;
    notes.push('The integer scale must be a positive finite number.');
  } else {
    const ratio = fractionDiv(x!, scaleFrac)!;
    const rng = new Rng(o.seed);
    const r = roundFractionToInteger(ratio, o.rounding, () => rng.next());
    q = Math.min(fmt.max, Math.max(fmt.min, r));
    if (q !== r) flags |= RoundFlag.Saturated | RoundFlag.Overflow;
    if (ratio.num % ratio.den !== 0n || q !== r) flags |= RoundFlag.Inexact;
    if (q === 0 && x!.num !== 0n) flags |= RoundFlag.ZeroFromNonzero;
  }
  return describeInt(fmt, encodeInt(fmt, q), input, flags, o.intScale, notes);
}

export function describeFloat(fmt: FloatFormat, bits: bigint, input: ParsedNumber | null, flags: number): InspectedValue {
  const d = decode(fmt, bits);
  const { fields, formula } = floatFields(fmt, bits);
  const { abs, rel } = errors(input, d.value);
  const spacing = spacingAt(fmt, d.value);
  const notes: string[] = [];
  if (flags & RoundFlag.Invalid) notes.push(`${fmt.name} has no NaN encoding; OCP MX leaves NaN conversion implementation-defined. This laboratory maps it to +0.`);
  return {
    formatId: fmt.id,
    formatName: fmt.name,
    input,
    value: d.value,
    code: null,
    bits: d.bits,
    width: fmt.totalBits,
    binary: bitsToBinary(d.bits, fmt.totalBits),
    hex: bitsToHex(d.bits, fmt.totalBits),
    cls: d.cls,
    fields,
    formula,
    flags,
    flagLabels: flagLabels(flags),
    exactStored: exactDecimal(d.value),
    shortest: shortestDecimal(fmt, d.value),
    absError: abs,
    relError: rel,
    ulpError: abs !== null && spacing ? abs / spacing : null,
    spacing,
    notes,
  };
}

export function describeInt(fmt: IntFormat, bits: bigint, input: ParsedNumber | null, flags: number, scale: number, notes: string[] = []): InspectedValue {
  const q = decodeInt(fmt, bits);
  const value = q * scale;
  const { fields, formula } = intFields(fmt, bits, q);
  // The represented value q·scale is formed exactly for the error computation.
  const sf = fractionFromNumber(scale);
  const exactValue = sf ? { num: sf.num * BigInt(q), den: sf.den } : null;
  const { abs, rel } = exactValue ? errors(input, exactValue) : errors(input, value);
  return {
    formatId: fmt.id,
    formatName: fmt.name,
    input,
    value,
    code: q,
    bits,
    width: fmt.totalBits,
    binary: bitsToBinary(bits, fmt.totalBits),
    hex: bitsToHex(bits, fmt.totalBits),
    cls: 'integer',
    fields,
    formula: scale === 1 ? formula : `${formula}; value = ${q} × scale ${scale} = ${value}`,
    flags,
    flagLabels: flagLabels(flags),
    exactStored: exactDecimal(value),
    shortest: String(value),
    absError: abs,
    relError: rel,
    ulpError: abs !== null ? abs / scale : null,
    spacing: scale,
    notes,
  };
}

export interface InspectorResult {
  error: string | null;
  primary: InspectedValue | null;
  comparison: InspectedValue[];
  neighbours: { offset: number; value: number; bitsHex: string }[];
  inputExact: string | null;
}

export function optionsFrom(state: InspectorState, formatId: FormatId = state.format): InspectorOptions {
  return { formatId, rounding: state.rounding, overflow: state.overflow, ftz: state.ftz, seed: state.seed, intScale: state.intScale };
}

/** Describes the input exactly, for display ("exact value you typed"). */
export function describeInput(p: ParsedNumber): string {
  if (p.kind === 'nan') return 'NaN';
  if (p.kind === 'inf') return p.negative ? '−∞' : '+∞';
  const sign = p.negative ? '−' : '';
  if (p.den === 1n) return sign + p.num.toString();
  // Terminating decimals (den = 2^a·5^b) are shown exactly; others as a fraction.
  let d = p.den;
  let twos = 0;
  let fives = 0;
  while (d % 2n === 0n) {
    d /= 2n;
    twos++;
  }
  while (d % 5n === 0n) {
    d /= 5n;
    fives++;
  }
  // Every binary64 value (incl. subnormals) has at most 1074 decimal places.
  if (d === 1n && Math.max(twos, fives) <= 2200) {
    const k = Math.max(twos, fives);
    const scaled = (p.num * 10n ** BigInt(k)) / p.den;
    const s = scaled.toString().padStart(k + 1, '0');
    const out = `${s.slice(0, s.length - k)}.${s.slice(s.length - k)}`.replace(/\.?0+$/, '');
    return sign + out;
  }
  return d === 1n ? `${sign}${p.num}/${p.den}` : `${sign}${p.num}/${p.den} (non-terminating decimal)`;
}

export function inspect(state: InspectorState): InspectorResult {
  const opts = optionsFrom(state);
  const fmt = getFormat(state.format);
  let primary: InspectedValue;
  let parsed: ParsedNumber | null = null;
  try {
    if (state.bitsOverride !== null) {
      const bits = BigInt('0x' + state.bitsOverride) & ((1n << BigInt(fmt.totalBits)) - 1n);
      primary = fmt.kind === 'float' ? describeFloat(fmt, bits, null, 0) : describeInt(fmt, bits, null, 0, state.intScale);
    } else {
      parsed = parseExact(state.input);
      primary = inspectParsed(parsed, opts);
    }
  } catch (e) {
    return { error: (e as Error).message, primary: null, comparison: [], neighbours: [], inputExact: null };
  }
  // Comparison: the same exact input (or the edited value) in every selected format.
  const source: ParsedNumber | null = parsed ?? (Number.isNaN(primary.value) ? { kind: 'nan' } : null);
  const comparisonInput = source ?? valueToParsed(primary.value);
  const comparison = state.compareFormats.map((id) => inspectParsed(comparisonInput, optionsFrom(state, id)));
  return {
    error: null,
    primary,
    comparison,
    neighbours: neighbours(state, primary),
    inputExact: parsed ? describeInput(parsed) : null,
  };
}

function valueToParsed(v: number): ParsedNumber {
  if (Number.isNaN(v)) return { kind: 'nan' };
  if (!Number.isFinite(v)) return { kind: 'inf', negative: v < 0 };
  const f = fractionFromNumber(v)!;
  const negative = f.num < 0n || Object.is(v, -0);
  return { kind: 'finite', negative, num: f.num < 0n ? -f.num : f.num, den: f.den };
}

function neighbours(state: InspectorState, p: InspectedValue): InspectorResult['neighbours'] {
  const fmt = getFormat(state.format);
  const k = state.neighbourCount;
  const out: InspectorResult['neighbours'] = [];
  if (fmt.kind === 'int') {
    for (let off = -k; off <= k; off++) {
      const q = p.code! + off;
      if (q < fmt.min || q > fmt.max) continue;
      out.push({ offset: off, value: q * state.intScale, bitsHex: bitsToHex(encodeInt(fmt, q), fmt.totalBits) });
    }
    return out;
  }
  if (!Number.isFinite(p.value)) return [{ offset: 0, value: p.value, bitsHex: p.hex }];
  const below: number[] = [];
  let v: number | null = p.value;
  for (let i = 0; i < k && v !== null; i++) {
    v = nextDownIn(fmt, v);
    if (v !== null) below.unshift(v);
  }
  const above: number[] = [];
  v = p.value;
  for (let i = 0; i < k && v !== null; i++) {
    v = nextUpIn(fmt, v);
    if (v !== null) above.push(v);
  }
  const enc = (x: number) => (Number.isFinite(x) || Number.isNaN(x) || characteristics(fmt).hasInfinity ? bitsToHex(encode(fmt, x), fmt.totalBits) : '');
  below.forEach((x, i) => out.push({ offset: i - below.length, value: x, bitsHex: enc(x) }));
  out.push({ offset: 0, value: p.value, bitsHex: p.hex });
  above.forEach((x, i) => out.push({ offset: i + 1, value: x, bitsHex: enc(x) }));
  return out;
}

/** Toggles one bit (index from the most significant bit) and returns the new hex pattern. */
export function toggleBit(hex: string, width: number, index: number): string {
  const bits = BigInt('0x' + hex) ^ (1n << BigInt(width - 1 - index));
  return bitsToHex(bits, width);
}
