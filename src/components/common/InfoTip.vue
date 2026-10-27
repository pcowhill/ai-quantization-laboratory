<script setup lang="ts">
import { ref } from 'vue';

defineProps<{ text: string; label?: string }>();
const open = ref(false);
const id = `tip-${Math.random().toString(36).slice(2, 9)}`;
</script>

<template>
  <span class="infotip" @mouseenter="open = true" @mouseleave="open = false">
    <button
      type="button"
      class="infotip-btn"
      :aria-label="label ?? 'More information'"
      :aria-describedby="open ? id : undefined"
      :aria-expanded="open"
      @focus="open = true"
      @blur="open = false"
      @click="open = !open"
      @keydown.esc="open = false"
    >
      i
    </button>
    <span v-if="open" :id="id" role="tooltip" class="infotip-pop">{{ text }}</span>
  </span>
</template>

<style scoped>
.infotip {
  position: relative;
  display: inline-flex;
  vertical-align: middle;
}
.infotip-btn {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 1px solid var(--border-strong);
  background: var(--surface);
  color: var(--text-3);
  font-size: 10px;
  font-weight: 700;
  font-style: italic;
  font-family: Georgia, serif;
  line-height: 1;
  padding: 0;
  cursor: help;
}
.infotip-pop {
  position: absolute;
  z-index: 50;
  left: 50%;
  top: calc(100% + 6px);
  transform: translateX(-50%);
  width: max-content;
  max-width: 300px;
  padding: 8px 10px;
  border-radius: var(--radius);
  background: var(--text);
  color: var(--surface);
  font-size: 12px;
  font-weight: 400;
  line-height: 1.45;
  box-shadow: var(--shadow-2);
  white-space: pre-line;
  text-transform: none;
  letter-spacing: normal;
}
</style>
