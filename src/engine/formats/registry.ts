import { pow2 } from '../float/double';
import type {
  FloatCharacteristics,
  FloatFormat,
  FloatFormatId,
  FormatId,
  IntFormat,
  IntFormatId,
  NumericFormat,
  SpecReference,
} from './types';

export const REF_IEEE754: SpecReference = {
  title: 'IEEE Standard for Floating-Point Arithmetic (IEEE Std 754-2019)',
  url: 'https://doi.org/10.1109/IEEESTD.2019.8766229',
};
export const REF_BF16: SpecReference = {
  title: 'Google Cloud: The bfloat16 numerical format',
  url: 'https://cloud.google.com/tpu/docs/bfloat16',
};
export const REF_OFP8: SpecReference = {
  title: 'OCP 8-bit Floating Point Specification (OFP8), Revision 1.0, approved June 20, 2023',
  url: 'https://www.opencompute.org/documents/ocp-8-bit-floating-point-specification-ofp8-revision-1-0-2023-12-01-pdf-1',
};
export const REF_MX: SpecReference = {
  title: 'OCP Microscaling Formats (MX) Specification, Version 1.0, September 2023',
  url: 'https://www.opencompute.org/documents/ocp-microscaling-formats-mx-v1-0-spec-final-pdf',
};
export const REF_FNUZ: SpecReference = {
  title: 'Noune et al., "8-bit Numerical Formats for Deep Neural Networks" (arXiv:2206.02915); ml_dtypes float8_*fnuz',
  url: 'https://arxiv.org/abs/2206.02915',
};
export const REF_TWOS: SpecReference = {
  title: "Two's complement signed integers (as used by INT8/INT4 tensor formats)",
};

function float(
  def: Omit<FloatFormat, 'kind' | 'signBits' | 'hasSubnormals'>,
): FloatFormat {
  return { kind: 'float', signBits: 1, hasSubnormals: true, ...def };
}

