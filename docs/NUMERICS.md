# Numerical conventions and algorithms

This document specifies exactly what the numerical engine (`src/engine/`) computes. It is written for software engineers who know IEEE 754 floating point but are new to low-precision formats and LLM quantization.

> **Simulation, not hardware.** Every format is *simulated* on top of JavaScript's native binary64 (`number`). All values of all supported formats are exactly representable as binary64, so the simulation is exact. It does not reproduce vendor-specific hardware behaviour such as tensor-core accumulation trees, internal truncation, or fused operations, except where a rule below says so explicitly.

## 1. Element formats

An *element format* describes how one number is encoded in bits. A *quantization scheme* (section 4) combines an element format with shared scaling metadata such as scales and zero-points. The two are kept strictly separate. FP4 E2M1 is an element format; MXFP4 is a scheme built from it.

| Format | Profile / specification | Bits (S/E/M) | Bias | Max finite | Min normal | Min subnormal | Inf | NaN encodings |
|---|---|---|---|---|---|---|---|---|
| FP64 | IEEE 754-2019 binary64 | 1/11/52 | 1023 | ≈1.798e308 | 2^−1022 | 2^−1074 | yes | exp all-ones, fraction ≠ 0 |
| FP32 | IEEE 754-2019 binary32 | 1/8/23 | 127 | ≈3.403e38 | 2^−126 | 2^−149 | yes | as IEEE |
| FP16 | IEEE 754-2019 binary16 | 1/5/10 | 15 | 65504 | 2^−14 | 2^−24 | yes | as IEEE |
| BF16 | bfloat16 (Google); IEEE-style semantics with the binary32 exponent | 1/8/7 | 127 | ≈3.390e38 | 2^−126 | 2^−133 | yes | as IEEE |
| FP8 E4M3 | OCP OFP8 rev 1.0 E4M3 (also called E4M3FN) | 1/4/3 | 7 | 448 | 2^−6 | 2^−9 | **no** | only S.1111.111 |
| FP8 E5M2 | OCP OFP8 rev 1.0 E5M2 | 1/5/2 | 15 | 57344 | 2^−14 | 2^−16 | yes (S.11111.00) | S.11111.{01,10,11} |
| FP4 E2M1 | OCP MX v1.0 §5.3.3 element type | 1/2/1 | 1 | 6 | 1 | 0.5 | no | **none** |
| INT8 | two's complement | 8 | — | 127 | — | — | — | — |
| INT4 | two's complement | 4 | — | 7 | — | — | — | — |

The following variants are included **for comparison only** and are labelled as such in the UI:

| Variant | Profile | Bias | Max | Special values |
|---|---|---|---|---|
| FP8 E4M3 FNUZ | Graphcore/AMD style, `ml_dtypes.float8_e4m3fnuz` | 8 | 240 | single NaN 0x80, no −0, no Inf |
| FP8 E5M2 FNUZ | `ml_dtypes.float8_e5m2fnuz` | 16 | 57344 | single NaN 0x80, no −0, no Inf |

These variants show why "E4M3" alone does not name a format: E4M3 and E4M3FNUZ share the bit layout but differ in bias, range and NaN encoding.

Value formulas, with S the sign, E the biased exponent field, M the fraction field, m the number of fraction bits, and emin = 1 − bias:

- normal (E ≠ 0): (−1)^S × 2^(E−bias) × (1 + M/2^m)
- subnormal (E = 0): (−1)^S × 2^emin × (M/2^m)

The largest exponent field is finite in E4M3, FNUZ and E2M1. E4M3 reserves only the pattern with all fraction bits set (NaN), so its top binade ends at 1.75 × 2^8 = 448.

### Why FP16 and BF16 differ

Both formats are 16 bits wide. FP16 spends 10 bits on the fraction and 5 on the exponent, giving about 3.3 decimal digits of precision but a maximum of only 65504. BF16 keeps FP32's 8-bit exponent, so it has the same range (up to about 3.4e38), but only 7 fraction bits, about 2.4 digits. FP16 represents 1 + 2^−10; BF16's spacing at 1.0 is 2^−7 = 0.0078125.

## 2. Rounding (conversion) algorithm

Conversion of a real value v to a binary floating-point format with m fraction bits works as follows (`src/engine/float/round.ts`):

