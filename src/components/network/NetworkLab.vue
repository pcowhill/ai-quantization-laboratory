<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ACTIVATIONS, initNetwork, MAX_LAYERS, MAX_UNITS, type Activation, type NetworkDef } from '@/engine/nn/network';
import { NormalSampler } from '@/engine/random/distributions';
import { Rng } from '@/engine/random/prng';
import { NETWORK_PRESETS, networkPreset } from '@/data/networks';
import { NETWORK_SCENARIOS, applyScenario } from '@/data/networkScenarios';
import { useNetworkEvaluation } from '@/composables/useNetwork';
import { variantSlot } from '@/composables/useWorkbench';
import { networkStateFromPreset, defaultNetworkVariants } from '@/state/defaults';
import { plainClone } from '@/state/clone';
import { DataParseError, parseDelimited } from '@/labs/importData';
import { EVAL_SAMPLE_LIMIT } from '@/labs/network';
import { useLabStore } from '@/stores/lab';
import { usePalette } from '@/ui/usePalette';
import { decisionChart, outputsChart, propagationChart, type NamedTrace } from '@/ui/charts/network';
import { fmt, pct } from '@/ui/format';
import Section from '@/components/common/Section.vue';
import SelectField from '@/components/common/SelectField.vue';
import NumberField from '@/components/common/NumberField.vue';
import Icon from '@/components/common/Icon.vue';
import InfoTip from '@/components/common/InfoTip.vue';
import IssueList from '@/components/common/IssueList.vue';
import ChartCard from '@/components/charts/ChartCard.vue';
import EChart from '@/components/charts/EChart.vue';
import NetworkDiagram from './NetworkDiagram.vue';
import DecisionMap from './DecisionMap.vue';
import LayerQuantEditor from './LayerQuantEditor.vue';

const lab = useLabStore();
const s = computed(() => lab.state.network);
const palette = usePalette();
const { evaluation, grids, computing, error, plotRange } = useNetworkEvaluation(() => lab.state.network);

const scenarioId = ref<string>('');
const scenario = computed(() => NETWORK_SCENARIOS.find((x) => x.id === scenarioId.value) ?? null);
const scenarioModel = computed({
  get: () => scenarioId.value,
  set: (id: string) => {
    scenarioId.value = id;
    lab.state.network = applyScenario(id);
  },
});
const presetModel = computed({
  get: () => s.value.presetId ?? '',
  set: (id: string) => {
    scenarioId.value = '';
    lab.state.network = networkStateFromPreset(networkPreset(id));
  },
});
const preset = computed(() => NETWORK_PRESETS.find((p) => p.id === s.value.presetId) ?? null);

// ------------------------------------------------------------ variants
const activeVariant = computed({
  get: () => s.value.variants.find((v) => v.id === s.value.activeVariantId) ?? s.value.variants[0]!,
  set: (v) => {
    const i = s.value.variants.findIndex((x) => x.id === v.id);
    if (i >= 0) s.value.variants[i] = v;
  },
});
function addVariant() {
  if (s.value.variants.length >= 6) return;
  const used = new Set(s.value.variants.map((v) => v.id));
  let k = 1;
  while (used.has(`n${k}`)) k++;
  const copy = plainClone(activeVariant.value);
  s.value.variants.push({ ...copy, id: `n${k}`, name: `${copy.name} (copy)` });
  s.value.activeVariantId = `n${k}`;
}
function removeVariant(id: string) {
  if (s.value.variants.length <= 1) return;
  s.value.variants = s.value.variants.filter((v) => v.id !== id);
  if (s.value.activeVariantId === id) s.value.activeVariantId = s.value.variants[0]!.id;
}

