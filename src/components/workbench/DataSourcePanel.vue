<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { DATASETS } from '@/data/datasets';
import { DISTRIBUTIONS, defaultParams, distributionDef, MAX_GENERATED_ELEMENTS, type DistributionKind } from '@/engine/random/distributions';
import { DataParseError, parseDataFile, parseDelimited } from '@/labs/importData';
import { plainClone } from '@/state/clone';
import type { DataSource } from '@/state/schema';
import SelectField from '@/components/common/SelectField.vue';
import NumberField from '@/components/common/NumberField.vue';
import Segmented from '@/components/common/Segmented.vue';
import Icon from '@/components/common/Icon.vue';

const source = defineModel<DataSource>({ required: true });
const props = defineProps<{ catalogId?: string | null; testIdPrefix?: string }>();
const emit = defineEmits<{ (e: 'catalog', id: string | null): void }>();

type Mode = 'catalog' | 'generator' | 'manual' | 'import';
const mode = ref<Mode>(source.value.kind === 'generator' ? (props.catalogId ? 'catalog' : 'generator') : source.value.kind === 'builtin' ? 'catalog' : source.value.kind === 'manual' ? 'manual' : 'import');

const catalogOptions = computed(() => [
  { value: '', label: '— choose a dataset —', disabled: true },
  ...DATASETS.map((d) => ({ value: d.id, label: d.name, group: d.category, title: d.description })),
]);
const catalogModel = computed({
  get: () => props.catalogId ?? '',
  set: (id: string) => {
    const d = DATASETS.find((x) => x.id === id);
    if (!d) return;
    source.value = plainClone(d.source);
    emit('catalog', id);
  },
});
const catalogEntry = computed(() => DATASETS.find((d) => d.id === props.catalogId) ?? null);

// Generator
const gen = computed(() => (source.value.kind === 'generator' ? source.value : null));
function toGenerator() {
  if (source.value.kind !== 'generator') {
    source.value = { kind: 'generator', distribution: 'normal', params: defaultParams('normal'), rows: 16, cols: 64, seed: 42 };
  }
  emit('catalog', null);
}
const distModel = computed({
  get: () => gen.value?.distribution ?? 'normal',
  set: (k: DistributionKind) => {
    if (!gen.value) return;
    source.value = { ...gen.value, distribution: k, params: defaultParams(k) };
    emit('catalog', null);
  },
});
const distOptions = DISTRIBUTIONS.map((d) => ({ value: d.kind, label: d.name, group: d.category, title: d.description }));
const genDef = computed(() => (gen.value ? distributionDef(gen.value.distribution) : null));
function setParam(key: string, v: number) {
  if (!gen.value) return;
  source.value = { ...gen.value, params: { ...gen.value.params, [key]: v } };
  emit('catalog', null);
}
function setGen(key: 'rows' | 'cols' | 'seed', v: number) {
  if (!gen.value) return;
  source.value = { ...gen.value, [key]: v };
  emit('catalog', null);
}
const sizeError = computed(() => (gen.value && gen.value.rows * gen.value.cols > MAX_GENERATED_ELEMENTS ? `At most ${MAX_GENERATED_ELEMENTS.toLocaleString()} elements.` : null));
function newSeed() {
  if (!gen.value) return;
  setGen('seed', (gen.value.seed * 1103515245 + 12345) >>> 0);
}

// Manual
const manualText = ref('');
const manualErrors = ref<string[]>([]);
function loadManualText() {
  const s = source.value;
  if (s.kind === 'manual' || s.kind === 'imported') {
    const lines: string[] = [];
    for (let r = 0; r < s.rows; r++) lines.push(s.values.slice(r * s.cols, (r + 1) * s.cols).map(String).join(', '));
    manualText.value = lines.join('\n');
  } else if (!manualText.value) {
    manualText.value = '0.1, -0.5, 2.25, 3.14159\n1e-3, 0, -7.5, 100';
  }
}
watch(mode, (m) => {
  if (m === 'manual') loadManualText();
  if (m === 'generator') toGenerator();
});
function applyManual() {
  try {
    const t = parseDelimited(manualText.value);
    source.value = { kind: 'manual', rows: t.rows, cols: t.cols, values: t.values };
    manualErrors.value = t.notes;
    emit('catalog', null);
  } catch (e) {
    manualErrors.value = e instanceof DataParseError ? e.problems : [(e as Error).message];
  }
}

