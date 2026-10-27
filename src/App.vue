<script setup lang="ts">
import { PRIMARY_FORMAT_IDS, getFormat } from '@/engine/formats/registry';
</script>

<template>
  <main>
    <h1>AI Quantization Laboratory</h1>
    <p>Numerical engine scaffold. Supported formats:</p>
    <ul>
      <li v-for="id in PRIMARY_FORMAT_IDS" :key="id">{{ getFormat(id).name }}: {{ getFormat(id).profile }}</li>
    </ul>
  </main>
</template>
