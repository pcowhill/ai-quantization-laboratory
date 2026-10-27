<script setup lang="ts">
/**
 * Editor for a QuantConfig. Only controls relevant to the selected format and
 * algorithm are shown; options that do not apply are disabled with an
 * explanation, and invalid combinations are reported (never auto-corrected).
 */
import { computed } from 'vue';
import { getFormat } from '@/engine/formats/registry';
import { validateQuantConfig, type QuantConfig } from '@/engine/quant/types';
import FormatSelect from '@/components/common/FormatSelect.vue';
import RoundingSelect from '@/components/common/RoundingSelect.vue';
import SelectField from '@/components/common/SelectField.vue';
import NumberField from '@/components/common/NumberField.vue';
import Segmented from '@/components/common/Segmented.vue';
import InfoTip from '@/components/common/InfoTip.vue';
import IssueList from '@/components/common/IssueList.vue';
import { QUANT_PRESETS } from '@/labs/quantPresets';

const props = withDefaults(defineProps<{ shape?: [number, number]; idPrefix?: string; axisLabels?: [string, string]; showPresets?: boolean; lockGranularity?: boolean }>(), {
  idPrefix: 'q',
  axisLabels: () => ['rows', 'columns'],
  showPresets: true,
  lockGranularity: false,
});
const cfg = defineModel<QuantConfig>({ required: true });

const fmt = computed(() => getFormat(cfg.value.format));
const isFloat = computed(() => fmt.value.kind === 'float');
const scaled = computed(() => cfg.value.scaling === 'scaled');
const issues = computed(() => validateQuantConfig(cfg.value, props.shape));

function set<K extends keyof QuantConfig>(key: K, value: QuantConfig[K]) {
  cfg.value = { ...cfg.value, [key]: value };
}
const field = <K extends keyof QuantConfig>(key: K) =>
  computed({
    get: () => cfg.value[key],
    set: (v: QuantConfig[K]) => set(key, v),
  });

const format = field('format');
const scaling = field('scaling');
const scheme = field('scheme');
const granularity = field('granularity');
const axis = field('axis');
const groupSize = field('groupSize');
const calibration = field('calibration');
const percentile = field('percentile');
const mseCandidates = field('mseCandidates');
const mseMinRatio = field('mseMinRatio');
const manualScale = field('manualScale');
const manualZeroPoint = field('manualZeroPoint');
const scaleFormat = field('scaleFormat');
const rounding = field('rounding');
const narrowRange = field('narrowRange');
const overflow = field('overflow');
const ftz = field('ftz');
const seed = field('seed');

const calibrationOptions = computed(() => [
  { value: 'minmax' as const, label: 'Min / max', title: 'Clip to the observed range.' },
  { value: 'percentile' as const, label: 'Percentile', title: 'Clip at a percentile of |x| (or of x per side).' },
  { value: 'mse' as const, label: 'MSE grid search', title: 'Try clipping ratios on a grid and keep the lowest MSE.' },
  { value: 'manual' as const, label: 'Manual scale / zero-point', title: 'Use exactly the values you enter.' },
  {
    value: 'pow2-mx' as const,
    label: 'Power-of-two (OCP MX §6.3)',
    title: cfg.value.scheme === 'asymmetric' ? 'Not available: the MX rule is symmetric.' : 'X = 2^(⌊log2 max|x|⌋ − emax(element)).',
    disabled: cfg.value.scheme === 'asymmetric',
  },
]);

const axisText = computed(() => {
  const [r, c] = props.axisLabels;
  if (cfg.value.granularity === 'channel') return cfg.value.axis === 0 ? `One scale per ${r.replace(/s$/, '')} (axis 0).` : `One scale per ${c.replace(/s$/, '')} (axis 1).`;
  if (cfg.value.granularity === 'group')
    return cfg.value.axis === 0
      ? `Each ${r.replace(/s$/, '')} is split into groups of ${cfg.value.groupSize} consecutive values along the ${c}.`
      : `Each ${c.replace(/s$/, '')} is split into groups of ${cfg.value.groupSize} consecutive values along the ${r}.`;
  return 'A single scale for the whole tensor.';
});

const qRange = computed(() => {
  const f = fmt.value;
  if (f.kind !== 'int') return null;
  return cfg.value.narrowRange ? `[${-f.max}, ${f.max}]` : `[${f.min}, ${f.max}]`;
});

function applyPreset(id: string) {
  const p = QUANT_PRESETS.find((x) => x.id === id);
  if (p) cfg.value = { ...cfg.value, ...p.config };
}
const presetModel = computed({ get: () => '', set: (v: string) => applyPreset(v) });
const presetOptions = computed(() => [{ value: '', label: 'Apply a preset…', disabled: true }, ...QUANT_PRESETS.map((p) => ({ value: p.id, label: p.name, title: p.description }))]);
</script>