1. Read e = ⌊log2|v|⌋ exactly from the binary64 bit pattern. Subnormal doubles are included, and no `Math.log2` is involved.
2. Compute the quantum exponent qe = max(e, emin) − m. Below emin the spacing stays fixed at 2^(emin−m), and that fixed spacing is what produces subnormals.
3. Compute |v| / 2^qe = n + r. Division by a power of two is exact, so n and the remainder r ∈ [0, 1) are exact.
4. The rounding mode decides between n and n + 1 using only whether r = 0, r < ½, r = ½ or r > ½. Stochastic rounding uses r directly.
5. The rounded magnitude (n or n + 1) × 2^qe is computed as if the exponent range were unbounded. It is then checked against the largest finite value, and the overflow rules below apply.
6. Underflow: a non-zero value that rounds to zero keeps its sign (±0). With flush-to-zero (FTZ) enabled, a subnormal *result* is replaced by a zero of the same sign.

A second, independent implementation (`src/engine/float/rational.ts`) performs the same rounding on exact BigInt rationals. It is used for typed decimal input: "0.1" is rounded directly to the target format, with no detour through FP64 and therefore no double rounding. The test suite also uses it to cross-check the fast path.

### Rounding modes

| Mode | Definition | Source |
|---|---|---|
| Nearest, ties to even (RNE) | nearest value; on an exact tie, the one with an even last fraction bit | IEEE 754 roundTiesToEven; required by OCP OFP8 and MX |
| Nearest, ties away (RNA) | nearest value; ties away from zero | IEEE 754 roundTiesToAway |
| Toward zero (RTZ) | truncate the magnitude | IEEE 754 roundTowardZero |
| Toward +∞ (RU) | ceiling | IEEE 754 roundTowardPositive |
| Toward −∞ (RD) | floor | IEEE 754 roundTowardNegative |
| Stochastic (SR) | round up with probability r (the fractional distance to the lower neighbour), using the seeded xoshiro128** generator with 53-bit uniforms | **software simulation**; hardware SR uses few random bits |

Values that are exactly representable are always returned unchanged, with no inexact flag, in every mode, including SR.

### Overflow rules

| Format family | Saturating mode | Non-saturating mode |
|---|---|---|
| IEEE formats (FP64/FP32/FP16/BF16) | ±max | IEEE 754-2019 §7.4: RNE/RNA/SR → ±Inf; RTZ → ±max; RU → +Inf / −max; RD → +max / −Inf |
| OCP E5M2 | ±max (57344) | ±Inf (OFP8 Table 3) |
| OCP E4M3 | ±max (448) | NaN (OFP8 Table 3) |
| FNUZ variants | ±max | NaN (as `ml_dtypes`) |
| FP4 E2M1 | ±max (6), always | (not available: MX §5.3.3 requires clamping) |

Inputs of ±Inf follow OFP8 Table 3: saturating mode gives ±max, and non-saturating mode gives ±Inf (or NaN for E4M3). NaN inputs produce a canonical NaN. **FP4 E2M1 has no NaN**: MX §5.3.3 leaves NaN conversion implementation-defined, and this laboratory maps NaN to +0 and raises the `Invalid` flag, which the UI reports.

Note that OFP8 rev 1.0 defines only RNE. Other rounding modes are applied as extensions: round with an unbounded exponent, then apply OFP8 Table 3. For example, under RTZ the value 1000 rounds to 960 in E4M3 with an unbounded exponent; that exceeds 448, so the result is NaN in non-saturating mode.

### Flags

Every conversion reports a bitmask: `Inexact`, `Overflow`, `Saturated`, `Underflow` (tiny and inexact), `Flushed`, `Subnormal`, `ZeroFromNonzero`, `Invalid`, `NaNResult` and `InfResult`.

## 3. Integer formats

INT8 is [−128, 127] and INT4 is [−8, 7], both two's complement. Symmetric schemes may use the **narrow range** [−127, 127] or [−7, 7], so that +max and −max mirror each other. OCP MX §5.3.4 notes the same option for INT8. Two INT4 values per byte is the usual packing; the storage estimate counts 4 bits per element.

## 4. Quantization schemes

Tensors are 2-D and row-major with shape [rows, cols]; a vector is [1, n].

**Integer targets (affine quantization):**

```
q  = clamp(round(x / s) + z, qmin, qmax)
x̂ = s · (q − z)
```

**Floating-point targets (scaled conversion):** q = convert(x / s), x̂ = s · q. Without scaling, it is a plain cast: q = convert(x).

`x / s` and `s · (q − z)` are evaluated in FP64 (correctly rounded). `round` uses the selected rounding mode exactly. NaN inputs map to q = z (integer) or follow the format rules (float), and are flagged `Invalid`. ±Inf inputs clamp to qmin/qmax for integer targets; floating-point targets follow the overflow policy (±max when saturating, otherwise ±Inf or NaN).

