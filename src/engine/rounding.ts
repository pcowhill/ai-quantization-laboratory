/**
 * Rounding modes and the shared rounding decision logic.
 *
 * All modes operate on an exact description of the value to be rounded:
 * an integer part `n` (in units of the target quantum) and a classification
 * of the exact remainder. That keeps every mode exact regardless of whether
 * the value came from a double, from a double plus an error term, or from an
 * arbitrary-precision rational.
 */

export type RoundingMode =
  | 'nearest-even'
  | 'nearest-away'
  | 'toward-zero'
  | 'toward-positive'
  | 'toward-negative'
  | 'stochastic';

export interface RoundingModeInfo {
  id: RoundingMode;
  name: string;
  short: string;
  description: string;
  /** IEEE 754-2019 attribute name, when the mode is defined there. */
  ieee?: string;
  simulation: boolean;
}

export const ROUNDING_MODES: RoundingModeInfo[] = [
  {
    id: 'nearest-even',
    name: 'Round to nearest, ties to even',
    short: 'RNE',
    description: 'Pick the nearest representable value; exact halfway cases go to the one with an even last digit. Default in IEEE 754 and required by OCP OFP8/MX.',
    ieee: 'roundTiesToEven',
    simulation: false,
  },
  {
    id: 'nearest-away',
    name: 'Round to nearest, ties away from zero',
    short: 'RNA',
    description: 'Pick the nearest representable value; halfway cases go away from zero (like school rounding).',
    ieee: 'roundTiesToAway',
    simulation: false,
  },
  {
    id: 'toward-zero',
    name: 'Round toward zero',
    short: 'RTZ',
    description: 'Truncate: choose the representable value with the largest magnitude not exceeding the exact magnitude.',
    ieee: 'roundTowardZero',
    simulation: false,
  },
  {
    id: 'toward-positive',
    name: 'Round toward +∞',
    short: 'RU',
    description: 'Choose the smallest representable value ≥ the exact value (ceiling).',
    ieee: 'roundTowardPositive',
    simulation: false,
  },
  {
    id: 'toward-negative',
    name: 'Round toward −∞',
    short: 'RD',
    description: 'Choose the largest representable value ≤ the exact value (floor).',
    ieee: 'roundTowardNegative',
    simulation: false,
  },
  {
    id: 'stochastic',
    name: 'Stochastic rounding (seeded)',
    short: 'SR',
    description: 'Round up with probability equal to the fractional distance to the lower neighbour, using a seeded pseudo-random generator. Unbiased in expectation. Software simulation: hardware stochastic rounding uses a limited number of random bits.',
    simulation: true,
  },
];

export const ROUNDING_MODE_IDS = ROUNDING_MODES.map((m) => m.id);

export function roundingModeInfo(id: RoundingMode): RoundingModeInfo {
  const info = ROUNDING_MODES.find((m) => m.id === id);
  if (!info) throw new Error(`Unknown rounding mode "${id}"`);
  return info;
}

export function isRoundingMode(x: unknown): x is RoundingMode {
  return typeof x === 'string' && (ROUNDING_MODE_IDS as string[]).includes(x);
}

/** Classification of the exact remainder r in [0, 1) relative to 1/2. */
export const Frac = {
  Zero: 0,
  BelowHalf: 1,
  Half: 2,
  AboveHalf: 3,
} as const;
export type Frac = (typeof Frac)[keyof typeof Frac];

/** A uniform random source returning doubles in [0, 1). */
export type UniformSource = () => number;

/**
 * Decides whether a non-negative magnitude n + r (n integer, r ∈ [0,1)) with
 * sign `negative` rounds up to n + 1 (true) or down to n (false).
 *
 * `fracValue` is the (approximate) value of r used only for stochastic
 * rounding; `rng` must be provided for stochastic rounding.
 */
export function roundsUp(
  mode: RoundingMode,
  n: number,
  frac: Frac,
  negative: boolean,
  fracValue: number,
  rng?: UniformSource,
): boolean {
  if (frac === Frac.Zero) return false;
  switch (mode) {
    case 'nearest-even':
      return frac === Frac.AboveHalf || (frac === Frac.Half && n % 2 === 1);
    case 'nearest-away':
      return frac !== Frac.BelowHalf;
    case 'toward-zero':
      return false;
    case 'toward-positive':
      return !negative;
    case 'toward-negative':
      return negative;
    case 'stochastic': {
      if (!rng) throw new Error('Stochastic rounding requires a random source');
      return rng() < fracValue;
    }
  }
}

/**
 * Rounds a finite double to an integer using the given mode. Used for
 * integer quantization (q = round(x / scale)). Exact for every double input.
 */
export function roundToInteger(v: number, mode: RoundingMode, rng?: UniformSource): number {
  if (!Number.isFinite(v)) return v;
  const negative = v < 0 || Object.is(v, -0);
  const a = Math.abs(v);
  const n = Math.floor(a);
  const f = a - n; // exact for doubles
  let frac: Frac;
  if (f === 0) frac = Frac.Zero;
  else if (f < 0.5) frac = Frac.BelowHalf;
  else if (f === 0.5) frac = Frac.Half;
  else frac = Frac.AboveHalf;
  const m = roundsUp(mode, n, frac, negative, f, rng) ? n + 1 : n;
  // Integers have no signed zero; normalise −0 to +0.
  return negative ? (m === 0 ? 0 : -m) : m;
}
