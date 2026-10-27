<script setup lang="ts">
/**
 * Dynamic range of each floating-point format on a log2 axis: subnormal
 * range (light), normal range (solid), with a marker at |value|.
 */
import { computed } from 'vue';
import { exponentOf } from '@/engine/float/double';
import { characteristics, getFormat } from '@/engine/formats/registry';
import type { FormatId } from '@/engine/formats/types';

const props = defineProps<{ formats: FormatId[]; selected: FormatId; value: number | null }>();
const emit = defineEmits<{ (e: 'select', id: FormatId): void }>();

const LO = -160;
const HI = 140;
const W = 1180;
const ROW = 24;
const LEFT = 120;
const plotW = W - LEFT - 16;
const x = (e: number) => LEFT + ((Math.max(LO, Math.min(HI, e)) - LO) / (HI - LO)) * plotW;

const rows = computed(() =>
  props.formats
    .map((id) => getFormat(id))
    .filter((f) => f.kind === 'float')
    .map((f, i) => {
      const c = characteristics(f as never);
      const lsub = Math.log2(c.minSubnormal);
      const lmin = Math.log2(c.minNormal);
      const lmax = Math.log2(c.maxFinite);
      return {
        id: f.id as FormatId,
        name: f.name,
        y: 8 + i * ROW,
        sub: [x(lsub), x(lmin)] as const,
        norm: [x(lmin), x(lmax)] as const,
        clippedLo: lsub < LO,
        clippedHi: lmax > HI,
        title: `${f.name}: subnormals from 2^${lsub.toFixed(0)}, normals 2^${lmin.toFixed(0)} … ${c.maxFinite.toPrecision(5)} (≈2^${lmax.toFixed(2)})`,
      };
    }),
);
const height = computed(() => 8 + rows.value.length * ROW + 28);
const ticks = [-150, -120, -90, -60, -30, 0, 30, 60, 90, 120].map((e) => ({ e, x: x(e), label: e === 0 ? '1' : `2^${e}` }));
const decTicks = [-40, -30, -20, -10, 0, 10, 20, 30].map((d) => ({ d, x: x(d * Math.log2(10)) }));
const marker = computed(() => {
  const v = props.value;
  if (v === null || !Number.isFinite(v) || v === 0) return null;
  const e = Math.log2(Math.abs(v));
  return { x: x(e), label: `|x| ≈ 2^${e.toFixed(2)}`, exp: exponentOf(Math.abs(v)) };
});
</script>

<template>
  <svg :viewBox="`0 0 ${W} ${height}`" class="range" role="img" :aria-label="`Dynamic range of ${rows.length} floating-point formats on a logarithmic axis`">
    <g v-for="d in decTicks" :key="`d${d.d}`">
      <line :x1="d.x" :x2="d.x" y1="4" :y2="height - 24" class="grid" />
    </g>
    <g v-for="r in rows" :key="r.id" class="row" :class="{ sel: r.id === selected }" style="cursor: pointer" @click="emit('select', r.id)">
      <title>{{ r.title }}</title>
      <rect x="0" :y="r.y - 3" :width="W" :height="ROW - 2" class="hit" />
      <text :x="LEFT - 8" :y="r.y + 13" text-anchor="end" class="label">{{ r.name }}</text>
      <rect :x="r.sub[0]" :y="r.y + 4" :width="Math.max(1, r.sub[1] - r.sub[0])" height="12" rx="3" class="sub" />
      <rect :x="r.norm[0]" :y="r.y + 4" :width="Math.max(1, r.norm[1] - r.norm[0])" height="12" rx="3" class="norm" />
      <text v-if="r.clippedLo" :x="LEFT + 2" :y="r.y + 14" class="clip">◀</text>
      <text v-if="r.clippedHi" :x="W - 26" :y="r.y + 14" class="clip">▶</text>
    </g>
    <g class="axis">
      <line :x1="LEFT" :x2="W - 16" :y1="height - 22" :y2="height - 22" />
      <g v-for="t in ticks" :key="t.e">
        <line :x1="t.x" :x2="t.x" :y1="height - 22" :y2="height - 18" />
        <text :x="t.x" :y="height - 6" text-anchor="middle">{{ t.label }}</text>
      </g>
    </g>
    <g v-if="marker">
      <line :x1="marker.x" :x2="marker.x" y1="2" :y2="height - 22" class="marker" />
      <text :x="marker.x + 4" y="10" class="marker-label">{{ marker.label }}</text>
    </g>
  </svg>
  <p class="range-note muted small">
    Light bars: subnormal range; solid bars: normal range (log₂ scale; faint vertical lines at powers of 10). Arrows mark ranges that extend beyond the plot (FP64 spans 2^−1074 … 2^1024). Click a row to select the format.
  </p>
</template>

<style scoped>
.range {
  width: 100%;
  height: auto;
  font-family: var(--font-sans);
  font-size: 11px;
}
.grid {
  stroke: var(--chart-grid);
}
.hit {
  fill: transparent;
}
.row:hover .hit {
  fill: var(--surface-2);
}
.row.sel .hit {
  fill: var(--accent-softer);
}
.label {
  fill: var(--text-2);
  font-size: 12px;
}
.row.sel .label {
  fill: var(--accent-strong);
  font-weight: 700;
}
.sub {
  fill: color-mix(in srgb, var(--series-1) 35%, transparent);
}
.norm {
  fill: var(--series-1);
}
.row.sel .norm {
  fill: var(--accent);
}
.row.sel .sub {
  fill: color-mix(in srgb, var(--accent) 35%, transparent);
}
.clip {
  fill: var(--text-3);
  font-size: 9px;
}
.axis line {
  stroke: var(--chart-axis);
}
.axis text {
  fill: var(--chart-muted);
}
.marker {
  stroke: var(--bit-sign);
  stroke-width: 1.5;
}
.marker-label {
  fill: var(--bit-sign);
  font-weight: 600;
}
.range-note {
  margin: 4px 0 0;
}
</style>