export const FLOAT_FORMATS: Record<FloatFormatId, FloatFormat> = {
  fp64: float({
    id: 'fp64',
    name: 'FP64',
    profile: 'IEEE 754-2019 binary64 (double precision)',
    totalBits: 64,
    exponentBits: 11,
    fractionBits: 52,
    bias: 1023,
    special: 'ieee',
    overflowSemantics: 'ieee754',
    defaultOverflow: 'nonsaturate',
    variant: false,
    references: [{ ...REF_IEEE754, section: '§3.6 Table 3.5 (binary64)' }],
    notes: ['This is the native JavaScript Number type; all other formats are simulated on top of it.'],
  }),
  fp32: float({
    id: 'fp32',
    name: 'FP32',
    profile: 'IEEE 754-2019 binary32 (single precision)',
    totalBits: 32,
    exponentBits: 8,
    fractionBits: 23,
    bias: 127,
    special: 'ieee',
    overflowSemantics: 'ieee754',
    defaultOverflow: 'nonsaturate',
    variant: false,
    references: [{ ...REF_IEEE754, section: '§3.6 Table 3.5 (binary32)' }],
    notes: [],
  }),
  fp16: float({
    id: 'fp16',
    name: 'FP16',
    profile: 'IEEE 754-2019 binary16 (half precision)',
    totalBits: 16,
    exponentBits: 5,
    fractionBits: 10,
    bias: 15,
    special: 'ieee',
    overflowSemantics: 'ieee754',
    defaultOverflow: 'nonsaturate',
    variant: false,
    references: [{ ...REF_IEEE754, section: '§3.6 Table 3.5 (binary16)' }],
    notes: ['Same exponent width as FP8 E5M2; FP8 E5M2 is FP16 with the low 8 fraction bits removed.'],
  }),
  bf16: float({
    id: 'bf16',
    name: 'BF16',
    profile: 'bfloat16 (Google Brain floating point): binary32 with the fraction truncated to 7 bits',
    totalBits: 16,
    exponentBits: 8,
    fractionBits: 7,
    bias: 127,
    special: 'ieee',
    overflowSemantics: 'ieee754',
    defaultOverflow: 'nonsaturate',
    variant: false,
    references: [REF_BF16],
    notes: [
      'BF16 is not defined by IEEE 754; this profile follows IEEE 754 binary-format semantics (subnormals, ±Inf, NaN) with binary32 exponent range.',
      'Some hardware flushes BF16 subnormals to zero; enable flush-to-zero to simulate that.',
    ],
  }),
  fp8_e4m3: float({
    id: 'fp8_e4m3',
    name: 'FP8 E4M3',
    profile: 'OCP OFP8 E4M3 (also called E4M3FN): no infinities, NaN = S.1111.111',
    totalBits: 8,
    exponentBits: 4,
    fractionBits: 3,
    bias: 7,
    special: 'fn',
    overflowSemantics: 'nan',
    defaultOverflow: 'saturate',
    variant: false,
    references: [{ ...REF_OFP8, section: '§5.1 Tables 1–2; §5.2 Table 3' }],
    notes: [
      'E4M3 gives up infinities so that exponent field 1111 can hold finite values, extending the range to ±448.',
      'OFP8 requires both saturating (overflow → ±448) and non-saturating (overflow → NaN) conversion modes.',
    ],
  }),
  fp8_e5m2: float({
    id: 'fp8_e5m2',
    name: 'FP8 E5M2',
    profile: 'OCP OFP8 E5M2: IEEE-style, ±Inf = S.11111.00, NaN = S.11111.{01,10,11}',
    totalBits: 8,
    exponentBits: 5,
    fractionBits: 2,
    bias: 15,
    special: 'ieee',
    overflowSemantics: 'inf',
    defaultOverflow: 'saturate',
    variant: false,
    references: [{ ...REF_OFP8, section: '§5.1 Tables 1–2; §5.2 Table 3' }],
    notes: ['OFP8 requires both saturating (overflow → ±57344) and non-saturating (overflow → ±Inf) conversion modes.'],
  }),
  fp4_e2m1: float({
    id: 'fp4_e2m1',
    name: 'FP4 E2M1',
    profile: 'OCP MX v1.0 FP4 E2M1 element format: values ±{0, 0.5, 1, 1.5, 2, 3, 4, 6}, no Inf/NaN',
    totalBits: 4,
    exponentBits: 2,
    fractionBits: 1,
    bias: 1,
    special: 'none',
    overflowSemantics: 'saturate-only',
    defaultOverflow: 'saturate',
    variant: false,
    references: [{ ...REF_MX, section: '§5.3.3 Table 5' }],
    notes: [
      'This is the standalone E2M1 element encoding. MXFP4 (block size 32 with an E8M0 shared scale) is a quantization scheme built from it; see the Quantization Workbench presets.',
      'Overflow always saturates to ±6 (MX §5.3.3). NaN inputs have implementation-defined results in the spec; this laboratory maps them to +0 and flags them as invalid.',
    ],
  }),
  fp8_e4m3fnuz: float({
    id: 'fp8_e4m3fnuz',
    name: 'FP8 E4M3 FNUZ',
    profile: 'E4M3FNUZ variant (bias 8, no −0, single NaN = 0x80); not an OCP format',
    totalBits: 8,
    exponentBits: 4,
    fractionBits: 3,
    bias: 8,
    special: 'fnuz',
    overflowSemantics: 'nan',
    defaultOverflow: 'saturate',
    variant: true,
    references: [REF_FNUZ],
    notes: ['Shown for comparison only: it shares the "E4M3" name but has a different bias, range (±240) and NaN encoding.'],
  }),
  fp8_e5m2fnuz: float({
    id: 'fp8_e5m2fnuz',
    name: 'FP8 E5M2 FNUZ',
    profile: 'E5M2FNUZ variant (bias 16, no Inf, no −0, single NaN = 0x80); not an OCP format',
    totalBits: 8,
    exponentBits: 5,
    fractionBits: 2,
    bias: 16,
    special: 'fnuz',
    overflowSemantics: 'nan',
    defaultOverflow: 'saturate',
    variant: true,
    references: [REF_FNUZ],
    notes: ['Shown for comparison only: unlike OCP E5M2 it has no infinities and its bias is 16.'],
  }),
};

function int(def: Omit<IntFormat, 'kind' | 'signed'>): IntFormat {
  return { kind: 'int', signed: true, ...def };
}

