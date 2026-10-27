<script setup lang="ts">
/** Side-by-side comparison of every variant's error metrics and storage. */
import { computed } from 'vue';
import type { VariantEvaluation } from '@/labs/workbench';
import type { QuantVariant } from '@/state/schema';
import { variantSlot } from '@/composables/useWorkbench';
import { bytes, db, fmt, pct } from '@/ui/format';
import InfoTip from '@/components/common/InfoTip.vue';

const props = defineProps<{ variants: QuantVariant[]; evaluations: VariantEvaluation[]; active: string }>();
const emit = defineEmits<{ (e: 'select', id: string): void }>();

interface Col {
  key: string;
  label: string;
  info: string;
  get: (e: VariantEvaluation) => number | null;
  show: (v: number | null) => string;
  better: 'low' | 'high';
}
const cols: Col[] = [
  { key: 'mse', label: 'MSE', info: 'Mean squared error over finite pairs.', get: (e) => e.metrics?.mse ?? null, show: (v) => fmt(v, 4), better: 'low' },
  { key: 'rmse', label: 'RMSE', info: 'Square root of the MSE (same units as the data).', get: (e) => e.metrics?.rmse ?? null, show: (v) => fmt(v, 4), better: 'low' },
  { key: 'mae', label: 'MAE', info: 'Mean absolute error.', get: (e) => e.metrics?.mae ?? null, show: (v) => fmt(v, 4), better: 'low' },
  { key: 'max', label: 'Max |err|', info: 'Largest absolute error of any element.', get: (e) => e.metrics?.maxAbs ?? null, show: (v) => fmt(v, 4), better: 'low' },
  { key: 'rel', label: 'Mean rel. err', info: 'Mean of |x̂ − x| / |x| over elements with x ≠ 0 (x = 0 counts as exact when x̂ = 0; otherwise undefined and excluded).', get: (e) => e.metrics?.meanRelative ?? null, show: (v) => fmt(v, 4), better: 'low' },
  { key: 'cos', label: 'Cosine sim.', info: 'Cosine of the angle between original and reconstructed vectors (undefined for zero vectors).', get: (e) => e.metrics?.cosine ?? null, show: (v) => (v === null ? '—' : v.toFixed(6)), better: 'high' },
  { key: 'snr', label: 'SNR', info: '10·log10(Σx² / Σ(x̂ − x)²) in dB; ∞ when the error is exactly zero.', get: (e) => e.metrics?.snrDb ?? null, show: (v) => db(v), better: 'high' },
  { key: 'zero', label: 'Zero rate', info: 'Fraction of reconstructed values equal to zero.', get: (e) => e.metrics?.zeroRate ?? null, show: (v) => pct(v), better: 'low' },
  { key: 'collapse', label: 'Collapsed to 0', info: 'Fraction of non-zero originals that were quantized to zero.', get: (e) => e.metrics?.zeroCollapseRate ?? null, show: (v) => pct(v), better: 'low' },
  { key: 'sat', label: 'Saturated', info: 'Fraction of elements clamped to the grid edge or overflowed.', get: (e) => e.metrics?.saturationRate ?? null, show: (v) => pct(v), better: 'low' },
  { key: 'bits', label: 'Bits / value', info: 'Theoretical packed size including scales and zero-points, per element.', get: (e) => e.storage?.bitsPerElement ?? null, show: (v) => (v === null ? '—' : v.toFixed(3)), better: 'low' },
];

const rows = computed(() =>
  props.variants
    .filter((v) => v.enabled)
    .map((v) => ({ v, e: props.evaluations.find((x) => x.id === v.id) ?? null })),
);

const best = computed(() => {
  const out: Record<string, number | null> = {};
  for (const c of cols) {
    const vals = rows.value.map((r) => (r.e ? c.get(r.e) : null)).filter((x): x is number => x !== null && !Number.isNaN(x));
    if (vals.length < 2) {
      out[c.key] = null;
      continue;
    }
    out[c.key] = c.better === 'low' ? Math.min(...vals) : Math.max(...vals);
  }
  return out;
});
</script>

<template>
  <div class="table-wrap">
    <table class="table metrics" data-testid="metrics-table">
      <caption class="visually-hidden">Error metrics per quantization variant</caption>
      <thead>
        <tr>
          <th scope="col">Variant</th>
          <th v-for="c in cols" :key="c.key" scope="col" class="num">
            {{ c.label }} <InfoTip :text="c.info" :label="`About ${c.label}`" />
          </th>
          <th scope="col" class="num">Packed size</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in rows" :key="r.v.id" :class="{ selected: r.v.id === active }" style="cursor: pointer" @click="emit('select', r.v.id)">
          <th scope="row">
            <button type="button" class="row-select" :aria-pressed="r.v.id === active" :title="`Edit ${r.v.name}`" @click.stop="emit('select', r.v.id)">
              <span class="sw" :style="{ background: `var(--series-${variantSlot(r.v.id) + 1})` }" aria-hidden="true" />
              {{ r.v.name }}
            </button>
          </th>
          <template v-if="r.e && r.e.metrics">
            <td v-for="c in cols" :key="c.key" class="num" :class="{ best: best[c.key] !== null && c.get(r.e) === best[c.key] }" :data-metric="c.key">
              {{ c.show(c.get(r.e)) }}
            </td>
            <td class="num">{{ r.e.storage ? bytes(r.e.storage.totalBytes) : '—' }}</td>
          </template>
          <td v-else :colspan="cols.length + 1" class="err">{{ r.e?.error ?? 'computing…' }} <template v-if="r.e?.issues.length">— {{ r.e.issues.filter((i) => i.severity === 'error').map((i) => i.message).join(' ') }}</template></td>
        </tr>
      </tbody>
    </table>
    <p class="muted small legend">Bold = best among the compared variants. Metrics exclude non-finite pairs; see the info icons for exact definitions.</p>
  </div>
</template>

<style scoped>
.metrics td.best {
  font-weight: 700;
  color: var(--accent-strong);
}
.sw {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 2px;
  margin-right: 4px;
}
.err {
  color: var(--critical);
}
.legend {
  margin: 6px 0 0;
}
.metrics th {
  white-space: nowrap;
}
</style>
