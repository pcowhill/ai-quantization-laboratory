<script setup lang="ts">
/**
 * Network structure: neurons as circles, connections coloured by weight
 * sign (blue negative, red positive) with opacity ∝ |w|. Neuron fill shows
 * how much the selected variant changes that neuron's output for the
 * selected input (relative to the baseline).
 */
import { computed } from 'vue';
import type { ForwardTrace, NetworkDef } from '@/engine/nn/network';
import { fmt } from '@/ui/format';

const props = defineProps<{
  net: NetworkDef;
  weights: Float64Array[] | null;
  base: ForwardTrace | null;
  variant: ForwardTrace | null;
  selection: { layer: number; unit: number | null; input: number | null } | null;
}>();
const emit = defineEmits<{ (e: 'select', s: { layer: number; unit: number | null; input: number | null }): void }>();

const W = 760;
const H = 380;
const PAD_X = 60;
const PAD_Y = 22;

const columns = computed(() => [props.net.inputSize, ...props.net.layers.map((l) => l.units)]);
const colX = (c: number) => PAD_X + (c * (W - 2 * PAD_X)) / Math.max(1, columns.value.length - 1);
const nodeY = (n: number, k: number) => (n === 1 ? H / 2 : PAD_Y + (k * (H - 2 * PAD_Y)) / (n - 1));
const radius = (n: number) => Math.max(2.2, Math.min(11, (H - 2 * PAD_Y) / (n * 2.6)));

const edges = computed(() => {
  const out: { x1: number; y1: number; x2: number; y2: number; w: number; op: number; width: number; key: string; layer: number; unit: number; input: number }[] = [];
  props.net.layers.forEach((l, li) => {
    const fanIn = columns.value[li]!;
    const ws = props.weights?.[li] ?? Float64Array.from(l.weights);
    let maxAbs = 0;
    for (const w of ws) maxAbs = Math.max(maxAbs, Math.abs(w));
    const dense = l.units * fanIn > 600;
    for (let j = 0; j < l.units; j++)
      for (let i = 0; i < fanIn; i++) {
        const w = ws[j * fanIn + i]!;
        const rel = maxAbs > 0 ? Math.abs(w) / maxAbs : 0;
        if (dense && rel < 0.15) continue;
        out.push({
          x1: colX(li),
          y1: nodeY(fanIn, i),
          x2: colX(li + 1),
          y2: nodeY(l.units, j),
          w,
          op: 0.08 + 0.75 * rel,
          width: dense ? 0.6 : 0.5 + 1.8 * rel,
          key: `${li}-${j}-${i}`,
          layer: li,
          unit: j,
          input: i,
        });
      }
  });
  return out;
});

const nodes = computed(() => {
  const out: { x: number; y: number; r: number; layer: number; unit: number | null; input: number | null; change: number; label: string; title: string }[] = [];
  const nIn = props.net.inputSize;
  for (let i = 0; i < nIn; i++) {
    const v = props.base?.layers[0]?.input[i];
    out.push({ x: colX(0), y: nodeY(nIn, i), r: radius(nIn), layer: 0, unit: null, input: i, change: 0, label: props.net.inputNames?.[i] ?? `x${i}`, title: `input ${props.net.inputNames?.[i] ?? i}: ${v === undefined ? '' : fmt(v, 6)}` });
  }
  props.net.layers.forEach((l, li) => {
    const b = props.base?.layers[li]?.output;
    const q = props.variant?.layers[li]?.output;
    let scale = 0;
    if (b) for (const v of b) scale = Math.max(scale, Math.abs(v));
    for (let j = 0; j < l.units; j++) {
      const bv = b?.[j];
      const qv = q?.[j];
      const change = bv !== undefined && qv !== undefined && scale > 0 ? Math.min(1, Math.abs(qv - bv) / (0.1 * scale)) : 0;
      const name = li === props.net.layers.length - 1 ? (props.net.outputNames?.[j] ?? `out ${j}`) : `h${li + 1}.${j}`;
      out.push({
        x: colX(li + 1),
        y: nodeY(l.units, j),
        r: radius(l.units),
        layer: li,
        unit: j,
        input: null,
        change,
        label: name,
        title: `${name}: baseline ${bv === undefined ? '' : fmt(bv, 6)}, variant ${qv === undefined ? '' : fmt(qv, 6)}`,
      });
    }
  });
  return out;
});

function isSelected(n: { layer: number; unit: number | null; input: number | null }) {
  const s = props.selection;
  if (!s) return false;
  return n.unit !== null ? s.layer === n.layer && s.unit === n.unit : s.input === n.input && s.unit === null;
}
const showLabels = computed(() => columns.value.every((c) => c <= 16));
</script>

<template>
  <svg :viewBox="`0 0 ${W} ${H}`" class="net" role="group" :aria-label="`Network with layer sizes ${columns.join(', ')}`">
    <g class="edges">
      <line
        v-for="e in edges"
        :key="e.key"
        :x1="e.x1"
        :y1="e.y1"
        :x2="e.x2"
        :y2="e.y2"
        :stroke="e.w < 0 ? 'var(--div-neg)' : 'var(--div-pos)'"
        :stroke-opacity="selection && selection.unit !== null && (selection.layer !== e.layer || selection.unit !== e.unit) ? e.op * 0.25 : e.op"
        :stroke-width="selection && selection.unit !== null && selection.layer === e.layer && selection.unit === e.unit ? e.width + 1 : e.width"
      />
    </g>
    <g v-for="(c, ci) in columns" :key="`col${ci}`">
      <text :x="colX(ci)" :y="12" text-anchor="middle" class="col-label">{{ ci === 0 ? `input (${c})` : ci === columns.length - 1 ? `output (${c})` : `layer ${ci} (${c})` }}</text>
    </g>
    <g class="nodes">
      <g
        v-for="n in nodes"
        :key="`${n.layer}-${n.unit}-${n.input}`"
        class="node"
        tabindex="0"
        role="button"
        :aria-label="n.title"
        @click="emit('select', { layer: n.layer, unit: n.unit, input: n.input })"
        @keydown.enter="emit('select', { layer: n.layer, unit: n.unit, input: n.input })"
        @keydown.space.prevent="emit('select', { layer: n.layer, unit: n.unit, input: n.input })"
      >
        <title>{{ n.title }}</title>
        <circle :cx="n.x" :cy="n.y" :r="n.r + 3" fill="transparent" />
        <circle
          :cx="n.x"
          :cy="n.y"
          :r="n.r"
          :fill="n.unit === null ? 'var(--surface-3)' : `color-mix(in srgb, var(--serious) ${Math.round(n.change * 100)}%, var(--surface))`"
          :stroke="isSelected(n) ? 'var(--text)' : 'var(--border-strong)'"
          :stroke-width="isSelected(n) ? 2.5 : 1"
        />
        <text v-if="showLabels" :x="n.unit === null ? n.x - n.r - 4 : n.x + n.r + 4" :y="n.y + 3.5" :text-anchor="n.unit === null ? 'end' : 'start'" class="node-label">{{ n.label }}</text>
      </g>
    </g>
  </svg>
</template>

<style scoped>
.net {
  width: 100%;
  height: auto;
  font-family: var(--font-sans);
}
.col-label {
  fill: var(--text-3);
  font-size: 11px;
}
.node {
  cursor: pointer;
  outline: none;
}
.node:focus-visible circle:last-of-type {
  stroke: var(--focus);
  stroke-width: 3;
}
.node-label {
  fill: var(--text-2);
  font-size: 10px;
}
</style>
