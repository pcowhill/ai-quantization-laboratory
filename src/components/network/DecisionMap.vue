<script setup lang="ts">
/**
 * Decision regions of a 2-input classifier on a G×G grid (SVG), with the
 * samples drawn on top. Cells whose class differs from a reference grid are
 * drawn dark. Colours follow the categorical palette by class index.
 */
import { computed } from 'vue';
import { mixHex } from '@/ui/chartTheme';
import { usePalette } from '@/ui/usePalette';
import { fmt } from '@/ui/format';

const props = defineProps<{
  grid: Uint8Array;
  size: number;
  range: { x: [number, number]; y: [number, number] };
  samples: number[][];
  labels: number[] | null;
  compareTo: Uint8Array | null;
  selected: number;
  classNames: string[];
  label: string;
}>();
const emit = defineEmits<{ (e: 'select', i: number): void }>();
const palette = usePalette();

const W = 420;
const H = 320;
const L = 40;
const B = 26;
const PW = W - L - 8;
const PH = H - B - 8;
const sx = (x: number) => L + ((x - props.range.x[0]) / (props.range.x[1] - props.range.x[0])) * PW;
const sy = (y: number) => 8 + ((props.range.y[1] - y) / (props.range.y[1] - props.range.y[0])) * PH;

const classColor = (k: number) => palette.value.series[k % 8]!;
const cells = computed(() => {
  const out: { x: number; y: number; w: number; h: number; fill: string; key: number }[] = [];
  const cw = PW / props.size;
  const ch = PH / props.size;
  const changed = mixHex(palette.value.ink, palette.value.surface, 0.15);
  for (let r = 0; r < props.size; r++)
    for (let c = 0; c < props.size; c++) {
      const i = r * props.size + c;
      const k = props.grid[i]!;
      const diff = props.compareTo && props.compareTo[i] !== k;
      out.push({ x: L + c * cw, y: 8 + r * ch, w: cw + 0.6, h: ch + 0.6, fill: diff ? changed : mixHex(classColor(k), palette.value.surface, 0.72), key: i });
    }
  return out;
});
const points = computed(() =>
  props.samples.map((s, i) => ({
    i,
    x: sx(s[0]!),
    y: sy(s[1]!),
    fill: classColor(props.labels ? props.labels[i]! : 0),
    title: `sample #${i}: (${fmt(s[0]!, 4)}, ${fmt(s[1]!, 4)})${props.labels ? `, label ${props.classNames[props.labels[i]!] ?? props.labels[i]}` : ''}`,
  })),
);
const ticks = computed(() => {
  const mk = (lo: number, hi: number) => {
    const step = (hi - lo) / 4;
    return Array.from({ length: 5 }, (_, k) => lo + k * step);
  };
  return { x: mk(...props.range.x), y: mk(...props.range.y) };
});
</script>

<template>
  <div class="dmap">
    <svg :viewBox="`0 0 ${W} ${H}`" role="img" :aria-label="label">
      <g shape-rendering="crispEdges">
        <rect v-for="c in cells" :key="c.key" :x="c.x" :y="c.y" :width="c.w" :height="c.h" :fill="c.fill" />
      </g>
      <rect :x="L" y="8" :width="PW" :height="PH" fill="none" stroke="var(--chart-axis)" />
      <g class="axis">
        <g v-for="t in ticks.x" :key="`x${t}`">
          <line :x1="sx(t)" :x2="sx(t)" :y1="8 + PH" :y2="12 + PH" />
          <text :x="sx(t)" :y="H - 8" text-anchor="middle">{{ fmt(t, 3) }}</text>
        </g>
        <g v-for="t in ticks.y" :key="`y${t}`">
          <line :x1="L - 4" :x2="L" :y1="sy(t)" :y2="sy(t)" />
          <text :x="L - 6" :y="sy(t) + 3.5" text-anchor="end">{{ fmt(t, 3) }}</text>
        </g>
      </g>
      <g>
        <circle
          v-for="p in points"
          :key="p.i"
          :cx="p.x"
          :cy="p.y"
          :r="p.i === selected ? 6 : 3.2"
          :fill="p.fill"
          :stroke="p.i === selected ? 'var(--text)' : 'var(--surface)'"
          :stroke-width="p.i === selected ? 2 : 1"
          class="pt"
          tabindex="-1"
          @click="emit('select', p.i)"
        >
          <title>{{ p.title }}</title>
        </circle>
      </g>
    </svg>
    <ul class="legend" aria-label="Classes">
      <li v-for="(n, k) in classNames" :key="k"><span class="sw" :style="{ background: classColor(k) }" />{{ n }}</li>
      <li v-if="compareTo"><span class="sw" :style="{ background: 'var(--text)' }" />prediction changed</li>
    </ul>
  </div>
</template>

<style scoped>
.dmap svg {
  width: 100%;
  height: auto;
  display: block;
}
.axis line {
  stroke: var(--chart-axis);
}
.axis text {
  fill: var(--chart-muted);
  font-size: 10px;
  font-family: var(--font-sans);
}
.pt {
  cursor: pointer;
}
.legend {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin: 4px 0 0;
  padding: 0 0 0 40px;
  font-size: 11.5px;
  color: var(--text-2);
}
.sw {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  margin-right: 4px;
  vertical-align: -1px;
}
</style>
