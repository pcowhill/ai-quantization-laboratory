<script setup lang="ts">
/** Two-step button for destructive actions: first click arms, second confirms. */
import { ref } from 'vue';

defineProps<{ label: string; confirmLabel?: string; danger?: boolean; small?: boolean; testId?: string; title?: string; disabled?: boolean }>();
const emit = defineEmits<{ (e: 'confirm'): void }>();
const armed = ref(false);
let timer: ReturnType<typeof setTimeout> | null = null;
function click() {
  if (armed.value) {
    armed.value = false;
    if (timer) clearTimeout(timer);
    emit('confirm');
    return;
  }
  armed.value = true;
  timer = setTimeout(() => (armed.value = false), 4000);
}
</script>

<template>
  <button
    type="button"
    class="btn"
    :class="{ 'btn-sm': small, armed, danger }"
    :data-testid="testId"
    :title="title"
    :disabled="disabled"
    :aria-label="!label && !armed ? title : undefined"
    :aria-live="armed ? 'polite' : undefined"
    @click="click"
    @blur="armed = false"
  >
    <slot v-if="!armed" />{{ armed ? (confirmLabel ?? `Confirm: ${label}?`) : label }}
  </button>
</template>

<style scoped>
/* Also while hovered: the global .btn:hover rule must not override the armed colours. */
.btn.armed,
.btn.armed:hover:not(:disabled) {
  background: var(--critical);
  border-color: var(--critical);
  color: var(--text-on-critical);
}
</style>
