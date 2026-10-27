/**
 * Preset inputs for the Number Inspector. Many depend on the selected format
 * (its max, min normal, rounding boundaries), so presets are functions.
 */
import { exactDecimal, parseExact } from '@/engine/float/rational';
import { characteristics, getFormat } from '@/engine/formats/registry';
import type { FormatId } from '@/engine/formats/types';
import { pow2 } from '@/engine/float/double';
import { ExactSum } from '@/engine/arith/exact';
import { describeInput } from './inspector';

/** Exact decimal of a sum of doubles (works even when the sum exceeds FP64). */
function exactSumDecimal(...xs: number[]): string {
  const s = new ExactSum();
  for (const x of xs) s.add(x);
  return describeInput(s.toParsed()).replace('−', '-');
}

export interface InspectorPreset {
  id: string;
  label: string;
  group: 'Everyday values' | 'Special values' | 'Format limits' | 'Rounding boundaries';
  description: string;
  value: (format: FormatId) => string | null;
}

/** π and e to 60 significant digits (enough to round correctly to FP64). */
export const PI_60 = '3.14159265358979323846264338327950288419716939937510582097494';
export const E_60 = '2.71828182845904523536028747135266249775724709369995957496697';

function floatOnly(format: FormatId, f: (c: ReturnType<typeof characteristics>, m: number) => string | null): string | null {
  const fmt = getFormat(format);
  if (fmt.kind !== 'float') return null;
  return f(characteristics(fmt), fmt.fractionBits);
}

export const INSPECTOR_PRESETS: InspectorPreset[] = [
  { id: 'one', label: '1.0', group: 'Everyday values', description: 'Exactly representable in every format.', value: () => '1' },
  { id: 'minus-one', label: '−1.0', group: 'Everyday values', description: 'Only the sign bit changes.', value: () => '-1' },
  { id: 'tenth', label: '0.1', group: 'Everyday values', description: '1/10 has an infinite binary expansion (0.000110011…), so every binary format rounds it.', value: () => '0.1' },
  { id: 'third', label: '1/3', group: 'Everyday values', description: 'Entered as an exact fraction; non-terminating in binary and decimal.', value: () => '1/3' },
  { id: 'pi', label: 'π', group: 'Everyday values', description: 'π to 60 significant digits.', value: () => PI_60 },
  { id: 'e', label: 'e', group: 'Everyday values', description: "Euler's number to 60 significant digits.", value: () => E_60 },
  { id: '1000', label: '1000.7', group: 'Everyday values', description: 'A moderate number with a fractional part — watch FP8/FP4 lose the fraction or overflow.', value: () => '1000.7' },
  { id: 'pzero', label: '+0', group: 'Special values', description: 'Positive zero: all bits clear.', value: () => '0' },
  { id: 'nzero', label: '−0', group: 'Special values', description: 'Negative zero: only the sign bit set. Equal to +0 in comparisons, but 1/−0 = −∞. INT formats and FNUZ variants have no −0.', value: () => '-0' },
  { id: 'inf', label: '+∞', group: 'Special values', description: 'Infinity exists in IEEE formats and OCP E5M2. E4M3 and FP4 cannot represent it (saturation or NaN).', value: () => 'inf' },
  { id: 'ninf', label: '−∞', group: 'Special values', description: 'Negative infinity.', value: () => '-inf' },
  { id: 'nan', label: 'NaN', group: 'Special values', description: 'Not a Number. FP4 E2M1 and integers have no NaN encoding.', value: () => 'nan' },
  {
    id: 'max',
    label: 'Max finite',
    group: 'Format limits',
    description: 'The largest finite value of the selected format.',
    value: (f) => (getFormat(f).kind === 'int' ? String((getFormat(f) as { max: number }).max) : floatOnly(f, (c) => exactDecimal(c.maxFinite))),
  },
  { id: 'min-normal', label: 'Min normal', group: 'Format limits', description: 'The smallest positive normal value, 2^emin.', value: (f) => floatOnly(f, (c) => exactDecimal(c.minNormal)) },
  { id: 'max-sub', label: 'Max subnormal', group: 'Format limits', description: 'The largest subnormal: all fraction bits set with exponent field 0.', value: (f) => floatOnly(f, (c) => exactDecimal(c.maxSubnormal)) },
  { id: 'min-sub', label: 'Min subnormal', group: 'Format limits', description: 'The smallest positive value: only the last fraction bit set.', value: (f) => floatOnly(f, (c) => exactDecimal(c.minSubnormal)) },
  {
    id: 'underflow',
    label: 'Half min subnormal',
    group: 'Format limits',
    description: 'Exactly halfway between 0 and the smallest subnormal: ties-to-even rounds to 0 (underflow), round-up gives the min subnormal.',
    value: (f) => floatOnly(f, (c, m) => describeInput(parseExact(`0x1p${c.emin - m - 1}`))),
  },
  {
    id: 'overflow-tie',
    label: 'Overflow boundary',
    group: 'Rounding boundaries',
    description: 'Max finite + ½ spacing: the first value whose round-to-nearest result exceeds the format (it ties; check what each overflow mode does).',
    value: (f) => floatOnly(f, (c, m) => exactSumDecimal(c.maxFinite, pow2(c.emax - m - 1))),
  },
  {
    id: 'just-below-overflow',
    label: 'Just below overflow',
    group: 'Rounding boundaries',
    description: 'Slightly less than max + ½ spacing: rounds down to max finite.',
    value: (f) => floatOnly(f, (c, m) => exactSumDecimal(c.maxFinite, pow2(c.emax - m - 1), -pow2(c.emax - m - 10))),
  },
  {
    id: 'tie-one',
    label: '1 + ½ε (tie)',
    group: 'Rounding boundaries',
    description: 'Exactly halfway between 1 and the next value. Ties-to-even keeps 1 (even last bit); ties-away gives 1 + ε.',
    value: (f) => floatOnly(f, (_c, m) => exactSumDecimal(1, pow2(-m - 1))),
  },
  {
    id: 'tie-one-up',
    label: '1 + ½ε + tiny',
    group: 'Rounding boundaries',
    description: 'Just above the tie: round-to-nearest now goes up.',
    value: (f) => floatOnly(f, (_c, m) => `${exactSumDecimal(1, pow2(-m - 1))}000000000000000000001`),
  },
  {
    id: 'tie-odd',
    label: '1 + 1½ε (tie)',
    group: 'Rounding boundaries',
    description: 'Halfway between 1+ε (odd last bit) and 1+2ε (even): ties-to-even now rounds up.',
    value: (f) => floatOnly(f, (_c, m) => exactSumDecimal(1, pow2(-m), pow2(-m - 1))),
  },
  { id: 'int-half', label: '2.5 (integer tie)', group: 'Rounding boundaries', description: 'For integer formats: ties-to-even gives 2, ties-away gives 3.', value: () => '2.5' },
];
