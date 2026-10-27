<script setup lang="ts">
import { computed } from 'vue';
import type { ArithConfig } from '@/engine/arith/dot';
import { FLOAT_FORMATS } from '@/engine/formats/registry';
import type { FloatFormatId } from '@/engine/formats/types';
import SelectField from '@/components/common/SelectField.vue';
import NumberField from '@/components/common/NumberField.vue';
import RoundingSelect from '@/components/common/RoundingSelect.vue';
import Segmented from '@/components/common/Segmented.vue';

withDefaults(defineProps<{ showOutput?: boolean; idPrefix?: string }>(), { showOutput: true, idPrefix: 'ar' });
const cfg = defineModel<ArithConfig>({ required: true });
const fmtOptions = (['fp64', 'fp32', 'fp16', 'bf16', 'fp8_e4m3', 'fp8_e5m2', 'fp4_e2m1'] as FloatFormatId[]).map((id) => ({ value: id, label: FLOAT_FORMATS[id].name }));
const field = <K extends keyof ArithConfig>(k: K) => computed({ get: () => cfg.value[k], set: (v: ArithConfig[K]) => (cfg.value = { ...cfg.value, [k]: v }) });
const product = field('productFormat');
const acc = field('accumulatorFormat');
const out = field('outputFormat');
const rounding = field('rounding');
const order = field('order');
const blockSize = field('blockSize');
const outer = field('outerFormat');
const overflow = field('overflow');
const ftz = field('ftz');
const seed = field('seed');
</script>

<template>
  <div class="acfg">
    <SelectField v-model="product" label="Product precision" :options="fmtOptions" info="Each product a·b is computed exactly and rounded once to this format. FP32 or wider is exact for FP16/BF16/FP8 operands." :test-id="`${idPrefix}-product`" />
    <SelectField v-model="acc" label="Accumulator precision" :options="fmtOptions" info="Each addition acc + p is computed exactly and rounded once to this format." :test-id="`${idPrefix}-acc`" />
    <SelectField v-if="showOutput" v-model="out" label="Output precision" :options="fmtOptions" info="The final result is rounded to this format." />
    <SelectField
      v-model="order"
      label="Summation order"
      :options="[
        { value: 'sequential', label: 'Sequential (left to right)' },
        { value: 'pairwise', label: 'Pairwise (tree)' },
        { value: 'blocked', label: 'Blocked (promote partial sums)' },
        { value: 'kahan', label: 'Kahan compensated' },
      ]"
      info="Floating-point addition is not associative: the order in which products are summed changes the rounding errors."
      :test-id="`${idPrefix}-order`"
    />
    <div v-if="order === 'blocked'" class="field-row">
      <NumberField v-model="blockSize" label="Block length" :min="1" :max="65536" integer />
      <SelectField v-model="outer" label="Outer accumulator" :options="fmtOptions" />
    </div>
    <RoundingSelect v-model="rounding" label="Arithmetic rounding" />
    <NumberField v-if="rounding === 'stochastic'" v-model="seed" label="Seed" :min="0" :max="4294967295" integer />
    <div class="field">
      <span class="field-label">Overflow</span>
      <Segmented v-model="overflow" label="Arithmetic overflow" small :options="[{ value: 'nonsaturate', label: 'Non-saturating' }, { value: 'saturate', label: 'Saturate' }]" />
    </div>
    <label class="check"><input v-model="ftz" type="checkbox" /> Flush subnormal results to zero</label>
    <p class="field-hint">Simulates a machine that rounds after every operation. It does not reproduce any particular GPU instruction's internal behaviour.</p>
  </div>
</template>

<style scoped>
.acfg {
  display: flex;
  flex-direction: column;
  gap: 9px;
}
</style>
