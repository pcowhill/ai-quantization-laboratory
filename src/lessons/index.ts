/**
 * Guided lessons. Every step configures the real laboratories (setup),
 * explains what is on screen, and optionally poses an exploratory task whose
 * completion is detected from the live experiment state.
 */
import { makeQuantConfig } from '@/engine/quant/types';
import { DATASETS } from '@/data/datasets';
import { MATRIX_PRESETS } from '@/data/matrixPresets';
import { applyScenario } from '@/data/networkScenarios';
import { plainClone } from '@/state/clone';
import { evaluateVariant, resolveData } from '@/labs/workbench';
import type { ExperimentState, QuantVariant } from '@/state/schema';
import type { Lesson } from './types';

function dataset(s: ExperimentState, id: string) {
  const d = DATASETS.find((x) => x.id === id)!;
  s.workbench.source = plainClone(d.source);
  s.workbench.datasetId = id;
  s.workbench.selected = null;
}
function variants(s: ExperimentState, list: Omit<QuantVariant, 'enabled'>[]) {
  s.workbench.variants = list.map((v) => ({ ...v, enabled: true }));
  s.workbench.activeVariantId = list[0]!.id;
}
function inspector(s: ExperimentState, input: string, format: ExperimentState['inspector']['format']) {
  s.lab = 'inspector';
  s.inspector.input = input;
  s.inspector.format = format;
  s.inspector.bitsOverride = null;
  s.inspector.rounding = 'nearest-even';
}
function matrixPreset(s: ExperimentState, id: string) {
  s.lab = 'matrix';
  Object.assign(s.matrix, { integerPath: false }, MATRIX_PRESETS.find((p) => p.id === id)!.apply(), { presetId: id, selectedCell: [0, 0] });
}
const active = (s: ExperimentState) => s.workbench.variants.find((v) => v.id === s.workbench.activeVariantId)!;