// ------------------------------------------------------------ evaluation views
const ev = computed(() => evaluation.value);
const enabled = computed(() => s.value.variants.filter((v) => v.enabled));
const summaries = computed(() =>
  (ev.value?.summaries ?? []).map((x) => {
    const v = s.value.variants.find((y) => y.id === x.id);
    return { ...x, name: v?.name ?? x.id, slot: variantSlot(x.id) };
  }),
);
const sel = computed(() => Math.min(s.value.selectedSample, s.value.samples.length - 1));
const namedTraces = computed<NamedTrace[]>(() =>
  enabled.value.map((v) => ({ id: v.id, name: v.name, slot: variantSlot(v.id), trace: ev.value?.variantTraces[v.id] ?? null })).filter((t): t is NamedTrace => t.trace !== null),
);
const outputs = computed(() =>
  ev.value?.baselineTrace ? outputsChart(palette.value, ev.value.baselineTrace, namedTraces.value, s.value.network.outputNames ?? [], s.value.network.output === 'softmax' ? 'probability' : 'output') : null,
);
const propagation = computed(() => (summaries.value.length ? propagationChart(palette.value, summaries.value, s.value.network.layers.length) : null));
const activeSummary = computed(() => summaries.value.find((x) => x.id === s.value.activeVariantId) ?? null);
const activeTrace = computed(() => ev.value?.variantTraces[s.value.activeVariantId] ?? null);
const activePrepared = computed(() => ev.value?.variants.find((v) => v.id === s.value.activeVariantId)?.prepared ?? null);
const variantErrors = computed(() => (ev.value?.variants ?? []).filter((v) => v.error).map((v) => ({ severity: 'error' as const, message: `${v.name}: ${v.error}` })));

const classes = computed(() => s.value.network.layers.at(-1)!.units);
const baseGrid = computed(() => grids.value.find((g) => g.id === 'baseline')?.grid ?? null);
const varGrid = computed(() => grids.value.find((g) => g.id === s.value.activeVariantId)?.grid ?? null);
const mapBase = computed(() => (baseGrid.value && plotRange.value ? decisionChart(palette.value, baseGrid.value, 64, plotRange.value, classes.value, s.value.samples, s.value.labels, null, sel.value) : null));
const mapVar = computed(() => (varGrid.value && plotRange.value ? decisionChart(palette.value, varGrid.value, 64, plotRange.value, classes.value, s.value.samples, s.value.labels, baseGrid.value, sel.value) : null));
const changedCells = computed(() => {
  if (!baseGrid.value || !varGrid.value) return 0;
  let n = 0;
  for (let i = 0; i < baseGrid.value.length; i++) if (baseGrid.value[i] !== varGrid.value[i]) n++;
  return n / baseGrid.value.length;
});
const classNames = computed(() => Array.from({ length: classes.value }, (_, k) => s.value.network.outputNames?.[k] ?? `class ${k}`));

// ------------------------------------------------------------ samples & input editing
const sample = computed(() => s.value.samples[sel.value] ?? []);
function step(d: number) {
  const n = s.value.samples.length;
  s.value.selectedSample = (sel.value + d + n) % n;
}
const sampleIdx = computed({ get: () => sel.value, set: (v: number) => (s.value.selectedSample = Math.max(0, Math.min(s.value.samples.length - 1, Math.round(v)))) });
function setInput(i: number, v: number) {
  const row = [...sample.value];
  row[i] = v;
  s.value.samples[sel.value] = row;
}
function addSample() {
  if (s.value.samples.length >= 2000) return;
  s.value.samples.push([...sample.value]);
  if (s.value.labels) s.value.labels.push(s.value.labels[sel.value] ?? 0);
  s.value.selectedSample = s.value.samples.length - 1;
}
const isImage = computed(() => !!preset.value?.image && s.value.network.inputSize === 64);
const flips = computed(() => activeSummary.value?.flips ?? []);

// ------------------------------------------------------------ selection / unit inspector
function onSelect(x: { layer: number; unit: number | null; input: number | null }) {
  s.value.selection = x;
}
const unitInfo = computed(() => {
  const selection = s.value.selection;
  const e = ev.value;
  if (!selection || selection.unit === null || !e?.baselineTrace) return null;
  const l = selection.layer;
  const j = selection.unit;
  const layer = s.value.network.layers[l];
  if (!layer || j >= layer.units) return null;
  const fanIn = l === 0 ? s.value.network.inputSize : s.value.network.layers[l - 1]!.units;
  const wq = activePrepared.value?.weights[l];
  const bt = e.baselineTrace.layers[l]!;
  const vt = activeTrace.value?.layers[l] ?? null;
  const rows = Array.from({ length: fanIn }, (_, i) => {
    const w = layer.weights[j * fanIn + i]!;
    const q = wq ? wq[j * fanIn + i]! : w;
    return { i, w, q, x: bt.input[i]!, xq: vt ? vt.inputUsed[i]! : bt.input[i]!, contrib: w * bt.input[i]!, contribQ: q * (vt ? vt.inputUsed[i]! : bt.input[i]!) };
  });
  rows.sort((a, b) => Math.abs(b.contrib) - Math.abs(a.contrib));
  const name = l === s.value.network.layers.length - 1 ? (s.value.network.outputNames?.[j] ?? `output ${j}`) : `hidden layer ${l + 1}, unit ${j}`;
  return {
    name,
    activation: layer.activation,
    bias: layer.bias[j]!,
    baseZ: bt.preact[j]!,
    baseA: bt.output[j]!,
    varZ: vt?.preact[j] ?? null,
    varA: vt?.output[j] ?? null,
    rows: rows.slice(0, 64),
    total: fanIn,
    weightParams: activePrepared.value?.weightResults[l]?.params ?? null,
  };
});

