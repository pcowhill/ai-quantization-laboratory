<script setup lang="ts">
import { ref } from 'vue';

const props = withDefaults(defineProps<{ title: string; collapsible?: boolean; initiallyOpen?: boolean; dense?: boolean }>(), {
  collapsible: true,
  initiallyOpen: true,
  dense: false,
});
const open = ref(props.initiallyOpen);
const id = `sec-${Math.random().toString(36).slice(2, 9)}`;
</script>

<template>
  <section class="section" :class="{ dense }">
    <header class="section-head">
      <button v-if="collapsible" type="button" class="section-toggle" :aria-expanded="open" :aria-controls="id" @click="open = !open">
        <span class="chev" :class="{ open }" aria-hidden="true">▸</span>
        <h3>{{ title }}</h3>
      </button>
      <h3 v-else class="section-title">{{ title }}</h3>
      <div class="section-actions"><slot name="actions" /></div>
    </header>
    <div v-show="open" :id="id" class="section-body"><slot /></div>
  </section>
</template>

<style scoped>
.section {
  border-bottom: 1px solid var(--border);
}
.section:last-child {
  border-bottom: none;
}
.section-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 9px 12px 7px;
}
.section-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  border: none;
  background: none;
  padding: 0;
  cursor: pointer;
  flex: 1;
  text-align: left;
  min-width: 0;
}
.section-title {
  flex: 1;
}
.section-head h3 {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-2);
}
.chev {
  font-size: 10px;
  color: var(--text-3);
  transition: transform 0.12s;
}
.chev.open {
  transform: rotate(90deg);
}
.section-actions {
  display: flex;
  gap: 4px;
}
.section-body {
  padding: 2px 12px 12px;
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.dense .section-body {
  gap: 6px;
}
</style>