export const LESSONS: Lesson[] = [
  {
    id: 'float-encoding',
    title: 'How floating-point numbers encode values',
    summary: 'Sign, exponent and fraction: decode a bit pattern by hand and watch bits change the value.',
    level: 'Foundations',
    minutes: 6,
    steps: [
      {
        title: 'Three fields',
        body: '<p>A binary floating-point number has a <strong>sign</strong> bit, an <strong>exponent</strong> field and a <strong>fraction</strong> (mantissa) field. For normal numbers the value is</p><p><code>(−1)^sign × 2^(exponent − bias) × 1.fraction</code></p><p>The Number Inspector now shows <code>1.5</code> in FP16. Find the three coloured fields and the formula under them.</p>',
        setup: (s) => inspector(s, '1.5', 'fp16'),
      },
      {
        title: 'The exponent doubles',
        body: '<p>The exponent field of 1.5 is <code>01111</code> = 15, and the FP16 bias is 15, so the scale is 2⁰. Adding 1 to the exponent field multiplies the value by 2.</p>',
        task: { prompt: 'Flip exponent bits until the exponent field reads 10000 (= 16). What value do you get?', check: (s) => s.inspector.format === 'fp16' && s.inspector.bitsOverride?.toUpperCase() === '4200', success: 'Exponent 16 − 15 = 1, so the value is 1.5 × 2¹ = 3.', solve: (s) => { s.inspector.format = 'fp16'; s.inspector.bitsOverride = '4200'; s.inspector.input = '3'; } },
        hint: 'Going from 01111 to 10000 changes all five exponent bits — just like 15 + 1 = 16 carries in binary.',
      },
      {
        title: 'The fraction refines',
        body: '<p>The fraction bits add 1/2, 1/4, 1/8, … to the implicit leading 1. FP16 has 10 fraction bits, so the gap between neighbours just above 1 is 2⁻¹⁰ ≈ 0.000977. Use <em>Next value ▶</em> to step through neighbours.</p>',
        setup: (s) => inspector(s, '1', 'fp16'),
        task: { prompt: 'Step to the next representable value after 1.0.', check: (s) => s.inspector.format === 'fp16' && s.inspector.bitsOverride?.toUpperCase() === '3C01', success: '1 + 2⁻¹⁰ = 1.0009765625 — nothing in between is representable in FP16.', solve: (s) => { s.inspector.format = 'fp16'; s.inspector.bitsOverride = '3C01'; s.inspector.input = '1.0009765625'; } },
      },
      {
        title: 'Zero, subnormals and specials',
        body: '<p>An all-zero exponent means <strong>subnormal</strong>: no implicit 1, so values fade gradually to zero instead of jumping. The all-ones exponent is reserved for <strong>∞</strong> (fraction 0) and <strong>NaN</strong> (fraction ≠ 0) in IEEE formats.</p><p>Try the <em>Special values</em> and <em>Format limits</em> presets in the left panel, and note the sign of zero: −0 and +0 differ only in the sign bit.</p>',
        setup: (s) => inspector(s, '-0', 'fp16'),
        task: { prompt: 'Load the "Min subnormal" preset.', check: (s) => s.inspector.format === 'fp16' && s.inspector.input.startsWith('0.0000000596'), success: 'The smallest positive FP16 value is 2⁻²⁴ ≈ 5.96 × 10⁻⁸: only the last fraction bit is set.', solve: (s) => { s.inspector.format = 'fp16'; s.inspector.bitsOverride = null; s.inspector.input = '0.000000059604644775390625'; } },
      },
    ],
  },
  {
    id: 'point-one',
    title: 'Why 0.1 is not exact',
    summary: 'Decimal fractions become infinite binary fractions; see the exact stored value and the error.',
    level: 'Foundations',
    minutes: 5,
    steps: [
      {
        title: 'An infinite binary fraction',
        body: '<p>0.1 = 1/10. In binary, 1/10 = 0.000110011001100… repeating forever, so every binary format must round it. In FP64 the stored value is</p><p><code>0.1000000000000000055511151231257827…</code></p><p>Look at the <em>Exact stored value</em> row.</p>',
        setup: (s) => inspector(s, '0.1', 'fp64'),
      },
      {
        title: 'Fewer bits, larger error',
        body: '<p>The comparison table shows the same input in every format. FP16 stores 0.0999755859375; FP8 E5M2 stores 0.09375. The relative error grows roughly by a factor of 2 for every fraction bit removed.</p>',
        setup: (s) => inspector(s, '0.1', 'fp16'),
      },
      {
        title: 'Shortest decimal vs exact value',
        body: '<p>Programs usually print the <em>shortest</em> decimal that rounds back to the same value, which is why FP16 0.0999755859375 prints as “0.1”. That display hides the error — the stored number is still not 0.1.</p>',
        task: { prompt: 'Enter a decimal that IS exactly representable in FP16, such as 0.375 (= 3/8).', check: (s) => ['0.375', '0.5', '0.25', '0.125', '0.75', '0.625', '0.875'].includes(s.inspector.input.trim()), success: 'Fractions with a power-of-two denominator have a finite binary expansion, so the error is exactly zero.', solve: (s) => { s.inspector.bitsOverride = null; s.inspector.input = '0.375'; } },
      },
    ],
  },
  {
    id: 'fp16-bf16',
    title: 'FP16 versus BF16: precision or range',
    summary: 'Same 16 bits, split differently. Find values where each format wins.',
    level: 'Foundations',
    minutes: 6,
    steps: [
      {
        title: 'Overflow in FP16',
        body: '<p>FP16 has 5 exponent bits: its largest finite value is 65 504. BF16 keeps FP32\'s 8 exponent bits, reaching ≈3.4 × 10³⁸. The input is 70 000: compare the FP16 and BF16 rows in the comparison table.</p>',
        setup: (s) => inspector(s, '70000', 'fp16'),
      },
      {
        title: 'Precision in BF16',
        body: '<p>BF16 has only 7 fraction bits. Near 1 its spacing is 2⁻⁷ = 0.0078125, so 1.001 rounds to exactly 1 — the small difference disappears. FP16 keeps it (1.0009765625).</p>',
        setup: (s) => inspector(s, '1.01', 'bf16'),
        task: { prompt: 'Find a number that BF16 stores as exactly 1 but FP16 does not (try values between 1 and 1.004).', check: (s) => { const v = Number(s.inspector.input); return v > 1.0004883 && v < 1.00390625 && s.inspector.bitsOverride === null; }, success: 'Anything in (1 + 2⁻¹¹, 1 + 2⁻⁸] behaves like this: invisible to BF16, visible to FP16.', solve: (s) => { s.inspector.bitsOverride = null; s.inspector.input = '1.002'; } },
      },
      {
        title: 'Why ML uses BF16',
        body: '<p>Training values (gradients, activations) span many orders of magnitude, so range matters more than the last digits — BF16 rarely overflows where FP16 would need loss scaling. Look at the <em>Dynamic range</em> diagram: the BF16 bar is as long as FP32\'s.</p>',
        setup: (s) => inspector(s, '1e-30', 'bf16'),
      },
    ],
  },
  {
    id: 'fp8-fp4',
    title: 'Understanding FP8 and FP4',
    summary: 'E4M3 vs E5M2, saturation vs NaN, and the 15 values of FP4 E2M1.',
    level: 'Foundations',
    minutes: 7,
    steps: [
      {
        title: 'Two FP8 formats',
        body: '<p>The OCP OFP8 specification defines <strong>E4M3</strong> (more precision, max 448, no infinity) and <strong>E5M2</strong> (more range, max 57 344, IEEE-style ∞ and NaN). The same 8 bits trade precision for range.</p><p>The input 300 rounds to 288 in E4M3 and to 320 in E5M2.</p>',
        setup: (s) => inspector(s, '300', 'fp8_e4m3'),
      },
      {
        title: 'Overflow: saturate or NaN',
        body: '<p>E4M3 gave up infinity to gain one more binade. When a value overflows, OCP requires two modes: <em>saturating</em> (clamp to ±448) and <em>non-saturating</em> (produce NaN for E4M3, ∞ for E5M2).</p>',
        setup: (s) => {
          inspector(s, '1000', 'fp8_e4m3');
          s.inspector.overflow = 'nonsaturate';
        },
        task: { prompt: 'Switch the overflow mode so that 1000 becomes 448 instead of NaN.', check: (s) => s.inspector.format === 'fp8_e4m3' && s.inspector.overflow === 'saturate', success: 'Saturation is what quantized inference normally wants: a large value stays large instead of poisoning the result with NaN.', solve: (s) => { s.inspector.format = 'fp8_e4m3'; s.inspector.overflow = 'saturate'; } },
      },
      {
        title: 'FP4 E2M1 has 15 values',
        body: '<p>FP4 E2M1 (from the OCP Microscaling spec) can only represent ±{0, 0.5, 1, 1.5, 2, 3, 4, 6}. It has no NaN or ∞ and always saturates at ±6. Step through the values with <em>Next value ▶</em>.</p>',
        setup: (s) => inspector(s, '2.5', 'fp4_e2m1'),
        task: { prompt: 'Enter a number that rounds to 4 in FP4.', check: (s) => { const v = Number(s.inspector.input); return s.inspector.format === 'fp4_e2m1' && v >= 3.5 && v <= 5; }, success: 'Between 3 and 6 the spacing is already 1 or 2 — 5 is a tie between 4 and 6 and rounds to even (4).', solve: (s) => { s.inspector.format = 'fp4_e2m1'; s.inspector.bitsOverride = null; s.inspector.input = '4.4'; } },
      },
      {
        title: 'Name ≠ format',
        body: '<p>“E4M3” alone is ambiguous: the FNUZ variant (AMD/Graphcore) uses bias 8, max 240 and a single NaN at 0x80. Select <em>FP8 E4M3 FNUZ</em> in the comparison chips to see the difference.</p>',
        setup: (s) => {
          inspector(s, '300', 'fp8_e4m3fnuz');
          s.inspector.compareFormats = ['fp8_e4m3', 'fp8_e4m3fnuz', 'fp8_e5m2', 'fp8_e5m2fnuz', 'fp4_e2m1'];
        },
      },
    ],
  },
  {
    id: 'sym-asym',
    title: 'Symmetric versus asymmetric integer quantization',
    summary: 'Zero-points let one-sided data use the whole integer grid.',
    level: 'Quantization',
    minutes: 6,
    steps: [
      {
        title: 'The affine mapping',
        body: '<p>Integer quantization maps a real value x to an integer code: <code>q = clamp(round(x / s) + z, qmin, qmax)</code> and back: <code>x̂ = s·(q − z)</code>. Symmetric schemes fix z = 0; asymmetric ones choose z so the grid covers [min, max].</p><p>The Workbench shows post-ReLU activations (never negative) quantized to INT4 both ways.</p>',
        setup: (s) => {
          s.lab = 'workbench';
          dataset(s, 'relu');
          variants(s, [
            { id: 'v1', name: 'INT4 symmetric', config: makeQuantConfig({ format: 'int4', scheme: 'symmetric' }) },
            { id: 'v2', name: 'INT4 asymmetric', config: makeQuantConfig({ format: 'int4', scheme: 'asymmetric' }) },
          ]);
        },
      },
      {
        title: 'Half the grid wasted',
        body: '<p>Look at <em>Quantized values used</em>: the symmetric variant only uses codes 0…7 — all negative codes are wasted, so the step size is twice as large. Compare the MSE in the metrics table.</p>',
      },
      {
        title: 'Zero must stay exact',
        body: '<p>The asymmetric range always includes 0 so that exact zeros (half of these values!) are reproduced exactly — check the <em>Collapsed to 0</em> column and the element inspector.</p>',
        task: { prompt: 'Select the asymmetric variant and switch its format to INT8. How much lower is the MSE?', check: (s) => { const v = active(s); return v.config.scheme === 'asymmetric' && v.config.format === 'int8'; }, success: 'Each extra bit roughly halves the step and quarters the MSE: 4 more bits ≈ 256× lower MSE.', solve: (s) => { const v = s.workbench.variants.find((x) => x.config.scheme === 'asymmetric')!; v.config = { ...v.config, format: 'int8' }; s.workbench.activeVariantId = v.id; } },
      },
    ],
  },
  {
    id: 'scales-groups',
    title: 'Scales, zero-points and group sizes',
    summary: 'How finer granularity adapts to local magnitudes, and what it costs in metadata.',
    level: 'Quantization',
    minutes: 8,
    steps: [
      {
        title: 'One scale for everything',
        body: '<p>This weight matrix has a few output rows (channels) that are 8× larger than the rest. With one per-tensor scale, the large rows set the step size for every row.</p><p>Compare per-tensor and per-channel INT4 in the metrics table and the |Error| heatmap.</p>',
        setup: (s) => {
          s.lab = 'workbench';
          dataset(s, 'model-weights');
          variants(s, [
            { id: 'v1', name: 'INT4 per-tensor', config: makeQuantConfig({ format: 'int4', granularity: 'tensor' }) },
            { id: 'v2', name: 'INT4 per-channel', config: makeQuantConfig({ format: 'int4', granularity: 'channel', axis: 0 }) },
            { id: 'v3', name: 'INT4 groups of 64', config: makeQuantConfig({ format: 'int4', granularity: 'group', axis: 0, groupSize: 64, scaleFormat: 'fp16' }) },
          ]);
        },
      },
      {
        title: 'Groups along each row',
        body: '<p>Per-group scaling splits each row into groups of consecutive values, each with its own scale. Smaller groups track local magnitude better but store more scales: look at <em>Bits / value</em>.</p>',
        task: { prompt: 'Select “INT4 groups of 64” and change its group size to 16.', check: (s) => s.workbench.variants.some((v) => v.config.granularity === 'group' && v.config.groupSize === 16), success: 'Group size 16 with FP16 scales adds 1 bit per value of metadata (16 bits ÷ 16 values).', solve: (s) => { const v = s.workbench.variants.find((x) => x.config.granularity === 'group')!; v.config = { ...v.config, groupSize: 16 }; s.workbench.activeVariantId = v.id; } },
      },
      {
        title: 'Manual scales',
        body: '<p>Calibration usually picks the scale, but you can set it yourself. A scale that is too small clips (saturates) large values; one that is too large wastes resolution.</p>',
        setup: (s) => {
          const v = s.workbench.variants[0]!;
          v.config = { ...v.config, calibration: 'manual', manualScale: 0.01 };
          s.workbench.activeVariantId = v.id;
        },
        task: {
          prompt: 'Find a manual scale for the per-tensor variant with a saturation rate below 1%.',
          check: (s) => {
            const v = s.workbench.variants[0]!;
            if (v.config.calibration !== 'manual') return false;
            const d = resolveData(s.workbench.source);
            const r = evaluateVariant(v.id, d.data, d.shape, v.config);
            return (r.metrics?.saturationRate ?? 1) < 0.01;
          },
          success: 'Roughly amax / 7 is needed: everything fits, but the small rows still get only a few levels.',
          solve: (s) => {
            const v = s.workbench.variants[0]!;
            const d = resolveData(s.workbench.source);
            let amax = 0;
            for (const x of d.data) amax = Math.max(amax, Math.abs(x));
            v.config = { ...v.config, calibration: 'manual', manualScale: Number((amax / 7).toPrecision(3)) * 1.01 };
          },
        },
      },
    ],
  },
  {
    id: 'outliers',
    title: 'How outliers influence quantization',
    summary: 'One extreme value can ruin a per-tensor scale. Clip it, or isolate it.',
    level: 'Quantization',
    minutes: 7,
    steps: [
      {
        title: 'One value controls the scale',
        body: '<p>1023 ordinary values and a single value of 200. Min/max calibration sets the INT8 step to 200/127 ≈ 1.6, larger than most values themselves, so they collapse onto a handful of levels.</p><p>Look at the <em>Collapsed to 0</em> column and the quantization grid.</p>',
        setup: (s) => {
          s.lab = 'workbench';
          dataset(s, 'single-outlier');
          variants(s, [
            { id: 'v1', name: 'INT8 min/max', config: makeQuantConfig({ format: 'int8' }) },
            { id: 'v2', name: 'INT8 percentile 99.9', config: makeQuantConfig({ format: 'int8', calibration: 'percentile', percentile: 99.9 }) },
            { id: 'v3', name: 'INT8 MSE search', config: makeQuantConfig({ format: 'int8', calibration: 'mse' }) },
          ]);
        },
      },
      {
        title: 'Clipping trades one big error for many small ones',
        body: '<p>Percentile calibration clips the range at the 99.9th percentile: the outlier saturates at ≈3.3, but every other value gets a fine grid. Compare the columns: its <strong>MAE and mean relative error are far lower</strong>, yet its <strong>MSE is far higher</strong>, because the single clipped value contributes (200 − 3.3)² / 1024 ≈ 38 on its own.</p><p>The MSE search optimises exactly that squared error, so it keeps almost the full range (see the MSE-vs-ratio chart). Which choice is “best” depends on what you care about: the outlier, or everything else.</p>',
        setup: (s) => (s.workbench.activeVariantId = 'v3'),
      },
      {
        title: 'Or give the outlier its own scale',
        body: '<p>Groups isolate the outlier: only its group gets a coarse scale. Open <em>Outlier analysis</em> to see how much of the energy the outlier carries.</p>',
        task: { prompt: 'Change the min/max variant to per-group scaling with groups of 32.', check: (s) => { const v = s.workbench.variants.find((x) => x.id === 'v1'); return !!v && v.config.granularity === 'group' && v.config.groupSize <= 32; }, success: 'Now only 32 values share the outlier\'s scale; the other blocks are untouched.', solve: (s) => { const v = s.workbench.variants.find((x) => x.id === 'v1')!; v.config = { ...v.config, granularity: 'group', axis: 0, groupSize: 32 }; s.workbench.activeVariantId = 'v1'; } },
      },
    ],
  },
  {
    id: 'dot-products',
    title: 'How error propagates through dot products',
    summary: 'Storage error, product rounding, accumulator precision and summation order.',
    level: 'Arithmetic',
    minutes: 8,
    steps: [
      {
        title: 'Accumulator stagnation',
        body: '<p>A dot product of 4096 terms between 0.8 and 0.99. In an FP16 accumulator, once the running sum reaches 2048 the spacing between FP16 numbers is 2, so adding anything below 1 rounds back down and changes nothing. The trace chart shows the simulated sum flattening while the exact sum keeps growing.</p>',
        setup: (s) => matrixPreset(s, 'stagnation'),
      },
      {
        title: 'Fix it three ways',
        body: '<p>Real kernels avoid this by accumulating in FP32, by summing in a tree (pairwise), or by periodically promoting partial sums to a wider accumulator (blocked).</p>',
        task: { prompt: 'Keep the FP16 accumulator but change the summation order so the error drops.', check: (s) => s.lab === 'matrix' && s.matrix.arith.accumulatorFormat === 'fp16' && s.matrix.arith.order !== 'sequential', success: 'Pairwise sums keep partial sums of similar size, so far fewer additions lose low-order bits.', solve: (s) => { s.lab = 'matrix'; s.matrix.arith = { ...s.matrix.arith, accumulatorFormat: 'fp16', order: 'pairwise' }; } },
      },
      {
        title: 'Storage versus arithmetic',
        body: '<p>Here both operands are stored in FP8 E4M3 but multiplied exactly and accumulated in FP32. The <em>Where the error comes from</em> chart splits each output\'s error into a storage part and an arithmetic part: storage dominates.</p>',
        setup: (s) => matrixPreset(s, 'fp8-gemm'),
      },
      {
        title: 'Cancellation',
        body: '<p>When large terms cancel, the small terms decide the result — but in low precision they may already have been rounded away. Try different summation orders here and watch the result change: floating-point addition is not associative.</p>',
        setup: (s) => matrixPreset(s, 'cancellation'),
      },
    ],
  },
  {
    id: 'integer-kernels',
    title: 'Integer kernels and INT32 accumulation',
    summary: 'How INT8 matrix multiplication really computes: integer products, a 32-bit accumulator, one rescale.',
    level: 'Arithmetic',
    minutes: 6,
    steps: [
      {
        title: 'Factor out the scales',
        body: '<p>If A is quantized per row and B per column, then C[i,j] = s_A[i]·s_B[j]·Σ (q_A − z_A)(q_B − z_B). The sum is computed entirely with integers; floating point only appears in the final rescale.</p><p>The <em>Integer kernel</em> column matches <em>Exact (stored)</em> up to the final rounding.</p>',
        setup: (s) => matrixPreset(s, 'int8-kernel'),
      },
      {
        title: 'Granularity matters',
        body: '<p>Scales can only be factored out of the sum if they are constant along the reduction dimension. Per-column scaling of A (axis 1) varies along k — the integer path is then unavailable.</p>',
        task: { prompt: 'Change operand A to per-channel along axis 1 and read the explanation.', check: (s) => s.matrix.quantA?.granularity === 'channel' && s.matrix.quantA.axis === 1, success: 'With a different scale for every k, each product needs its own rescale — the sum is no longer a pure integer sum.', solve: (s) => { s.matrix.quantA = makeQuantConfig({ format: 'int8', granularity: 'channel', axis: 1 }); } },
      },
    ],
  },
  {
    id: 'mx-storage',
    title: 'Block formats and storage (MXFP4, MXFP8)',
    summary: 'Shared power-of-two scales per block of 32, and what bits per value really means.',
    level: 'Quantization',
    minutes: 6,
    steps: [
      {
        title: 'MX block scaling',
        body: '<p>The OCP Microscaling (MX) formats store blocks of 32 elements with one shared 8-bit power-of-two scale (E8M0). MXFP4 uses FP4 E2M1 elements: 32 × 4 + 8 = 136 bits per block = 4.25 bits per value.</p><p>Compare MXFP4 with INT4 groups of 32 (FP16 scales) and plain per-tensor FP4 on the weight matrix with outlier rows.</p>',
        setup: (s) => {
          s.lab = 'workbench';
          dataset(s, 'model-weights');
          variants(s, [
            { id: 'v1', name: 'MXFP4', config: makeQuantConfig({ format: 'fp4_e2m1', granularity: 'group', axis: 0, groupSize: 32, calibration: 'pow2-mx', scaleFormat: 'e8m0', overflow: 'saturate' }) },
            { id: 'v2', name: 'INT4 groups of 32', config: makeQuantConfig({ format: 'int4', granularity: 'group', axis: 0, groupSize: 32, scaleFormat: 'fp16' }) },
            { id: 'v3', name: 'FP4 per-tensor', config: makeQuantConfig({ format: 'fp4_e2m1', granularity: 'tensor' }) },
          ]);
        },
      },
      {
        title: 'Power-of-two scales cost resolution',
        body: '<p>The MX rule picks X = 2^(⌊log₂ max|v|⌋ − 2): the block maximum lands in [4, 8) and values in (6, 8) saturate to 6. A scale that is not a power of two can fit the block more tightly — at the price of 16 instead of 8 metadata bits.</p>',
        task: { prompt: 'Change the MXFP4 variant\'s calibration to min/max (keeping E8M0 storage) and compare the MSE.', check: (s) => { const v = s.workbench.variants.find((x) => x.id === 'v1'); return !!v && v.config.calibration === 'minmax'; }, success: 'Min/max rounded up to a power of two never saturates but may waste up to half the grid — neither choice is free.', solve: (s) => { const v = s.workbench.variants.find((x) => x.id === 'v1')!; v.config = { ...v.config, calibration: 'minmax' }; s.workbench.activeVariantId = 'v1'; } },
      },
      {
        title: 'Storage is not speed',
        body: '<p>The storage card shows the theoretical packed size. Whether fewer bits make inference faster depends on hardware support, kernels, memory bandwidth and dequantization overhead — this laboratory reports storage only.</p>',
      },
    ],
  },
  {
    id: 'networks',
    title: 'How quantization changes neural-network predictions',
    summary: 'From weight errors to flipped decisions in a real (tiny) trained network.',
    level: 'Networks',
    minutes: 8,
    steps: [
      {
        title: 'A trained classifier',
        body: '<p>This 2-16-16-2 ReLU network was trained offline on the two-moons dataset. The left map shows its decision regions in FP64; the right map shows a quantized variant, with cells whose prediction changed shaded dark.</p>',
        setup: (s) => {
          s.lab = 'network';
          s.network = applyScenario('outlier');
        },
      },
      {
        title: 'An outlier neuron',
        body: '<p>One hidden neuron was rescaled (×32 in, ÷32 out) — mathematically the same network, but now layer 1 has an outlier weight row. Per-tensor INT4 flips several predictions; per-channel scaling fixes it. Click the neurons in the diagram to compare original and quantized weights.</p>',
      },
      {
        title: 'Weights versus activations',
        body: '<p>The same rescaling also created an outlier <em>activation</em>. Quantizing activations per tensor is far more damaging here than quantizing weights.</p>',
        setup: (s) => (s.network = applyScenario('weights-vs-activations')),
        task: { prompt: 'Select the “Activations only (INT4 per-tensor)” variant and change its layer-2 activation format to FP8 E4M3 or INT8.', check: (s) => { const v = s.network.variants.find((x) => x.id === 'n2'); const a = v?.layers[1]?.activation; return !!a && a.format !== 'int4'; }, success: 'More bits — or a floating-point grid that keeps relative precision — rescue the small activations next to the outlier.', solve: (s) => { const v = s.network.variants.find((x) => x.id === 'n2')!; v.layers = v.layers.map((l, i) => (i === 1 && l.activation ? { ...l, activation: { ...l.activation, format: 'fp8_e4m3' } } : l)); s.network.activeVariantId = 'n2'; } },
      },
      {
        title: 'Errors propagate',
        body: '<p>In this deep chain only the first layer is quantized, yet the per-layer error keeps growing: each layer amplifies the perturbation it receives. The <em>Error propagation</em> chart shows the relative error layer by layer.</p>',
        setup: (s) => (s.network = applyScenario('propagation')),
      },
      {
        title: 'Your turn',
        body: '<p>Choose the digit classifier and try to find the lowest-bit setting that keeps agreement above 99%. Combine weight and activation quantization, granularity and formats.</p>',
        setup: (s) => (s.network = applyScenario('groups')),
        task: { prompt: 'Make one variant use 4-bit weights (INT4 or FP4) and INT8 input activations in every layer.', check: (s) => s.network.variants.some((v) => v.layers.every((l) => l.weight && (l.weight.format === 'int4' || l.weight.format === 'fp4_e2m1') && l.activation?.format === 'int8')), success: 'Check the agreement column — and the per-layer errors — to see what those 4 bits cost.', solve: (s) => { s.network.activeVariantId = s.network.variants[0]!.id; s.network.variants[0]!.layers = s.network.variants[0]!.layers.map((l) => ({ ...l, weight: makeQuantConfig({ format: 'int4', granularity: 'channel', axis: 0 }), activation: makeQuantConfig({ format: 'int8' }) })); } },
      },
    ],
  },
];

