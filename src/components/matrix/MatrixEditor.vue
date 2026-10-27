<script setup lang="ts">
/** Editable matrix operand: a cell grid for small matrices, text for larger ones. */
import { computed, ref, watch } from 'vue';
import { generate } from '@/engine/random/distributions';
import { DataParseError, parseDelimited } from '@/labs/importData';
import type { MatrixOperand } from '@/state/schema';
import NumberField from '@/components/common/NumberField.vue';
import Icon from '@/components/common/Icon.vue';

const props = defineProps<{ name: string; maxDim?: number; fixedRows?: number; fixedCols?: number }>();
const m = defineModel<MatrixOperand>({ required: true });
const maxDim = computed(() => props.maxDim ?? 4096);
const gridMode = computed(() => m.value.rows * m.value.cols <= 48 && m.value.cols <= 8);

function resize(rows: number, cols: number) {
  const values: number[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) values.push(r < m.value.rows && c < m.value.cols ? m.value.values[r * m.value.cols + c]! : 0);
  m.value = { rows, cols, values };
}
const rows = computed({ get: () => m.value.rows, set: (v: number) => resize(v, m.value.cols) });
const cols = computed({ get: () => m.value.cols, set: (v: number) => resize(m.value.rows, v) });

function setCell(i: number, raw: string) {
  const v = Number(raw.trim().toLowerCase() === 'nan' ? NaN : raw);
  if (raw.trim() === '' || (Number.isNaN(v) && raw.trim().toLowerCase() !== 'nan')) return;
  const values = [...m.value.values];
  values[i] = v;
  m.value = { ...m.value, values };
}

const text = ref('');
const textErrors = ref<string[]>([]);
function syncText() {
  const lines: string[] = [];
  for (let r = 0; r < m.value.rows; r++) lines.push(m.value.values.slice(r * m.value.cols, (r + 1) * m.value.cols).join(', '));
  text.value = lines.join('\n');
}
watch(() => m.value, syncText, { immediate: true, deep: true });
function applyText() {
  try {
    const t = parseDelimited(text.value);
    if (t.rows > maxDim.value || t.cols > maxDim.value) throw new DataParseError([`At most ${maxDim.value}×${maxDim.value}.`]);
    m.value = { rows: t.rows, cols: t.cols, values: t.values };
    textErrors.value = [];
  } catch (e) {
    textErrors.value = e instanceof DataParseError ? e.problems : [(e as Error).message];
  }
}
const seed = ref(1);
function randomize() {
  seed.value = (seed.value * 1103515245 + 12345) >>> 0;
  m.value = { ...m.value, values: Array.from(generate({ kind: 'normal', params: { mean: 0, std: 1 }, rows: m.value.rows, cols: m.value.cols, seed: seed.value }), (v) => Math.round(v * 1000) / 1000) };
}
</script>

<template>
  <div class="medit">
    <div class="row head">
      <strong>{{ name }}</strong>
      <span class="muted small">{{ m.rows }}×{{ m.cols }}</span>
      <span class="spacer" />
      <button type="button" class="btn btn-ghost btn-sm" title="Fill with seeded random normal values" @click="randomize"><Icon name="dice" :size="14" /> Random</button>
    </div>
    <div class="field-row">
      <NumberField v-model="rows" label="Rows" :min="1" :max="maxDim" integer :disabled="fixedRows !== undefined" />
      <NumberField v-model="cols" label="Columns" :min="1" :max="maxDim" integer :disabled="fixedCols !== undefined" />
    </div>
    <div v-if="gridMode" class="cells" :style="{ gridTemplateColumns: `repeat(${m.cols}, minmax(52px, 1fr))` }" role="grid" :aria-label="`Matrix ${name}`">
      <input
        v-for="(v, i) in m.values"
        :key="`${m.rows}x${m.cols}-${i}`"
        class="input num cell"
        :value="Object.is(v, -0) ? '-0' : String(v)"
        :aria-label="`${name}[${Math.floor(i / m.cols)}, ${i % m.cols}]`"
        :data-testid="`${name}-cell-${i}`"
        @change="setCell(i, ($event.target as HTMLInputElement).value)"
      />
    </div>
    <template v-else>
      <textarea v-model="text" class="input num" rows="5" spellcheck="false" :aria-label="`Values of ${name}`" />
      <button type="button" class="btn btn-sm" @click="applyText">Apply values</button>
      <ul v-if="textErrors.length" class="errs"><li v-for="e in textErrors" :key="e">{{ e }}</li></ul>
    </template>
  </div>
</template>

<style scoped>
.medit {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.head {
  gap: 6px;
}
.cells {
  display: grid;
  gap: 3px;
}
.cell {
  height: 26px;
  padding: 0 4px;
  font-size: 12px;
  text-align: right;
  min-width: 0;
}
.errs {
  margin: 0;
  padding-left: 16px;
  color: var(--critical);
  font-size: 12px;
}
</style>
