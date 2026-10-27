<script setup lang="ts">
/**
 * Chart container with a title, an explanatory caption and an accessible
 * table alternative that shows the exact numbers behind the chart.
 */
import { ref } from 'vue';
import InfoTip from '@/components/common/InfoTip.vue';

const props = withDefaults(
  defineProps<{ title: string; caption?: string; info?: string; columns?: string[]; rows?: (string | number)[][]; maxRows?: number; testId?: string }>(),
  { maxRows: 400 },
);
const showTable = ref(false);
const visibleRows = () => (props.rows ?? []).slice(0, props.maxRows);
</script>

<template>
  <figure class="chart-card card" :data-testid="testId">
    <figcaption class="chart-head">
      <div class="chart-title">
        <h3>{{ title }}</h3>
        <InfoTip v-if="info" :text="info" :label="`About ${title}`" />
      </div>
      <div class="chart-actions">
        <slot name="actions" />
        <button v-if="columns && rows" type="button" class="btn btn-ghost btn-sm" :aria-pressed="showTable" @click="showTable = !showTable">
          {{ showTable ? 'Chart' : 'Table' }}
        </button>
      </div>
    </figcaption>
    <p v-if="caption" class="chart-caption">{{ caption }}</p>
    <div v-if="showTable && columns && rows" class="table-wrap chart-table" tabindex="0" role="region" :aria-label="`Data table: ${title}`">
      <table class="table">
        <thead>
          <tr><th v-for="c in columns" :key="c" scope="col">{{ c }}</th></tr>
        </thead>
        <tbody>
          <tr v-for="(r, i) in visibleRows()" :key="i">
            <td v-for="(cell, j) in r" :key="j" :class="{ num: typeof cell === 'number' || /^[−\-+0-9.eE∞]+$/.test(String(cell)) }">{{ cell }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="(rows?.length ?? 0) > maxRows" class="muted small">Showing the first {{ maxRows }} of {{ rows!.length }} rows.</p>
    </div>
    <div v-show="!showTable" class="chart-body"><slot /></div>
    <div v-if="$slots.footer" class="chart-footer"><slot name="footer" /></div>
  </figure>
</template>

<style scoped>
.chart-card {
  margin: 0;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.chart-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 9px 12px 0;
}
.chart-title {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.chart-title h3 {
  font-size: 13px;
}
.chart-actions {
  display: flex;
  gap: 4px;
  align-items: center;
}
.chart-caption {
  margin: 2px 12px 0;
  font-size: 12px;
  color: var(--text-3);
}
.chart-body {
  padding: 4px 6px 6px;
  min-width: 0;
}
.chart-table {
  max-height: 300px;
  margin: 6px 12px 12px;
}
.chart-footer {
  padding: 0 12px 10px;
  font-size: 12px;
  color: var(--text-3);
}
</style>