### Granularity

| Granularity | Blocks sharing one (s, z) |
|---|---|
| per-tensor | the whole tensor |
| per-channel, axis 0 | each row (e.g. each output channel of a weight W[out, in]) |
| per-channel, axis 1 | each column |
| per-group, axis 0 | each row split into contiguous runs of `groupSize` columns |
| per-group, axis 1 | each column split into contiguous runs of `groupSize` rows |

If the slice length is not a multiple of the group size, the last group of each slice is shorter. The UI shows a warning when this happens.

### Calibration

Calibration chooses a clipping range per block from its finite values:

- **Min/max.** Symmetric: amax = max|x|. Asymmetric: [min(x_min, 0), max(x_max, 0)]. The range always includes 0, so 0 is exactly representable.
- **Percentile p.** Symmetric: amax = P_p(|x|). Asymmetric: [P_(100−p)(x), P_p(x)], extended to include 0. P uses linear interpolation between closest ranks (Hyndman–Fan type 7, NumPy's default).
- **MSE grid search.** Evaluate the clipping ratios α_k = αmin + (1 − αmin)·k/N for k = 1…N (α = 1 is min/max). Scale the min/max range by α_k, quantize the block with the configured rounding mode (RNE when stochastic rounding is selected, so the search is deterministic), and keep the candidate with the smallest mean squared error. Ties go to the larger α. *This is a grid search over one parameter. It finds the best candidate on the grid, not a proven global optimum.*
- **Manual.** The user-supplied s, and z for asymmetric schemes, are used verbatim. s must be finite and positive; z must be an integer within [qmin, qmax]. Invalid values are rejected, never corrected.
- **MX power-of-two rule** (OCP MX v1.0 §6.3): X = 2^(⌊log2 max|V|⌋ − e_max,elem), where e_max,elem is the exponent of the largest power of two representable in the element type. That is 2 for FP4, 8 for E4M3, 15 for E5M2, and 6 for INT8 (127 ≥ 2^6). X is clamped to the E8M0 range 2^−127 … 2^127. An all-zero block gets X = 2^−127 and is flagged degenerate. Elements that exceed the element max after scaling are clamped (saturated), as §6.3 requires. With block size 32, element FP4 E2M1, an E8M0 scale, RNE and saturation, this is MXFP4 as specified in §6.3. MXFP8 (E4M3/E5M2) follows the same pattern.

Scale computation from the chosen range:

- Symmetric: s = amax / q_max_grid, where q_max_grid is 127, 7, or the element format's max finite value.
- Asymmetric: s = (hi − lo) / (qmax − qmin), and z = clamp(RNE(qmin − lo / s), qmin, qmax).

Scales are then **rounded to the scale storage format**: FP64, FP32, FP16 and BF16 use RNE with saturation. A scale that underflows to 0, either when computed in FP64 or when rounded to the storage format, is replaced by that format's smallest subnormal and flagged; a scale that overflows FP64 is replaced by the largest double and flagged. For E8M0, the scale is rounded *up* to a power of two so that the calibrated range is still covered. z is computed with the stored scale.

**Degenerate blocks** (all zeros) use s = 1. Every scale reproduces zeros exactly, and the block is flagged `degenerate`. A constant non-zero block is not degenerate: its range [0, c] or [−c, c] is handled normally and reconstructs c to within FP64 rounding.

### Storage estimate

Total bits = elements × element bits + blocks × scale bits + blocks × zero-point bits. Zero-points are counted at the element bit width. Group layout parameters are per-tensor constants and are counted as zero. The browser holds every tensor as FP64 arrays for inspection, and the UI reports that in-memory size separately. **A smaller encoding does not imply proportional speed, bandwidth or energy savings.**

## 5. Error metrics

All metrics compare a reference x with an approximation x̂ (`src/engine/metrics/error.ts`).

- MAE, MSE, RMSE and max |x − x̂| are computed over pairs where both values are finite. Non-finite pairs are counted separately.
- **Relative error** is |x − x̂| / |x|. When x = 0 it is *undefined*: such pairs are excluded from the aggregate and counted, except when x̂ = 0 as well, which counts as exact (0).
- **Cosine similarity** is undefined (shown as "—") when either vector has zero norm.
- **SNR** is 10·log10(Σx² / Σ(x − x̂)²) dB. It is +∞ when the error is exactly zero and undefined when Σx² = 0.
- **Zero rate** is the fraction of x̂ equal to ±0. **Zero-collapse rate** is the fraction of non-zero x whose x̂ is 0.
- **Saturation rate** is the fraction of elements that were clamped or saturated, or that overflowed.
- Sums of squares of x, x̂ and x − x̂ are each accumulated after dividing by their own exact power of two near the respective largest magnitude, so neither tiny (subnormal) nor huge values underflow or overflow the intermediate sums.

## 6. Simulated arithmetic

`src/engine/arith/` applies these rules exactly:

- **Products:** a·b is computed exactly (Dekker TwoProduct; when the binary64 product overflows or comes within 2^53 of the subnormal range, the exact BigInt product is used instead) and rounded once to the *product format*.
- **Sums:** acc + p is computed exactly (Knuth TwoSum; exact BigInt sum when the binary64 sum overflows) and rounded once to the *accumulator format*, so overflow follows the target's rules, including IEEE 754 §7.4 under directed rounding. Directed rounding of arithmetic results is therefore exact: the error term acts as a sticky bit, so no double rounding occurs.
- **Summation orders:**
  - *sequential* (left to right);
  - *pairwise* (balanced tree);
  - *blocked* (sequential within blocks of B elements; block results accumulated in an "outer" format, which models periodic promotion of partial sums);
  - *Kahan* (compensated, with every operation rounded to the accumulator format).
- **Output:** the result is rounded to the *output format*.
- **Exact reference:** the exact dot product of the stored operands is computed with BigInt dyadic arithmetic and rounded once to FP64. This lets the UI split the error into a storage part (exact(x̂) − exact(x)) and an arithmetic part (simulated − exact(x̂)).
- **Integer path** (INT8/INT4 operands): C[i,j] = Σ_segments s_A s_B Σ_k (q_A − z_A)(q_B − z_B). A segment is a run of k with a single scale per operand. The integer sums use an INT32 accumulator, which can be set to wrap, saturate or stay exact. Overflow is detected and reported. Each rescaled segment s_A·s_B·Σ is formed exactly and rounded once to the rescale format.

These rules model a machine that rounds after every operation. They are **not** claimed to match any particular GPU instruction.

## 7. Determinism

- **PRNG:** xoshiro128** 1.1 seeded by SplitMix32, using only 32-bit integer operations. It is verified against the reference C code.
- **Transcendental functions:** ECMAScript allows `Math.exp`, `Math.log` and `Math.tanh` to differ between engines. Generators and activations therefore use `src/engine/detmath`: ports of fdlibm `exp`/`log` (< 1 ulp) and functions derived from them. Only +, −, ×, ÷ and √ are used, and JavaScript evaluates those with correct rounding.
- Given the same inputs and seed, every computation is bit-identical across browsers.

## 8. Verification and provenance

See `tests/fixtures/README.md` for the provenance of each reference fixture and how to regenerate it. In summary:

| Check | Reference |
|---|---|
| Exhaustive decode of FP8/FP4/FNUZ (all patterns), FP16 and BF16 (all 65,536 patterns) | ml_dtypes, NumPy |
| RNE conversions to every reduced format | ml_dtypes (float32-representable inputs), NumPy |
| Directed rounding to FP32/FP16; FP32 add/mul under all four IEEE modes | C `fesetround` on x86-64 (gcc, `-frounding-math`) |
| Rounding of every adjacent pair, midpoint and near-midpoint in all 8-bit and 4-bit formats, all deterministic modes | brute-force neighbour search (independent algorithm) |
| Fast path vs. exact rational path | BigInt implementation (independent algorithm) |
| Spec tables (max, min normal, subnormals, encodings) | hand-transcribed from OFP8 Tables 1–3, MX Table 5, IEEE 754 Table 3.5 |
| Affine INT8/INT4 quantization, percentiles | independent NumPy implementation |
| Dot products, FP16/FP32 sequential accumulation | `fractions.Fraction`, NumPy scalar arithmetic |
| PRNG stream | xoshiro128** reference C code |
| `exp`/`log` | `Math.exp`/`Math.log` (≤ 1 ulp) |

A finding from this verification: `ml_dtypes` 0.6.0 converts **float64** inputs to FP8 by way of float32, which can double-round. For example, 1.0625 + 2^−40 should round up to 1.125 in E4M3, but `ml_dtypes` produces 1.0. The fixtures therefore use only float32-representable inputs. The test `rounding.test.ts` demonstrates the correct behaviour with a decimal string.
