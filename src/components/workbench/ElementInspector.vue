<script setup lang="ts">
/** Linked element inspection: one element through every variant. */
import { computed } from 'vue';
import { bitsToHex, encode } from '@/engine/float/codec';
import { exactDecimal } from '@/engine/float/rational';
import { getFormat } from '@/engine/formats/registry';
import { encodeInt } from '@/engine/int/codec';
import { describeBlock } from '@/engine/quant/layout';
import type { VariantEvaluation } from '@/labs/workbench';
import { flagLabels } from '@/labs/inspector';
import type { QuantVariant } from '@/state/schema';
import { variantSlot } from '@/composables/useWorkbench';
import { fmt } from '@/ui/format';
import NumberField from '@/components/common/NumberField.vue';

const props = defineProps<{ variants: QuantVariant[]; evaluations: VariantEvaluation[]; shape: [number, number]; original: Float64Array }>();
const selected = defineModel<number | null>({ required: true });
const n = computed(() => props.original.length);

const idx = computed({
  get: () => selected.value ?? 0,
  set: (v: number) => (selected.value = Math.min(n.value - 1, Math.max(0, Math.round(v)))),
});

const rows = computed(() => {
  const i = selected.value;
  if (i === null || i >= n.value) return [];
  return props.variants
    .filter((v) => v.enabled)
    .map((v) => {
      const e = props.evaluations.find((x) => x.id === v.id);
      const r = e?.result;
      if (!r) return { v, ok: false as const };
      const b = r.layout.blockOf[i]!;
      const p = r.params[b]!;
      const f = getFormat(r.config.format);
      const q = r.q[i]!;
      let bits = '';
      try {
        bits = f.kind === 'int' ? bitsToHex(encodeInt(f, q), f.totalBits) : bitsToHex(encode(f, q), f.totalBits);
      } catch {
        bits = '—';
      }
      const x = r.original[i]!;
      const y = r.recon[i]!;
      return {
        v,
        ok: true as const,
        block: describeBlock(r.layout, b),
        scale: r.config.scaling === 'scaled' ? p.scale : null,
        zp: p.zeroPoint,
        q,
        bits,
        recon: y,
        err: y - x,
        rel: x !== 0 ? Math.abs(y - x) / Math.abs(x) : null,
        flags: flagLabels(r.flags[i]!),
        isInt: f.kind === 'int',
      };
    });
});
const row = computed(() => (selected.value === null ? null : { r: Math.floor(selected.value / props.shape[1]), c: selected.value % props.shape[1] }));
</script>

<template>
  <div class="ei" data-testid="element-inspector">
    <div class="row">
      <NumberField v-model="idx" label="Element index" :min="0" :max="n - 1" integer compact />
      <div v-if="row && selected !== null" class="pos">
        <span class="muted small">row {{ row.r }}, column {{ row.c }}</span>
        <div class="num orig">x = {{ exactDecimal(original[selected]!) }}</div>
      </div>
      <p v-else class="muted small">Click a point in a chart or heatmap, or enter an index.</p>
    </div>
    <div v-if="rows.length" class="table-wrap">
      <table class="table">
        <thead>
          <tr><th>Variant</th><th>Block</th><th class="num">Scale s</th><th class="num">Zero-point z</th><th class="num">Code q</th><th>Bits</th><th class="num">x̂</th><th class="num">x̂ − x</th><th class="num">Rel. err</th><th>Flags</th></tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.v.id">
            <th scope="row"><span class="sw" :style="{ background: `var(--series-${variantSlot(r.v.id) + 1})` }" />{{ r.v.name }}</th>
            <template v-if="r.ok">
              <td class="small">{{ r.block }}</td>
              <td class="num">{{ r.scale === null ? '—' : fmt(r.scale, 6) }}</td>
              <td class="num">{{ r.isInt ? r.zp : '—' }}</td>
              <td class="num">{{ fmt(r.q, 8) }}</td>
              <td class="num">0x{{ r.bits }}</td>
              <td class="num">{{ fmt(r.recon, 8) }}</td>
              <td class="num">{{ fmt(r.err, 4) }}</td>
              <td class="num">{{ fmt(r.rel, 4) }}</td>
              <td class="small">{{ r.flags.join(', ') }}</td>
            </template>
            <td v-else colspan="9" class="muted">no result</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.ei {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ei .row {
  align-items: flex-end;
}
.ei .row > :first-child {
  width: 140px;
}
.orig {
  font-size: 13px;
  overflow-wrap: anywhere;
}
.sw {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 2px;
  margin-right: 4px;
}
</style>
