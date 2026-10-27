<script setup lang="ts">
/**
 * Thin ECharts wrapper: renders `option`, follows container size, rebuilds
 * on theme change, and re-emits pointer events with the data index.
 */
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { useUiStore } from '@/stores/ui';
import { echarts, type EChartsOption } from './echarts';

const props = withDefaults(defineProps<{ option: EChartsOption; height?: string; label: string; notMerge?: boolean }>(), {
  height: '260px',
  notMerge: true,
});
const emit = defineEmits<{
  (e: 'point-click', payload: { seriesIndex: number; dataIndex: number; data: unknown; seriesName?: string }): void;
  (e: 'point-hover', payload: { seriesIndex: number; dataIndex: number; data: unknown; seriesName?: string } | null): void;
}>();

const el = ref<HTMLDivElement | null>(null);
const chart = shallowRef<echarts.ECharts | null>(null);
const ui = useUiStore();
let observer: ResizeObserver | null = null;

function render() {
  if (!chart.value) return;
  chart.value.setOption(props.option, { notMerge: props.notMerge, lazyUpdate: true });
}

function create() {
  if (!el.value) return;
  chart.value?.dispose();
  const c = echarts.init(el.value, undefined, { renderer: 'canvas' });
  c.on('click', (p: { seriesIndex?: number; dataIndex?: number; data?: unknown; seriesName?: string }) =>
    emit('point-click', { seriesIndex: p.seriesIndex ?? 0, dataIndex: p.dataIndex ?? 0, data: p.data, seriesName: p.seriesName }),
  );
  c.on('mouseover', (p: { seriesIndex?: number; dataIndex?: number; data?: unknown; seriesName?: string }) =>
    emit('point-hover', { seriesIndex: p.seriesIndex ?? 0, dataIndex: p.dataIndex ?? 0, data: p.data, seriesName: p.seriesName }),
  );
  c.on('globalout', () => emit('point-hover', null));
  chart.value = c;
  render();
}

onMounted(() => {
  create();
  if (typeof ResizeObserver !== 'undefined' && el.value) {
    observer = new ResizeObserver(() => chart.value?.resize());
    observer.observe(el.value);
  }
});

watch(() => props.option, render);
// Colours come from CSS variables, so the parent recomputes `option`; the
// rebuild here makes sure canvas-cached styles are dropped too.
watch(() => ui.resolvedTheme, () => setTimeout(create, 0));

onBeforeUnmount(() => {
  observer?.disconnect();
  chart.value?.dispose();
});

defineExpose({ chart });
</script>

<template>
  <div ref="el" class="echart" role="img" :aria-label="label" :style="{ height }"></div>
</template>

<style scoped>
.echart {
  width: 100%;
  min-width: 0;
}
</style>
