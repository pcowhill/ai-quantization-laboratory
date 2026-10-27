<script setup lang="ts">
/**
 * Linear number line around the stored value: representable neighbours as
 * ticks, rounding boundaries (midpoints) as short marks, and the exact input.
 */
import { computed } from 'vue';
import { fmt } from '@/ui/format';

const props = defineProps<{ neighbours: { offset: number; value: number }[]; input: number | null; stored: number }>();

const W = 600;
const H = 92;
const PAD = 40;

const view = computed(() => {
  const vals = props.neighbours.map((n) => n.value).filter(Number.isFinite);
  if (vals.length < 2) return null;
  const all = props.input !== null && Number.isFinite(props.input) ? [...vals, props.input] : vals;
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const span = hi - lo || 1;
  const x = (v: number) => PAD + ((v - lo) / span) * (W - 2 * PAD);
  const sorted = [...vals].sort((a, b) => a - b);
  const mids = sorted.slice(1).map((v, i) => (v + sorted[i]!) / 2);
  return {
    ticks: props.neighbours.filter((n) => Number.isFinite(n.value)).map((n) => ({ ...n, x: x(n.value), label: fmt(n.value, 6) })),
    mids: mids.map((m) => ({ x: x(m) })),
    input: props.input !== null && Number.isFinite(props.input) ? x(props.input) : null,
  };
});
</script>

<template>
  <div v-if="view">
    <svg :viewBox="`0 0 ${W} ${H}`" class="nl" role="img" aria-label="Representable neighbours of the stored value on a number line">
      <line :x1="PAD - 10" :x2="W - PAD + 10" y1="40" y2="40" class="axis" />
      <g v-for="m in view.mids" :key="`m${m.x}`">
        <line :x1="m.x" :x2="m.x" y1="34" y2="46" class="mid" />
      </g>
      <g v-for="(t, i) in view.ticks" :key="t.offset">
        <line :x1="t.x" :x2="t.x" y1="26" y2="54" :class="t.offset === 0 ? 'tick stored' : 'tick'" />
        <text :x="t.x" :y="i % 2 === 0 ? 70 : 84" text-anchor="middle" :class="t.offset === 0 ? 'lbl stored' : 'lbl'">{{ t.label }}</text>
      </g>
      <g v-if="view.input !== null">
        <path :d="`M ${view.input} 22 l -5 -9 h 10 z`" class="input" />
        <text :x="view.input" y="9" text-anchor="middle" class="input-lbl">exact input</text>
      </g>
    </svg>
    <p class="muted small nl-note">Tall ticks: representable values (bold = stored). Short ticks: rounding boundaries halfway between neighbours. Triangle: the exact value you entered.</p>
  </div>
  <p v-else class="muted small">No finite neighbours to show.</p>
</template>

<style scoped>
.nl {
  width: 100%;
  height: auto;
  font-family: var(--font-mono);
  font-size: 10.5px;
}
.axis {
  stroke: var(--chart-axis);
}
.tick {
  stroke: var(--text-3);
  stroke-width: 1.5;
}
.tick.stored {
  stroke: var(--accent);
  stroke-width: 3;
}
.mid {
  stroke: var(--chart-muted);
}
.lbl {
  fill: var(--text-2);
}
.lbl.stored {
  fill: var(--accent-strong);
  font-weight: 700;
}
.input {
  fill: var(--bit-sign);
}
.input-lbl {
  fill: var(--bit-sign);
  font-family: var(--font-sans);
  font-size: 10px;
}
.nl-note {
  margin: 2px 0 0;
}
</style>
