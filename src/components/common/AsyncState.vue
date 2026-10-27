<script setup lang="ts">
/** Placeholder shown while a lazily loaded part of the application loads, or when it fails to load. */
defineProps<{ failed?: boolean }>();
function reload() {
  window.location.reload();
}
</script>

<template>
  <div v-if="failed" class="async-state callout callout-critical" role="alert">
    This part of the laboratory could not be loaded — probably a lost connection before it was stored for offline use.
    <button type="button" class="btn btn-sm" @click="reload">Reload</button>
  </div>
  <div v-else class="async-state muted" role="status">Loading…</div>
</template>

<style scoped>
.async-state {
  margin: 24px;
  display: flex;
  align-items: center;
  gap: 10px;
}
</style>
