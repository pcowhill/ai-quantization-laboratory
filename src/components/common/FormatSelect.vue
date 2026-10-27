<script setup lang="ts">
import { computed } from 'vue';
import { FLOAT_FORMATS, INT_FORMATS, PRIMARY_FORMAT_IDS, VARIANT_FORMAT_IDS, getFormat } from '@/engine/formats/registry';
import type { FormatId } from '@/engine/formats/types';
import SelectField, { type SelectOption } from './SelectField.vue';

const props = withDefaults(
  defineProps<{ label: string; info?: string; floatOnly?: boolean; intOnly?: boolean; includeVariants?: boolean; exclude?: FormatId[]; testId?: string; hint?: string }>(),
  { includeVariants: true },
);
const model = defineModel<FormatId>({ required: true });

const options = computed<SelectOption<FormatId>[]>(() => {
  const ids: FormatId[] = [...PRIMARY_FORMAT_IDS, ...(props.includeVariants ? VARIANT_FORMAT_IDS : [])];
  return ids
    .filter((id) => !(props.floatOnly && id in INT_FORMATS) && !(props.intOnly && id in FLOAT_FORMATS) && !props.exclude?.includes(id))
    .map((id) => {
      const f = getFormat(id);
      const group = VARIANT_FORMAT_IDS.includes(id as never) ? 'Variants (comparison only)' : f.kind === 'int' ? 'Integer' : 'Floating point';
      return { value: id, label: `${f.name} — ${f.totalBits} bits`, group, title: f.profile };
    });
});
</script>

<template>
  <SelectField v-model="model" :label="label" :options="options" :info="info" :test-id="testId" :hint="hint" />
</template>
