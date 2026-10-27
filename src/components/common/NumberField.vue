<script setup lang="ts">
/**
 * Numeric text field. The text is kept as typed; the model updates only for
 * valid values, and invalid input is shown with an explanation instead of
 * being silently corrected.
 */
import { ref, watch } from 'vue';
import InfoTip from './InfoTip.vue';

const props = withDefaults(
  defineProps<{ label: string; min?: number; max?: number; integer?: boolean; hint?: string; info?: string; disabled?: boolean; allowNonFinite?: boolean; testId?: string; compact?: boolean }>(),
  { allowNonFinite: false, compact: false },
);
const model = defineModel<number>({ required: true });
const text = ref(String(model.value));
const error = ref<string | null>(null);
const id = `num-${Math.random().toString(36).slice(2, 9)}`;

watch(model, (v) => {
  if (Number(text.value) !== v || text.value.trim() === '') {
    text.value = Object.is(v, -0) ? '-0' : String(v);
    error.value = null;
  }
});

function parse(s: string): number | null {
  const t = s.trim().toLowerCase();
  if (t === '') return null;
  if (props.allowNonFinite) {
    if (t === 'nan') return NaN;
    if (t === 'inf' || t === 'infinity' || t === '+inf') return Infinity;
    if (t === '-inf' || t === '-infinity') return -Infinity;
  }
  const v = Number(t);
  return Number.isNaN(v) ? null : v;
}

function commit() {
  const v = parse(text.value);
  if (v === null) return (error.value = 'Enter a number.');
  if (!props.allowNonFinite && !Number.isFinite(v)) return (error.value = 'Must be finite.');
  if (props.integer && !Number.isInteger(v)) return (error.value = 'Must be an integer.');
  if (props.min !== undefined && v < props.min) return (error.value = `Must be ≥ ${props.min}.`);
  if (props.max !== undefined && v > props.max) return (error.value = `Must be ≤ ${props.max}.`);
  error.value = null;
  if (!Object.is(v, model.value)) model.value = v;
}
</script>

<template>
  <div class="field" :class="{ compact }">
    <label :for="id">{{ label }} <InfoTip v-if="info" :text="info" :label="`About ${label}`" /></label>
    <input
      :id="id"
      v-model="text"
      class="input num"
      :class="{ invalid: !!error }"
      inputmode="decimal"
      :disabled="disabled"
      :aria-invalid="!!error"
      :aria-describedby="error ? `${id}-err` : undefined"
      :data-testid="testId"
      @change="commit"
      @keydown.enter="commit"
    />
    <span v-if="error" :id="`${id}-err`" class="field-hint err" role="alert">{{ error }}</span>
    <span v-else-if="hint" class="field-hint">{{ hint }}</span>
  </div>
</template>

<style scoped>
.err {
  color: var(--critical);
}
.compact .input {
  width: 100%;
}
</style>
