<script setup lang="ts">
import { ref } from 'vue';

const props = defineProps<{ text: string; label?: string }>();
const done = ref(false);
async function copy() {
  try {
    await navigator.clipboard.writeText(props.text);
    done.value = true;
    setTimeout(() => (done.value = false), 1200);
  } catch {
    /* clipboard unavailable */
  }
}
</script>

<template>
  <button type="button" class="btn btn-ghost btn-sm copy" :aria-label="label ?? 'Copy value'" :title="label ?? 'Copy value'" @click="copy">
    {{ done ? '✓' : '⧉' }}
  </button>
</template>

<style scoped>
.copy {
  height: 22px;
  padding: 0 5px;
  color: var(--text-3);
}
</style>