// ------------------------------------------------------------ architecture editing
interface ArchLayer {
  units: number;
  activation: Activation;
}
const arch = ref<ArchLayer[]>([]);
const archSeed = ref(1);
const archOutput = ref<NetworkDef['output']>('softmax');
function loadArch() {
  arch.value = s.value.network.layers.map((l) => ({ units: l.units, activation: l.activation }));
  archOutput.value = s.value.network.output;
}
watch(() => s.value.network, loadArch, { immediate: true });
const archIssues = computed(() => {
  const out: { severity: 'error'; message: string }[] = [];
  if (arch.value.length < 1 || arch.value.length > MAX_LAYERS) out.push({ severity: 'error', message: `Use between 1 and ${MAX_LAYERS} layers.` });
  arch.value.forEach((l, i) => {
    if (!Number.isInteger(l.units) || l.units < 1 || l.units > MAX_UNITS) out.push({ severity: 'error', message: `Layer ${i + 1}: 1–${MAX_UNITS} units.` });
  });
  if (archOutput.value === 'softmax' && (arch.value.at(-1)?.units ?? 0) < 2) out.push({ severity: 'error', message: 'Softmax output needs at least 2 output units.' });
  return out;
});
function addLayer() {
  if (arch.value.length < MAX_LAYERS) arch.value.splice(Math.max(0, arch.value.length - 1), 0, { units: 8, activation: 'relu' });
}
function removeLayer(i: number) {
  if (arch.value.length > 1) arch.value.splice(i, 1);
}
function rebuild() {
  if (archIssues.value.length) return;
  const rng = new Rng(archSeed.value);
  const net = initNetwork(s.value.network.inputSize, arch.value.map((l) => l.units), arch.value.map((l) => l.activation), archOutput.value, rng, new NormalSampler(rng.fork(1)));
  net.inputNames = s.value.network.inputNames;
  lab.state.network = {
    ...s.value,
    presetId: null,
    network: net,
    variants: defaultNetworkVariants(net),
    activeVariantId: 'n1',
    selection: null,
  };
  scenarioId.value = '';
}
const actOptions = ACTIVATIONS.map((a) => ({ value: a.id, label: a.name, title: a.formula }));

// weight editing for a layer
const editLayer = ref(0);
const weightText = ref('');
const weightErrors = ref<string[]>([]);
function loadWeights() {
  const l = s.value.network.layers[editLayer.value];
  if (!l) return;
  const fanIn = l.weights.length / l.units;
  const lines: string[] = [];
  for (let j = 0; j < l.units; j++) lines.push([...l.weights.slice(j * fanIn, (j + 1) * fanIn), '|', l.bias[j]].join(', '));
  weightText.value = lines.join('\n');
}
watch([editLayer, () => s.value.network], loadWeights, { immediate: true });
function applyWeights() {
  const l = s.value.network.layers[editLayer.value]!;
  const fanIn = l.weights.length / l.units;
  try {
    const t = parseDelimited(weightText.value.replace(/,?\s*\|\s*,?/g, ', '));
    if (t.rows !== l.units || t.cols !== fanIn + 1) throw new DataParseError([`Expected ${l.units} rows of ${fanIn} weights followed by "| bias" (got ${t.rows}×${t.cols}).`]);
    if (t.values.some((v) => !Number.isFinite(v))) throw new DataParseError(['Weights and biases must be finite.']);
    const weights: number[] = [];
    const bias: number[] = [];
    for (let j = 0; j < t.rows; j++) {
      weights.push(...t.values.slice(j * t.cols, j * t.cols + fanIn));
      bias.push(t.values[j * t.cols + fanIn]!);
    }
    s.value.network.layers[editLayer.value] = { ...l, weights, bias };
    s.value.presetId = null;
    weightErrors.value = [];
  } catch (e) {
    weightErrors.value = e instanceof DataParseError ? e.problems : [(e as Error).message];
  }
}
</script>

