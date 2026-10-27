<script setup lang="ts">
defineProps<{ issues: { severity: 'error' | 'warning'; message: string }[] }>();
</script>

<template>
  <ul v-if="issues.length" class="issues" aria-live="polite">
    <li v-for="(i, k) in issues" :key="k" class="callout" :class="i.severity === 'error' ? 'callout-critical' : 'callout-warning'">
      <span aria-hidden="true">{{ i.severity === 'error' ? '⛔' : '⚠️' }}</span>
      <span><strong>{{ i.severity === 'error' ? 'Invalid:' : 'Note:' }}</strong> {{ i.message }}</span>
    </li>
  </ul>
</template>

<style scoped>
.issues {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
</style>
