<script setup lang="ts">
import Drawer from '@/components/common/Drawer.vue';
import { useUiStore } from '@/stores/ui';
const ui = useUiStore();
</script>

<template>
  <Drawer title="Experiments" @close="ui.experimentsOpen = false">
    <p class="muted">This panel is being built in the next milestone.</p>
  </Drawer>
</template>