// Import
const importErrors = ref<string[]>([]);
const importNotes = ref<string[]>([]);
async function onFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  importErrors.value = [];
  importNotes.value = [];
  if (file.size > 32 * 1024 * 1024) {
    importErrors.value = ['File too large (max 32 MB).'];
    return;
  }
  const text = await file.text();
  try {
    const t = parseDataFile(file.name, text);
    source.value = { kind: 'imported', name: file.name.slice(0, 200), rows: t.rows, cols: t.cols, values: t.values };
    importNotes.value = [`Imported ${t.rows}×${t.cols} = ${(t.rows * t.cols).toLocaleString()} values from ${file.name}.`, ...t.notes];
    emit('catalog', null);
  } catch (err) {
    importErrors.value = err instanceof DataParseError ? err.problems : [(err as Error).message];
  }
  input.value = '';
}
</script>

<template>
  <div class="dsp">
    <Segmented
      v-model="mode"
      label="Data source"
      small
      :options="[
        { value: 'catalog', label: 'Catalog' },
        { value: 'generator', label: 'Generator' },
        { value: 'manual', label: 'Manual' },
        { value: 'import', label: 'Import' },
      ]"
    />
    <template v-if="mode === 'catalog'">
      <SelectField v-model="catalogModel" label="Dataset" :options="catalogOptions" :test-id="`${testIdPrefix ?? 'data'}-catalog`" />
      <div v-if="catalogEntry" class="callout">
        <span>
          {{ catalogEntry.description }}
          <template v-if="catalogEntry.tip"><br /><strong>Try:</strong> {{ catalogEntry.tip }}</template>
        </span>
      </div>
      <p v-if="source.kind === 'generator'" class="field-hint">This dataset is generated with a fixed seed; switch to <em>Generator</em> to change its parameters.</p>
    </template>

    <template v-else-if="mode === 'generator' && gen && genDef">
      <SelectField v-model="distModel" label="Distribution" :options="distOptions" :info="genDef.description" />
      <div class="field-row">
        <NumberField v-for="p in genDef.params" :key="`${gen.distribution}-${p.key}`" :model-value="gen.params[p.key] ?? p.default" :label="p.label" :min="p.min" :max="p.max" :integer="p.integer" @update:model-value="setParam(p.key, $event)" />
      </div>
      <div class="field-row">
        <NumberField :model-value="gen.rows" label="Rows" :min="1" :max="4096" integer @update:model-value="setGen('rows', $event)" />
        <NumberField :model-value="gen.cols" label="Columns" :min="1" :max="1048576" integer @update:model-value="setGen('cols', $event)" />
      </div>
      <div class="seed-row">
        <NumberField :model-value="gen.seed" label="Seed" :min="0" :max="4294967295" integer info="The same seed always produces exactly the same data (xoshiro128**)." @update:model-value="setGen('seed', $event)" />
        <button type="button" class="btn btn-sm" title="Next seed" @click="newSeed"><Icon name="dice" /> New seed</button>
      </div>
      <p v-if="sizeError" class="field-hint" style="color: var(--critical)">{{ sizeError }}</p>
    </template>

    <template v-else-if="mode === 'manual'">
      <div class="field">
        <label for="manual-data">Values (one row per line; comma, tab or space separated)</label>
        <textarea id="manual-data" v-model="manualText" class="input num" rows="6" spellcheck="false" data-testid="manual-data" />
      </div>
      <button type="button" class="btn btn-primary btn-sm" data-testid="manual-apply" @click="applyManual">Use these values</button>
      <ul v-if="manualErrors.length" class="msgs">
        <li v-for="m in manualErrors" :key="m">{{ m }}</li>
      </ul>
    </template>

    <template v-else>
      <div class="field">
        <label for="data-file">CSV, TSV or JSON file</label>
        <input id="data-file" type="file" accept=".csv,.tsv,.txt,.json,text/csv,application/json" data-testid="data-file" @change="onFile" />
        <span class="field-hint">Files are read locally in your browser and never uploaded. CSV: one row per line, optional header. JSON: an array, an array of arrays, or {"rows","cols","values"}.</span>
      </div>
      <ul v-if="importErrors.length" class="msgs err" role="alert" data-testid="import-errors">
        <li v-for="m in importErrors" :key="m">{{ m }}</li>
      </ul>
      <ul v-if="importNotes.length" class="msgs" data-testid="import-notes">
        <li v-for="m in importNotes" :key="m">{{ m }}</li>
      </ul>
      <p v-if="source.kind === 'imported'" class="field-hint">Current data: {{ source.name }} ({{ source.rows }}×{{ source.cols }}).</p>
    </template>
  </div>
</template>

<style scoped>
.dsp {
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.seed-row {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}
.seed-row > :first-child {
  flex: 1;
}
.msgs {
  margin: 0;
  padding-left: 18px;
  font-size: 12px;
  color: var(--text-2);
}
.msgs.err {
  color: var(--critical);
}
</style>