<template>
  <div class="qcfg">
    <SelectField v-if="showPresets" v-model="presetModel" label="Preset" :options="presetOptions" info="Presets set the element format and scaling layout. MXFP4/MXFP8 follow OCP MX v1.0 §6.3 (block 32, E8M0 power-of-two scales, saturation, RNE)." />
    <FormatSelect v-model="format" label="Target format" :test-id="`${idPrefix}-format`" />
    <div v-if="isFloat" class="field">
      <span class="field-label">Scaling <InfoTip text="Direct cast converts each value to the format as-is. Scaled conversion first divides by a per-block scale chosen by calibration (as FP8/FP4 schemes do), then multiplies back." /></span>
      <Segmented v-model="scaling" label="Scaling" small :options="[{ value: 'none', label: 'Direct cast' }, { value: 'scaled', label: 'Scaled' }]" />
    </div>
    <p v-else class="field-hint">Integer formats always need a scale: q = clamp(round(x/s) + z, {{ qRange }}).</p>

    <template v-if="scaled">
      <div class="field">
        <span class="field-label">Scheme <InfoTip text="Symmetric: zero-point fixed at 0, range ±max. Asymmetric (integers only): a zero-point shifts the grid so [min, max] uses every code — useful for one-sided data such as ReLU outputs." /></span>
        <Segmented
          v-model="scheme"
          label="Scheme"
          small
          :options="[
            { value: 'symmetric', label: 'Symmetric' },
            { value: 'asymmetric', label: 'Asymmetric', disabled: isFloat, title: isFloat ? 'Floating-point targets use a scale only (no zero-point).' : undefined },
          ]"
        />
      </div>
      <div v-if="!lockGranularity" class="field">
        <span class="field-label">Granularity <InfoTip text="How many values share one scale: the whole tensor, each channel (row or column), or each group of consecutive values inside a channel." /></span>
        <Segmented v-model="granularity" label="Granularity" small :options="[{ value: 'tensor', label: 'Per-tensor' }, { value: 'channel', label: 'Per-channel' }, { value: 'group', label: 'Per-group' }]" />
      </div>
      <div v-if="!lockGranularity && granularity !== 'tensor'" class="field-row">
        <SelectField v-model="axis" label="Channel axis" :options="[{ value: 0, label: `Axis 0 (${axisLabels[0]})` }, { value: 1, label: `Axis 1 (${axisLabels[1]})` }]" />
        <NumberField v-if="granularity === 'group'" v-model="groupSize" label="Group size" :min="1" :max="1048576" integer :test-id="`${idPrefix}-group-size`" />
      </div>
      <p class="field-hint">{{ axisText }}</p>
      <SelectField v-model="calibration" label="Calibration" :options="calibrationOptions" :test-id="`${idPrefix}-calibration`" info="How each block's clipping range (and hence its scale) is chosen." />
      <NumberField v-if="calibration === 'percentile'" v-model="percentile" label="Percentile (%)" :min="0" :max="100" info="Clipping threshold: the p-th percentile of |x| (symmetric) or the (100−p)-th and p-th percentiles of x (asymmetric), with linear interpolation." />
      <div v-if="calibration === 'mse'" class="field-row">
        <NumberField v-model="mseCandidates" label="Grid points" :min="1" :max="1000" integer info="Number of clipping ratios evaluated between the smallest ratio and 1." />
        <NumberField v-model="mseMinRatio" label="Smallest ratio" :min="0.000001" :max="1" info="Smallest fraction of the min/max range tried." />
      </div>
      <div v-if="calibration === 'manual'" class="field-row">
        <NumberField v-model="manualScale" label="Scale s" info="Must be a finite positive number." :test-id="`${idPrefix}-manual-scale`" />
        <NumberField v-if="!isFloat && scheme === 'asymmetric'" v-model="manualZeroPoint" label="Zero-point z" integer :info="`An integer inside the code range ${qRange}.`" />
      </div>
      <SelectField
        v-model="scaleFormat"
        label="Scale stored as"
        :options="[
          { value: 'fp32', label: 'FP32' },
          { value: 'fp16', label: 'FP16' },
          { value: 'bf16', label: 'BF16' },
          { value: 'e8m0', label: 'E8M0 (power of two)' },
          { value: 'fp64', label: 'FP64 (exact)' },
        ]"
        info="Scales are rounded to this format (RNE). E8M0 rounds up to a power of two. This affects both accuracy and storage."
      />
      <label v-if="!isFloat && scheme === 'symmetric'" class="check"><input v-model="narrowRange" type="checkbox" /> Narrow range {{ fmt.kind === 'int' ? `[−${fmt.max}, ${fmt.max}]` : '' }}</label>
    </template>

    <RoundingSelect v-model="rounding" :test-id="`${idPrefix}-rounding`" />
    <NumberField v-if="rounding === 'stochastic'" v-model="seed" label="Stochastic rounding seed" :min="0" :max="4294967295" integer />
    <template v-if="isFloat">
      <div v-if="cfg.format !== 'fp4_e2m1'" class="field">
        <span class="field-label">Overflow</span>
        <Segmented v-model="overflow" label="Overflow" small :options="[{ value: 'saturate', label: 'Saturate' }, { value: 'nonsaturate', label: 'Non-saturating' }]" />
      </div>
      <p v-else class="field-hint">FP4 E2M1 has no ∞ or NaN: overflow always saturates to ±6 (OCP MX §5.3.3).</p>
      <label class="check"><input v-model="ftz" type="checkbox" /> Flush subnormals to zero</label>
    </template>
    <IssueList :issues="issues" />
  </div>
</template>

<style scoped>
.qcfg {
  display: flex;
  flex-direction: column;
  gap: 9px;
}
</style>
