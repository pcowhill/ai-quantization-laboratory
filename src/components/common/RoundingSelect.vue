<script setup lang="ts">
import { ROUNDING_MODES, type RoundingMode } from '@/engine/rounding';
import SelectField from './SelectField.vue';

defineProps<{ label?: string; testId?: string }>();
const model = defineModel<RoundingMode>({ required: true });
const options = ROUNDING_MODES.map((m) => ({ value: m.id, label: `${m.short} — ${m.name}${m.simulation ? ' (simulation)' : ''}`, title: m.description }));
const info = ROUNDING_MODES.map((m) => `${m.short}: ${m.description}`).join('\n');
</script>

<template>
  <SelectField v-model="model" :label="label ?? 'Rounding mode'" :options="options" :info="info" :test-id="testId" />
</template>
