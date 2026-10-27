<script setup lang="ts">
/** Right-hand drawer dialog with focus management and Escape to close. */
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';

const props = withDefaults(defineProps<{ title: string; width?: string; testId?: string }>(), { width: '520px' });
const emit = defineEmits<{ (e: 'close'): void }>();
const panel = ref<HTMLElement | null>(null);
let previous: HTMLElement | null = null;

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close');
  if (e.key === 'Tab' && panel.value) {
    const f = panel.value.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (!f.length) return;
    const first = f[0]!;
    const last = f[f.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
}
onMounted(async () => {
  previous = document.activeElement as HTMLElement | null;
  await nextTick();
  panel.value?.focus();
});
onBeforeUnmount(() => previous?.focus?.());
void props;
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div ref="panel" class="drawer" role="dialog" aria-modal="true" :aria-label="title" :style="{ width }" tabindex="-1" :data-testid="testId" @keydown="onKey">
      <header class="drawer-head">
        <h2>{{ title }}</h2>
        <slot name="head-actions" />
        <button type="button" class="btn btn-ghost btn-icon" aria-label="Close" @click="emit('close')">✕</button>
      </header>
      <div class="drawer-body"><slot /></div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(10, 16, 12, 0.32);
  display: flex;
  justify-content: flex-end;
}
.drawer {
  max-width: 100vw;
  height: 100%;
  background: var(--surface);
  box-shadow: var(--shadow-2);
  display: flex;
  flex-direction: column;
  outline: none;
}
.drawer-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}
.drawer-head h2 {
  flex: 1;
}
.drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 14px 16px 24px;
}
</style>
