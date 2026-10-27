/**
 * Seeded data generators. Every sample is produced from the deterministic
 * PRNG and the deterministic math library, so a (kind, params, shape, seed)
 * tuple always reproduces the same tensor bit-for-bit.
 */
import { exp, log } from '../detmath';
import { Rng } from './prng';

/** Standard normal sampler (Marsaglia polar method) with a cached spare value. */
export class NormalSampler {
  private spare: number | null = null;
  constructor(private readonly rng: Rng) {}

  next(): number {
    if (this.spare !== null) {
      const s = this.spare;
      this.spare = null;
      return s;
    }
    let u: number;
    let v: number;
    let s: number;
    do {
      u = 2 * this.rng.next() - 1;
      v = 2 * this.rng.next() - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const m = Math.sqrt((-2 * log(s)) / s);
    this.spare = v * m;
    return u * m;
  }
}

export type DistributionKind =
  | 'uniform'
  | 'normal'
  | 'lognormal'
  | 'exponential'
  | 'skew-normal'
  | 'laplace'
  | 'student-t'
  | 'outliers'
  | 'sparse'
  | 'narrow'
  | 'bimodal'
  | 'relu'
  | 'model-weights'
  | 'model-activations';

export interface ParamDef {
  key: string;
  label: string;
  default: number;
  min: number;
  max: number;
  step: number;
  integer?: boolean;
  help?: string;
}

export interface DistributionDef {
  kind: DistributionKind;
  name: string;
  category: 'ordinary' | 'skewed' | 'heavy-tailed' | 'pathological' | 'model-like';
  description: string;
  params: ParamDef[];
}

const P = (
  key: string,
  label: string,
  def: number,
  min: number,
  max: number,
  step: number,
  extra: Partial<ParamDef> = {},
): ParamDef => ({ key, label, default: def, min, max, step, ...extra });

export const DISTRIBUTIONS: DistributionDef[] = [
  {
    kind: 'uniform',
    name: 'Uniform',
    category: 'ordinary',
    description: 'Values spread evenly between a lower and upper bound.',
    params: [P('low', 'Lower bound', -1, -1e6, 1e6, 0.1), P('high', 'Upper bound', 1, -1e6, 1e6, 0.1)],
  },
  {
    kind: 'normal',
    name: 'Normal (Gaussian)',
    category: 'ordinary',
    description: 'Bell-shaped distribution; the classic model for weights and noise.',
    params: [P('mean', 'Mean μ', 0, -1e6, 1e6, 0.1), P('std', 'Std. deviation σ', 1, 0, 1e6, 0.05)],
  },
  {
    kind: 'lognormal',
    name: 'Log-normal',
    category: 'skewed',
    description: 'exp(N(μ, σ²)): strictly positive, right-skewed, spans several orders of magnitude when σ is large.',
    params: [
      P('mu', 'μ of log', 0, -20, 20, 0.1),
      P('sigma', 'σ of log', 1, 0, 10, 0.05),
      P('randomSign', 'Random sign (0/1)', 0, 0, 1, 1, { integer: true }),
    ],
  },
  {
    kind: 'exponential',
    name: 'Exponential',
    category: 'skewed',
    description: 'Highly skewed positive values with a long right tail.',
    params: [P('rate', 'Rate λ', 1, 0.001, 1000, 0.1)],
  },
  {
    kind: 'skew-normal',
    name: 'Skew-normal',
    category: 'skewed',
    description: 'Normal distribution with adjustable asymmetry (Azzalini). Shape α = 0 gives a normal.',
    params: [
      P('loc', 'Location ξ', 0, -1e6, 1e6, 0.1),
      P('scale', 'Scale ω', 1, 0, 1e6, 0.05),
      P('shape', 'Shape α', 6, -50, 50, 0.5),
    ],
  },
  {
    kind: 'laplace',
    name: 'Laplace',
    category: 'heavy-tailed',
    description: 'Sharper peak and heavier tails than a normal distribution; typical of trained weights.',
    params: [P('loc', 'Location', 0, -1e6, 1e6, 0.1), P('scale', 'Scale b', 1, 0, 1e6, 0.05)],
  },
  {
    kind: 'student-t',
    name: "Student's t",
    category: 'heavy-tailed',
    description: 'Heavy power-law tails; small degrees of freedom produce frequent extreme values.',
    params: [
      P('dof', 'Degrees of freedom ν', 3, 1, 30, 1, { integer: true }),
      P('scale', 'Scale', 1, 0, 1e6, 0.05),
    ],
  },
  {
    kind: 'outliers',
    name: 'Outlier-heavy normal',
    category: 'pathological',
    description: 'Mostly N(0, σ²), but a small fraction of values are drawn with a much larger σ.',
    params: [
      P('std', 'Base σ', 1, 0, 1e6, 0.05),
      P('fraction', 'Outlier fraction', 0.01, 0, 1, 0.001),
      P('magnitude', 'Outlier σ multiplier', 50, 1, 1e6, 1),
    ],
  },
  {
    kind: 'sparse',
    name: 'Sparse',
    category: 'pathological',
    description: 'Most values are exactly zero; the rest are normal.',
    params: [P('density', 'Non-zero density', 0.1, 0, 1, 0.01), P('std', 'σ of non-zeros', 1, 0, 1e6, 0.05)],
  },
  {
    kind: 'narrow',
    name: 'Narrow range (offset)',
    category: 'pathological',
    description: 'Uniform values in a narrow band far from zero, e.g. 1.000 ± 0.001; stresses precision rather than range.',
    params: [P('center', 'Center', 1, -1e6, 1e6, 0.1), P('width', 'Total width', 0.002, 0, 1e6, 0.001)],
  },
  {
    kind: 'bimodal',
    name: 'Bimodal mixture',
    category: 'ordinary',
    description: 'Mixture of two normal distributions.',
    params: [
      P('mu1', 'Mean 1', -2, -1e6, 1e6, 0.1),
      P('mu2', 'Mean 2', 2, -1e6, 1e6, 0.1),
      P('std', 'σ (both)', 0.5, 0, 1e6, 0.05),
      P('mix', 'Weight of mode 2', 0.5, 0, 1, 0.05),
    ],
  },
  {
    kind: 'relu',
    name: 'Post-ReLU activations',
    category: 'model-like',
    description: 'max(0, N(μ, σ²)): about half the values are exactly zero and the rest are positive.',
    params: [P('mean', 'Pre-activation μ', 0, -1e6, 1e6, 0.1), P('std', 'Pre-activation σ', 1, 0, 1e6, 0.05)],
  },
  {
    kind: 'model-weights',
    name: 'Model-like weight matrix',
    category: 'model-like',
    description: 'N(0, (gain/√cols)²) per element (fan-in scaling), with a few output rows (channels) scaled up — the situation where per-channel scaling helps.',
    params: [
      P('gain', 'Gain', 1, 0, 100, 0.1),
      P('outlierRows', 'Outlier rows (fraction)', 0.05, 0, 1, 0.01),
      P('rowScale', 'Outlier row scale', 8, 1, 1000, 1),
    ],
  },
  {
    kind: 'model-activations',
    name: 'Activations with outlier features',
    category: 'model-like',
    description: 'N(0, 1) per element, but a few feature columns carry systematically huge magnitudes, as reported for large transformer activations.',
    params: [
      P('outlierCols', 'Outlier columns (count)', 2, 0, 64, 1, { integer: true }),
      P('magnitude', 'Outlier magnitude', 60, 1, 1e5, 1),
    ],
  },
];

export function distributionDef(kind: DistributionKind): DistributionDef {
  const d = DISTRIBUTIONS.find((x) => x.kind === kind);
  if (!d) throw new Error(`Unknown distribution "${kind}"`);
  return d;
}

export function defaultParams(kind: DistributionKind): Record<string, number> {
  return Object.fromEntries(distributionDef(kind).params.map((p) => [p.key, p.default]));
}

export interface GeneratorSpec {
  kind: DistributionKind;
  params: Record<string, number>;
  rows: number;
  cols: number;
  seed: number;
}

export const MAX_GENERATED_ELEMENTS = 1 << 20;

/** Generates a row-major rows×cols tensor deterministically. */
export function generate(spec: GeneratorSpec): Float64Array {
  const { rows, cols } = spec;
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || cols < 1) {
    throw new RangeError('Shape must be positive integers');
  }
  const n = rows * cols;
  if (n > MAX_GENERATED_ELEMENTS) throw new RangeError(`At most ${MAX_GENERATED_ELEMENTS} elements can be generated`);
  const p = { ...defaultParams(spec.kind), ...spec.params };
  const rng = new Rng(spec.seed);
  const normal = new NormalSampler(rng);
  const out = new Float64Array(n);
  const num = (k: string) => p[k] ?? 0;
  switch (spec.kind) {
    case 'uniform': {
      const lo = num('low');
      const hi = num('high');
      for (let i = 0; i < n; i++) out[i] = lo + (hi - lo) * rng.next();
      break;
    }
    case 'normal':
      for (let i = 0; i < n; i++) out[i] = num('mean') + num('std') * normal.next();
      break;
    case 'lognormal': {
      const signRng = rng.fork(1);
      for (let i = 0; i < n; i++) {
        const v = exp(num('mu') + num('sigma') * normal.next());
        out[i] = num('randomSign') >= 0.5 && signRng.next() < 0.5 ? -v : v;
      }
      break;
    }
    case 'exponential':
      for (let i = 0; i < n; i++) out[i] = -log(1 - rng.next()) / num('rate');
      break;
    case 'skew-normal': {
      const a = num('shape');
      const delta = a / Math.sqrt(1 + a * a);
      const comp = Math.sqrt(1 - delta * delta);
      for (let i = 0; i < n; i++) {
        const u0 = normal.next();
        const u1 = normal.next();
        out[i] = num('loc') + num('scale') * (delta * Math.abs(u0) + comp * u1);
      }
      break;
    }
    case 'laplace':
      for (let i = 0; i < n; i++) {
        const u = rng.next() - 0.5;
        const s = u < 0 ? -1 : 1;
        out[i] = num('loc') - num('scale') * s * log(1 - 2 * Math.abs(u));
      }
      break;
    case 'student-t': {
      const dof = Math.max(1, Math.round(num('dof')));
      for (let i = 0; i < n; i++) {
        const z = normal.next();
        let chi2 = 0;
        for (let k = 0; k < dof; k++) {
          const g = normal.next();
          chi2 += g * g;
        }
        out[i] = (num('scale') * z) / Math.sqrt(chi2 / dof);
      }
      break;
    }
    case 'outliers': {
      const pick = rng.fork(2);
      for (let i = 0; i < n; i++) {
        const isOutlier = pick.next() < num('fraction');
        out[i] = num('std') * (isOutlier ? num('magnitude') : 1) * normal.next();
      }
      break;
    }
    case 'sparse': {
      const pick = rng.fork(3);
      for (let i = 0; i < n; i++) {
        const v = num('std') * normal.next();
        out[i] = pick.next() < num('density') ? v : 0;
      }
      break;
    }
    case 'narrow':
      for (let i = 0; i < n; i++) out[i] = num('center') + num('width') * (rng.next() - 0.5);
      break;
    case 'bimodal': {
      const pick = rng.fork(4);
      for (let i = 0; i < n; i++) {
        const mu = pick.next() < num('mix') ? num('mu2') : num('mu1');
        out[i] = mu + num('std') * normal.next();
      }
      break;
    }
    case 'relu':
      for (let i = 0; i < n; i++) out[i] = Math.max(0, num('mean') + num('std') * normal.next());
      break;
    case 'model-weights': {
      const std = num('gain') / Math.sqrt(cols);
      const pick = rng.fork(5);
      const rowScale = new Float64Array(rows);
      for (let r = 0; r < rows; r++) rowScale[r] = pick.next() < num('outlierRows') ? num('rowScale') : 1;
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) out[r * cols + c] = rowScale[r]! * std * normal.next();
      break;
    }
    case 'model-activations': {
      const k = Math.min(cols, Math.max(0, Math.round(num('outlierCols'))));
      const pick = rng.fork(6);
      const chosen = new Set<number>();
      while (chosen.size < k) chosen.add(pick.nextInt(cols));
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          const v = normal.next();
          out[r * cols + c] = chosen.has(c) ? num('magnitude') * (1 + 0.25 * v) : v;
        }
      break;
    }
  }
  return out;
}
