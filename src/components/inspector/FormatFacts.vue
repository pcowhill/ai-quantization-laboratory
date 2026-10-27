<script setup lang="ts">
import { computed } from 'vue';
import { exactDecimal } from '@/engine/float/rational';
import { characteristics, getFormat } from '@/engine/formats/registry';
import type { FormatId } from '@/engine/formats/types';
import { fmt } from '@/ui/format';

const props = defineProps<{ id: FormatId }>();
const f = computed(() => getFormat(props.id));
const rows = computed(() => {
  const d = f.value;
  if (d.kind === 'int') {
    return [
      ['Bits', `${d.totalBits} (two's complement)`],
      ['Range', `[${d.min}, ${d.max}]`],
      ['Narrow (symmetric) range', `[${-d.max}, ${d.max}]`],
      ['Special values', 'none (no NaN, no ∞, no −0)'],
    ];
  }
  const c = characteristics(d);
  const specials = [c.hasInfinity ? '±∞' : null, c.hasNaN ? `NaN (${c.nanEncodings} encoding${c.nanEncodings === 1 ? '' : 's'})` : 'no NaN', c.hasNegativeZero ? '±0' : 'single zero (no −0)'].filter(Boolean).join(', ');
  return [
    ['Bits (S / E / M)', `1 / ${d.exponentBits} / ${d.fractionBits} = ${d.totalBits}`],
    ['Exponent bias', String(d.bias)],
    ['emin … emax', `${c.emin} … ${c.emax}`],
    ['Max finite', c.maxFinite > 1e6 ? fmt(c.maxFinite, 8) : exactDecimal(c.maxFinite)],
    ['Min normal', fmt(c.minNormal, 8)],
    ['Min subnormal', fmt(c.minSubnormal, 8)],
    ['Machine ε (spacing at 1)', `2^${-d.fractionBits} ≈ ${fmt(c.epsilon, 4)}`],
    ['Decimal digits ≈', (c.precision * Math.log10(2)).toFixed(2)],
    ['Dynamic range', `${c.dynamicRangeBinades.toFixed(1)} binades`],
    ['Special values', specials],
    ['Default overflow', d.overflowSemantics === 'saturate-only' ? 'always saturates' : d.defaultOverflow === 'saturate' ? 'saturating' : 'non-saturating'],
  ];
});
</script>

<template>
  <div class="facts">
    <p class="profile">
      <span v-if="f.kind === 'float' && f.variant" class="badge badge-warning">variant · comparison only</span>
      {{ f.profile }}
    </p>
    <dl>
      <template v-for="[k, v] in rows" :key="k">
        <dt>{{ k }}</dt>
        <dd class="num">{{ v }}</dd>
      </template>
    </dl>
    <ul v-if="f.notes.length" class="fnotes">
      <li v-for="n in f.notes" :key="n">{{ n }}</li>
    </ul>
    <div class="refs">
      <span class="field-label">Specification</span>
      <ul>
        <li v-for="r in f.references" :key="r.title">
          <a v-if="r.url" :href="r.url" target="_blank" rel="noopener noreferrer">{{ r.title }}</a>
          <span v-else>{{ r.title }}</span>
          <span v-if="r.section" class="muted"> — {{ r.section }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.facts {
  font-size: 12.5px;
}
.profile {
  color: var(--text-2);
  margin-bottom: 8px;
}
dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 3px 10px;
  margin: 0;
}
dt {
  color: var(--text-3);
}
dd {
  margin: 0;
  text-align: right;
  overflow-wrap: anywhere;
}
.fnotes {
  margin: 10px 0 0;
  padding-left: 16px;
  color: var(--text-2);
}
.fnotes li {
  margin-bottom: 4px;
}
.refs {
  margin-top: 10px;
}
.refs ul {
  margin: 4px 0 0;
  padding-left: 16px;
}
</style>