export const INT_FORMATS: Record<IntFormatId, IntFormat> = {
  int8: int({
    id: 'int8',
    name: 'INT8',
    profile: "Signed 8-bit two's complement integer, range [−128, 127]",
    totalBits: 8,
    min: -128,
    max: 127,
    references: [REF_TWOS, { ...REF_MX, section: '§5.3.4 (MX INT8 element, symmetric range note)' }],
    notes: ['Symmetric quantization commonly restricts codes to [−127, 127] ("narrow range") so that ±max are mirror images.'],
  }),
  int4: int({
    id: 'int4',
    name: 'INT4',
    profile: "Signed 4-bit two's complement integer, range [−8, 7]",
    totalBits: 4,
    min: -8,
    max: 7,
    references: [REF_TWOS],
    notes: ['Two INT4 values are typically packed per byte; the narrow range [−7, 7] is common for symmetric schemes.'],
  }),
};

export const ALL_FORMATS: Record<FormatId, NumericFormat> = { ...FLOAT_FORMATS, ...INT_FORMATS };

/** Primary formats required by the project, in display order. */
export const PRIMARY_FORMAT_IDS: FormatId[] = [
  'fp64',
  'fp32',
  'fp16',
  'bf16',
  'fp8_e4m3',
  'fp8_e5m2',
  'fp4_e2m1',
  'int8',
  'int4',
];

export const VARIANT_FORMAT_IDS: FloatFormatId[] = ['fp8_e4m3fnuz', 'fp8_e5m2fnuz'];

export const FLOAT_FORMAT_IDS = Object.keys(FLOAT_FORMATS) as FloatFormatId[];

export function getFormat(id: FormatId): NumericFormat {
  const f = ALL_FORMATS[id];
  if (!f) throw new Error(`Unknown format "${id}"`);
  return f;
}

export function isFloatFormatId(id: string): id is FloatFormatId {
  return id in FLOAT_FORMATS;
}

export function isIntFormatId(id: string): id is IntFormatId {
  return id in INT_FORMATS;
}

export function isFormatId(id: string): id is FormatId {
  return id in ALL_FORMATS;
}

export function getFloatFormat(id: FloatFormatId): FloatFormat {
  const f = FLOAT_FORMATS[id];
  if (!f) throw new Error(`Unknown floating-point format "${id}"`);
  return f;
}

const characteristicsCache = new Map<FloatFormatId, FloatCharacteristics>();

/** Derived characteristics computed exactly from the format parameters. */
export function characteristics(fmt: FloatFormat): FloatCharacteristics {
  const cached = characteristicsCache.get(fmt.id);
  if (cached) return cached;
  const m = fmt.fractionBits;
  const precision = m + 1;
  const emin = 1 - fmt.bias;
  const allOnesExp = 2 ** fmt.exponentBits - 1;
  // With IEEE-style specials the all-ones exponent is reserved; otherwise it holds finite values.
  const emax = (fmt.special === 'ieee' ? allOnesExp - 1 : allOnesExp) - fmt.bias;
  // Largest fraction field value usable in the top binade: E4M3 (`fn`) reserves all-ones for NaN.
  const topFraction = fmt.special === 'fn' ? 2 ** m - 2 : 2 ** m - 1;
  const maxFinite = (1 + topFraction / 2 ** m) * pow2(emax);
  const minNormal = pow2(emin);
  const minSubnormal = pow2(emin - m);
  const maxSubnormal = minNormal - minSubnormal;
  const hasInfinity = fmt.special === 'ieee';
  const hasNaN = fmt.special !== 'none';
  const hasNegativeZero = fmt.special !== 'fnuz';
  const total = 2 ** fmt.totalBits;
  let nanEncodings: number;
  switch (fmt.special) {
    case 'ieee':
      nanEncodings = 2 * (2 ** m - 1);
      break;
    case 'fn':
      nanEncodings = 2;
      break;
    case 'fnuz':
      nanEncodings = 1;
      break;
    default:
      nanEncodings = 0;
  }
  const infEncodings = hasInfinity ? 2 : 0;
  const c: FloatCharacteristics = {
    precision,
    emin,
    emax,
    maxFinite,
    minNormal,
    minSubnormal,
    maxSubnormal,
    epsilon: pow2(-m),
    hasInfinity,
    hasNaN,
    hasNegativeZero,
    finiteEncodings: total - nanEncodings - infEncodings,
    nanEncodings,
    dynamicRangeBinades: Math.log2(maxFinite / minSubnormal),
  };
  characteristicsCache.set(fmt.id, c);
  return c;
}

/** Bit width used to store one element of the given format. */
export function formatBits(id: FormatId): number {
  return getFormat(id).totalBits;
}
