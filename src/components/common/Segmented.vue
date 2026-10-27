<script setup lang="ts" generic="T extends string | number">
defineProps<{ options: { value: T; label: string; disabled?: boolean; title?: string }[]; label: string; small?: boolean }>();
const model = defineModel<T>({ required: true });
</script>

<template>
  <div class="segmented" :class="{ small }" role="radiogroup" :aria-label="label">
    <button
      v-for="o in options"
      :key="String(o.value)"
      type="button"
      role="radio"
      :aria-checked="model === o.value"
      :disabled="o.disabled"
      :title="o.title"
      :class="{ active: model === o.value }"
      @click="model = o.value"
    >
      {{ o.label }}
    </button>
  </div>
</template>

<style scoped>
.segmented {
  display: inline-flex;
  flex-wrap: wrap;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--surface);
}
.segmented button {
  border: none;
  border-right: 1px solid var(--border);
  background: transparent;
  padding: 0 10px;
  height: 28px;
  font-size: 12.5px;
  cursor: pointer;
  color: var(--text-2);
  white-space: nowrap;
}
.segmented.small button {
  height: 24px;
  padding: 0 8px;
  font-size: 12px;
}
.segmented button:last-child {
  border-right: none;
}
.segmented button:hover:not(:disabled) {
  background: var(--surface-3);
}
.segmented button.active {
  background: var(--accent);
  color: var(--text-on-accent);
  font-weight: 600;
}
.segmented button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