<template>
  <div class="lab-layout">
    <aside class="lab-side" aria-label="Neural Network Laboratory controls">
      <div class="lab-side-head">
        <h1>Neural Network Laboratory</h1>
        <p>How does it affect a network's predictions?</p>
      </div>
      <Section title="Network">
        <SelectField
          v-model="scenarioModel"
          label="Curated scenario"
          :options="[{ value: '', label: 'Choose a scenario…', disabled: true }, ...NETWORK_SCENARIOS.map((x) => ({ value: x.id, label: x.title, title: x.description }))]"
          test-id="nn-scenario"
        />
        <div v-if="scenario" class="callout small">
          <span>{{ scenario.description }}<br /><strong>Look for:</strong> {{ scenario.lookFor }}</span>
        </div>
        <SelectField v-model="presetModel" label="Network" :options="[{ value: '', label: 'Custom network', disabled: true }, ...NETWORK_PRESETS.map((p) => ({ value: p.id, label: p.name, title: p.description }))]" test-id="nn-preset" />
        <p v-if="preset" class="field-hint">{{ preset.description }} <br /><em>{{ preset.provenance }}</em></p>
      </Section>
      <Section title="Quantized variants">
        <ul class="vlist">
          <li v-for="v in s.variants" :key="v.id" class="vitem" :class="{ active: v.id === s.activeVariantId }" @click="s.activeVariantId = v.id">
            <input type="radio" name="nn-active-variant" :checked="v.id === s.activeVariantId" :aria-label="`Edit ${v.name}`" @change="s.activeVariantId = v.id" @click.stop />
            <span class="swatch" :style="{ background: `var(--series-${variantSlot(v.id) + 1})` }" />
            <input class="vname" :value="v.name" :aria-label="`Name of variant ${v.id}`" @change="v.name = ($event.target as HTMLInputElement).value.trim().slice(0, 80) || v.name" @click.stop />
            <input v-model="v.enabled" type="checkbox" :aria-label="`Include ${v.name}`" @click.stop />
            <button type="button" class="btn btn-ghost btn-sm" :disabled="s.variants.length <= 1" :aria-label="`Remove ${v.name}`" @click.stop="removeVariant(v.id)"><Icon name="trash" :size="14" /></button>
          </li>
        </ul>
        <button type="button" class="btn btn-sm" :disabled="s.variants.length >= 6" @click="addVariant"><Icon name="plus" :size="14" /> Duplicate selected variant</button>
      </Section>
      <Section :title="`Settings: ${activeVariant.name}`">
        <LayerQuantEditor :key="`${activeVariant.id}-${s.network.layers.length}`" v-model="activeVariant" :net="s.network" />
      </Section>
      <Section title="Architecture & parameters" :initially-open="false">
        <p class="field-hint">Inputs: {{ s.network.inputSize }}. Changing the architecture re-initialises all weights from a seed (no training happens in this application).</p>
        <div v-for="(l, i) in arch" :key="i" class="arch-row">
          <span class="small">{{ i === arch.length - 1 ? 'Output' : `Layer ${i + 1}` }}</span>
          <NumberField v-model="l.units" label="Units" :min="1" :max="MAX_UNITS" integer compact />
          <SelectField v-model="l.activation" label="Activation" :options="actOptions" />
          <button type="button" class="btn btn-ghost btn-sm" :disabled="arch.length <= 1" :aria-label="`Remove layer ${i + 1}`" @click="removeLayer(i)"><Icon name="trash" :size="14" /></button>
        </div>
        <div class="row">
          <button type="button" class="btn btn-sm" :disabled="arch.length >= MAX_LAYERS" @click="addLayer"><Icon name="plus" :size="14" /> Hidden layer</button>
          <SelectField v-model="archOutput" label="Output" :options="[{ value: 'softmax', label: 'Softmax' }, { value: 'sigmoid', label: 'Sigmoid' }, { value: 'identity', label: 'Identity' }]" />
        </div>
        <NumberField v-model="archSeed" label="Initialisation seed" :min="0" :max="4294967295" integer />
        <IssueList :issues="archIssues" />
        <button type="button" class="btn btn-primary btn-sm" :disabled="archIssues.length > 0" data-testid="nn-rebuild" @click="rebuild">Rebuild with seeded random weights</button>
        <hr />
        <SelectField v-model="editLayer" label="Edit weights of layer" :options="s.network.layers.map((_, i) => ({ value: i, label: `Layer ${i + 1}` }))" />
        <textarea v-model="weightText" class="input num" rows="6" spellcheck="false" aria-label="Weights: one row per unit, inputs then | bias" data-testid="nn-weights" />
        <span class="field-hint">One row per unit: its input weights, then "|" and the bias.</span>
        <button type="button" class="btn btn-sm" data-testid="nn-apply-weights" @click="applyWeights">Apply weights</button>
        <ul v-if="weightErrors.length" class="errs"><li v-for="e in weightErrors" :key="e">{{ e }}</li></ul>
      </Section>
    </aside>

    <div class="lab-content">
      <IssueList :issues="[...(ev?.issues ?? []).map((m) => ({ severity: 'error' as const, message: m })), ...variantErrors]" />
      <p v-if="error" class="callout callout-critical">{{ error }}</p>

      <div class="card">
        <div class="card-header">
          <h2>Predictions on {{ s.samples.length > EVAL_SAMPLE_LIMIT ? `the first ${EVAL_SAMPLE_LIMIT} of ${s.samples.length}` : s.samples.length }} samples <span v-if="computing" class="badge" role="status">computing…</span></h2>
          <span class="muted small">Baseline = FP64 weights, activations and arithmetic.</span>
        </div>
        <div class="card-body table-wrap">
          <table class="table" data-testid="nn-summary">
            <thead>
              <tr>
                <th>Model</th>
                <th v-if="s.labels" class="num">Accuracy</th>
                <th class="num">Agreement with baseline <InfoTip text="Fraction of samples whose predicted class (arg max of the output) equals the baseline's." /></th>
                <th class="num">Changed predictions</th>
                <th class="num">Mean |Δ output|</th>
                <th class="num">Max |Δ output|</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row"><span class="sw" style="background: var(--chart-neutral)" />Baseline (FP64)</th>
                <td v-if="s.labels" class="num">{{ pct(ev?.baselineAccuracy ?? null, 1) }}</td>
                <td class="num">—</td><td class="num">—</td><td class="num">—</td><td class="num">—</td>
              </tr>
              <tr v-for="x in summaries" :key="x.id" :class="{ selected: x.id === s.activeVariantId }" style="cursor: pointer" @click="s.activeVariantId = x.id">
                <th scope="row">
                  <button type="button" class="row-select" :aria-pressed="x.id === s.activeVariantId" :title="`Edit ${x.name}`" @click.stop="s.activeVariantId = x.id"><span class="sw" :style="{ background: `var(--series-${x.slot + 1})` }" />{{ x.name }}</button>
                </th>
                <td v-if="s.labels" class="num">{{ pct(x.accuracy, 1) }}</td>
                <td class="num" data-metric="agreement">{{ pct(x.agreement, 1) }}</td>
                <td class="num">{{ x.flips.length }}</td>
                <td class="num">{{ fmt(x.meanAbsOutputDiff, 4) }}</td>
                <td class="num">{{ fmt(x.maxAbsOutputDiff, 4) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div v-if="s.showBoundary && plotRange" class="grid-2">
        <ChartCard v-if="baseGrid && plotRange" title="Decision regions — baseline (FP64)" caption="Shaded: predicted class over the input plane. Dots: samples coloured by their label. Click a dot to select it." :columns="mapBase!.columns" :rows="mapBase!.rows" test-id="nn-map-base">
          <DecisionMap :grid="baseGrid" :size="64" :range="plotRange" :samples="s.samples" :labels="s.labels" :compare-to="null" :selected="sel" :class-names="classNames" label="Decision regions of the baseline network" @select="s.selectedSample = $event" />
        </ChartCard>
        <ChartCard v-if="varGrid && baseGrid && plotRange" :title="`Decision regions — ${activeVariant.name}`" :caption="`Dark cells: the predicted class differs from the baseline (${pct(changedCells, 1)} of the plane).`" :columns="mapVar!.columns" :rows="mapVar!.rows" test-id="nn-map-var">
          <DecisionMap :grid="varGrid" :size="64" :range="plotRange" :samples="s.samples" :labels="s.labels" :compare-to="baseGrid" :selected="sel" :class-names="classNames" label="Decision regions of the quantized network with changed cells marked" @select="s.selectedSample = $event" />
        </ChartCard>
      </div>

      <div class="card">
        <div class="card-header">
          <h2>Network <span class="muted small">— click a neuron to inspect it; fill shows how much {{ activeVariant.name }} changes its output for the selected input</span></h2>
        </div>
        <div class="card-body">
          <NetworkDiagram :net="s.network" :weights="activePrepared?.weights ?? null" :base="ev?.baselineTrace ?? null" :variant="activeTrace" :selection="s.selection" @select="onSelect" />
        </div>
      </div>

      <div class="grid-2">
        <div class="card">
          <div class="card-header">
            <h2>Input sample</h2>
            <div class="row">
              <button type="button" class="btn btn-sm btn-ghost" aria-label="Previous sample" @click="step(-1)"><Icon name="chevronLeft" :size="14" /></button>
              <NumberField v-model="sampleIdx" label="Sample #" :min="0" :max="s.samples.length - 1" integer compact />
              <button type="button" class="btn btn-sm btn-ghost" aria-label="Next sample" @click="step(1)"><Icon name="chevronRight" :size="14" /></button>
            </div>
          </div>
          <div class="card-body stack">
            <p class="small">
              <template v-if="s.labels">Label: <strong>{{ s.network.outputNames?.[s.labels[sel]!] ?? s.labels[sel] }}</strong> · </template>
              Baseline predicts <strong>{{ s.network.outputNames?.[ev?.baselineTrace?.prediction ?? 0] ?? ev?.baselineTrace?.prediction }}</strong>
              <template v-if="activeTrace"> · {{ activeVariant.name }} predicts <strong :class="{ flip: activeTrace.prediction !== ev?.baselineTrace?.prediction }">{{ s.network.outputNames?.[activeTrace.prediction] ?? activeTrace.prediction }}</strong></template>
            </p>
            <div v-if="isImage" class="digit" role="img" :aria-label="`8 by 8 input image for sample ${sel}`">
              <span v-for="(v, i) in sample" :key="i" :style="{ background: `color-mix(in srgb, var(--text) ${Math.round(Math.max(0, Math.min(1, v)) * 100)}%, var(--surface))` }" />
            </div>
            <div v-else-if="s.network.inputSize <= 8" class="field-row">
              <NumberField v-for="(v, i) in sample" :key="`${sel}-${i}`" :model-value="v" :label="s.network.inputNames?.[i] ?? `x${i}`" @update:model-value="setInput(i, $event)" />
            </div>
            <button v-if="s.network.inputSize <= 8" type="button" class="btn btn-sm" @click="addSample"><Icon name="plus" :size="14" /> Add as new sample</button>
            <div v-if="flips.length" class="small">
              <span class="muted">Samples whose prediction {{ activeVariant.name }} changes:</span>
              <div class="chips">
                <button v-for="f in flips.slice(0, 40)" :key="f" type="button" class="chip" :class="{ on: f === sel }" @click="s.selectedSample = f">#{{ f }}</button>
                <span v-if="flips.length > 40" class="muted">+{{ flips.length - 40 }} more</span>
              </div>
            </div>
            <p v-else-if="activeSummary" class="small muted">{{ activeVariant.name }} changes no predictions on these samples.</p>
          </div>
        </div>
        <ChartCard v-if="outputs" :title="`Outputs for sample #${sel}`" :caption="s.network.output === 'softmax' ? 'Softmax probabilities of the baseline and each variant.' : 'Network outputs of the baseline and each variant.'" :columns="outputs.columns" :rows="outputs.rows" test-id="nn-outputs">
          <EChart :option="outputs.option" label="Output values of baseline and variants for the selected sample" />
        </ChartCard>
      </div>

      <div class="grid-2">
        <ChartCard v-if="propagation" title="Error propagation through the layers" caption="Mean relative difference between each layer's output and the baseline's, over all samples (log scale)." :columns="propagation.columns" :rows="propagation.rows" test-id="nn-propagation">
          <EChart :option="propagation.option" label="Relative error per layer for each variant" />
        </ChartCard>
        <div class="card">
          <div class="card-header"><h2>Selected neuron</h2></div>
          <div v-if="unitInfo" class="card-body stack" data-testid="nn-unit">
            <p class="small"><strong>{{ unitInfo.name }}</strong> · activation {{ unitInfo.activation }} · bias {{ fmt(unitInfo.bias, 6) }}</p>
            <div class="stat-grid">
              <div class="stat"><div class="stat-label">Pre-activation z (baseline)</div><div class="stat-value">{{ fmt(unitInfo.baseZ, 7) }}</div></div>
              <div class="stat"><div class="stat-label">z ({{ activeVariant.name }})</div><div class="stat-value">{{ fmt(unitInfo.varZ, 7) }}</div></div>
              <div class="stat"><div class="stat-label">Output (baseline)</div><div class="stat-value">{{ fmt(unitInfo.baseA, 7) }}</div></div>
              <div class="stat"><div class="stat-label">Output ({{ activeVariant.name }})</div><div class="stat-value">{{ fmt(unitInfo.varA, 7) }}</div></div>
            </div>
            <div class="table-wrap unit-table">
              <table class="table">
                <caption class="small muted" style="caption-side: top; text-align: left">Incoming connections sorted by |w·x| ({{ unitInfo.rows.length }} of {{ unitInfo.total }})</caption>
                <thead><tr><th>Input</th><th class="num">w</th><th class="num">w (quantized)</th><th class="num">x</th><th class="num">x (used)</th><th class="num">w·x</th><th class="num">w̃·x̃</th></tr></thead>
                <tbody>
                  <tr v-for="r in unitInfo.rows" :key="r.i">
                    <td>{{ r.i }}</td>
                    <td class="num">{{ fmt(r.w, 6) }}</td>
                    <td class="num">{{ fmt(r.q, 6) }}</td>
                    <td class="num">{{ fmt(r.x, 6) }}</td>
                    <td class="num">{{ fmt(r.xq, 6) }}</td>
                    <td class="num">{{ fmt(r.contrib, 5) }}</td>
                    <td class="num">{{ fmt(r.contribQ, 5) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <div v-else class="card-body muted small">Click a hidden or output neuron in the diagram to see its pre-activation, output and incoming weights (original vs quantized).</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.vlist {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.vitem {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 4px 3px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  cursor: pointer;
}
.vitem.active {
  border-color: var(--accent);
  background: var(--accent-softer);
  box-shadow: inset 3px 0 0 var(--accent);
}
.swatch,
.sw {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 3px;
  margin-right: 4px;
  flex: none;
}
.vname {
  flex: 1;
  min-width: 0;
  border: 1px solid transparent;
  background: transparent;
  font-size: 12.5px;
  padding: 2px 4px;
  border-radius: 4px;
}
.vname:focus,
.vname:hover {
  border-color: var(--border-strong);
}
.arch-row {
  display: grid;
  grid-template-columns: 52px 70px 1fr auto;
  gap: 6px;
  align-items: end;
}
.digit {
  display: grid;
  grid-template-columns: repeat(8, 22px);
  gap: 1px;
  background: var(--border);
  width: max-content;
  border: 1px solid var(--border);
}
.digit span {
  width: 22px;
  height: 22px;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}
.chip {
  border: 1px solid var(--border-strong);
  background: var(--surface);
  border-radius: 999px;
  padding: 1px 8px;
  font-size: 11.5px;
  cursor: pointer;
}
.chip.on {
  background: var(--accent-soft);
  border-color: var(--accent);
}
.flip {
  color: var(--critical);
}
.unit-table {
  max-height: 300px;
}
.errs {
  margin: 0;
  padding-left: 16px;
  color: var(--critical);
  font-size: 12px;
}
hr {
  border: none;
  border-top: 1px solid var(--border);
  margin: 4px 0;
  width: 100%;
}
</style>
