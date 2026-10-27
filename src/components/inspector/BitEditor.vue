<script setup lang="ts">
/**
 * Editable bit pattern. Each bit is a toggle button; fields are colour-coded
 * and always labelled (S / exponent / fraction), so identity never relies on
 * colour alone.
 */
import { computed } from 'vue';
import type { InspectedValue } from '@/labs/inspector';

const props = defineProps<{ value: InspectedValue; base: 'binary' | 'hex' | 'decimal' }>();
const emit = defineEmits<{ (e: 'toggle', index: number): void }>();

const FIELD_LABEL: Record<string, string> = { sign: 'Sign', exponent: 'Exponent', fraction: 'Fraction (mantissa)', integer: 'Magnitude bits' };

const groups = computed(() =>
  props.value.fields.map((f) => ({
    ...f,
    label: FIELD_LABEL[f.name]!,
    bitsArr: f.bits.split('').map((b, k) => ({ bit: b, index: f.start + k })),
    display:
      props.base === 'binary' ? f.bits : props.base === 'hex' ? '0x' + f.value.toString(16).toUpperCase() : f.value.toString(),
  })),
);
const dense = computed(() => props.value.width > 32);

function posLabel(index: number) {
  return props.value.width - 1 - index;
}
</script>

<template>
  <div class="bit-editor" :class="{ dense }" data-testid="bit-editor">
    <div v-for="g in groups" :key="g.name" class="field-group" :class="`f-${g.name}`">
      <div class="bits" role="group" :aria-label="`${g.label} bits`">
        <button
          v-for="b in g.bitsArr"
          :key="b.index"
          type="button"
          class="bit"
          :class="{ on: b.bit === '1' }"
          :aria-pressed="b.bit === '1'"
          :aria-label="`${g.label} bit ${posLabel(b.index)}: ${b.bit}. Toggle`"
          :title="`Bit ${posLabel(b.index)} (${g.label}) — click to toggle`"
          :data-testid="`bit-${b.index}`"
          @click="emit('toggle', b.index)"
        >
          {{ b.bit }}
        </button>
      </div>
      <div class="field-caption">
        <span class="field-name">{{ g.label }}<template v-if="g.length > 1"> · {{ g.length }} bits</template></span>
        <span class="field-value num">{{ g.display }}</span>
        <span class="field-meaning">{{ g.meaning }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bit-editor {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 6px;
  align-items: flex-start;
}
.field-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}
.bits {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  padding: 4px;
  border-radius: var(--radius);
}
.bit {
  width: 28px;
  height: 36px;
  border: 1px solid transparent;
  border-radius: 4px;
  font-family: var(--font-mono);
  font-size: 17px;
  font-weight: 600;
  cursor: pointer;
  background: var(--surface);
  color: var(--text-3);
  transition: transform 0.06s;
}
.dense .bit {
  width: 19px;
  height: 28px;
  font-size: 13px;
}
.bit.on {
  color: #fff;
}
.bit:hover {
  transform: translateY(-1px);
}
.f-sign .bits { background: var(--bit-sign-bg); }
.f-sign .bit { border-color: color-mix(in srgb, var(--bit-sign) 35%, transparent); }
.f-sign .bit.on { background: var(--bit-sign); }
.f-exponent .bits { background: var(--bit-exp-bg); }
.f-exponent .bit { border-color: color-mix(in srgb, var(--bit-exp) 35%, transparent); }
.f-exponent .bit.on { background: var(--bit-exp); }
.f-fraction .bits { background: var(--bit-frac-bg); }
.f-fraction .bit { border-color: color-mix(in srgb, var(--bit-frac) 35%, transparent); }
.f-fraction .bit.on { background: var(--bit-frac); }
.f-integer .bits { background: var(--bit-int-bg); }
.f-integer .bit { border-color: color-mix(in srgb, var(--bit-int) 35%, transparent); }
.f-integer .bit.on { background: var(--bit-int); }
:root[data-theme='dark'] .bit.on,
.bit.on {
  text-shadow: 0 0 1px rgba(0, 0, 0, 0.3);
}
.field-caption {
  display: flex;
  flex-direction: column;
  padding: 0 4px;
  font-size: 12px;
  line-height: 1.35;
  max-width: 360px;
}
.field-name {
  font-weight: 600;
  color: var(--text-2);
}
.f-sign .field-name { color: var(--bit-sign); }
.f-exponent .field-name { color: var(--bit-exp); }
.f-fraction .field-name { color: var(--bit-frac); }
.f-integer .field-name { color: var(--bit-int); }
.field-value {
  font-size: 12.5px;
  word-break: break-all;
}
.field-meaning {
  color: var(--text-3);
}
</style>
