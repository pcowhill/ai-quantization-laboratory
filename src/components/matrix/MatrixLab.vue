<script setup lang="ts">
import { computed, ref } from 'vue';
import { makeQuantConfig } from '@/engine/quant/types';
import { FLOAT_FORMATS } from '@/engine/formats/registry';
import { conformOperands, errorSplit, evaluateMatrix, shapeIssues } from '@/labs/matrix';
import { MATRIX_PRESETS } from '@/data/matrixPresets';
import { flagLabels } from '@/labs/inspector';
import type { MatrixOp } from '@/state/schema';
import { useLabStore } from '@/stores/lab';
import { usePalette } from '@/ui/usePalette';
import { dotTraceChart, errorSplitChart } from '@/ui/charts/matrix';
import { db, fmt } from '@/ui/format';
import Section from '@/components/common/Section.vue';
import SelectField from '@/components/common/SelectField.vue';
import Segmented from '@/components/common/Segmented.vue';
import NumberField from '@/components/common/NumberField.vue';
import IssueList from '@/components/common/IssueList.vue';
import InfoTip from '@/components/common/InfoTip.vue';
import ChartCard from '@/components/charts/ChartCard.vue';
import EChart from '@/components/charts/EChart.vue';
import QuantConfigEditor from '@/components/workbench/QuantConfigEditor.vue';
import MatrixEditor from './MatrixEditor.vue';
import ArithConfigEditor from './ArithConfigEditor.vue';

const lab = useLabStore();
const m = computed(() => lab.state.matrix);
const palette = usePalette();
const ev = computed(() => evaluateMatrix(m.value));
const pendingShape = computed(() => shapeIssues(m.value.op, m.value.A, m.value.B));

const OPS: { value: MatrixOp; label: string }[] = [
  { value: 'add', label: 'A + B' },
  { value: 'scale', label: 'α·A' },
  { value: 'dot', label: 'a · b' },
  { value: 'matvec', label: 'A·x' },
  { value: 'matmul', label: 'A·B' },
];
const op = computed({
  get: () => m.value.op,
  set: (v: MatrixOp) => {
    m.value.op = v;
  },
});
function conform() {
  const r = conformOperands(m.value.op, m.value.A, m.value.B);
  m.value.A = r.A;
  m.value.B = r.B;
}

const presetModel = computed({
  get: () => m.value.presetId ?? '',
  set: (id: string) => {
    const p = MATRIX_PRESETS.find((x) => x.id === id);
    if (!p) return;
    Object.assign(m.value, { integerPath: false }, p.apply(), { presetId: id, selectedCell: [0, 0] });
  },
});
const presetOptions = [{ value: '', label: 'Choose an example…', disabled: true }, ...MATRIX_PRESETS.map((p) => ({ value: p.id, label: p.name, title: p.description }))];
const preset = computed(() => MATRIX_PRESETS.find((p) => p.id === m.value.presetId) ?? null);

const quantA = computed({ get: () => m.value.quantA !== null, set: (v: boolean) => (m.value.quantA = v ? makeQuantConfig({ format: 'int8', granularity: 'channel', axis: 0 }) : null) });
const quantB = computed({ get: () => m.value.quantB !== null, set: (v: boolean) => (m.value.quantB = v ? makeQuantConfig({ format: 'int8', granularity: 'channel', axis: 1 }) : null) });
const cfgA = computed({ get: () => m.value.quantA!, set: (c) => (m.value.quantA = c) });
const cfgB = computed({ get: () => m.value.quantB!, set: (c) => (m.value.quantB = c) });

const usesReduction = computed(() => m.value.op === 'dot' || m.value.op === 'matvec' || m.value.op === 'matmul');
const selectedIndex = computed(() => m.value.selectedCell[0] * ev.value.outCols + m.value.selectedCell[1]);
const split = computed(() => (ev.value.simulated.length > selectedIndex.value ? errorSplit(ev.value, selectedIndex.value) : null));
const splitChart = computed(() => (ev.value.simulated.length ? errorSplitChart(palette.value, ev.value) : null));
const traceChart = computed(() => (ev.value.trace ? dotTraceChart(palette.value, ev.value.trace) : null));
const showAllSteps = ref(false);
const traceSteps = computed(() => {
  const st = ev.value.trace?.steps ?? [];
  return showAllSteps.value || st.length <= 40 ? st : st.slice(0, 20).concat(st.slice(-20));
});

function selectCell(k: number) {
  m.value.selectedCell = [Math.floor(k / ev.value.outCols), k % ev.value.outCols];
}
function onSplitClick(p: { dataIndex: number }) {
  selectCell(p.dataIndex);
}

const stageText = computed(() => {
  const a = m.value.arith;
  const f = (id: keyof typeof FLOAT_FORMATS) => FLOAT_FORMATS[id].name;
  return [
    { k: '1', t: 'Storage', d: `A: ${m.value.quantA ? m.value.quantA.format.toUpperCase() : 'FP64 (unchanged)'}${m.value.op !== 'scale' ? ` · B: ${m.value.quantB ? m.value.quantB.format.toUpperCase() : 'FP64 (unchanged)'}` : ''}` },
    { k: '2', t: 'Products', d: `each a·b rounded to ${f(a.productFormat)}` },
    { k: '3', t: 'Accumulation', d: `${a.order} sums in ${f(a.accumulatorFormat)}${a.order === 'blocked' ? `, blocks of ${a.blockSize} promoted to ${f(a.outerFormat)}` : ''}` },
    { k: '4', t: 'Output', d: `rounded to ${f(a.outputFormat)}; compared with the exact result in FP64` },
  ];
});
const outCells = computed(() => Array.from({ length: Math.min(ev.value.simulated.length, 400) }, (_, k) => k));
</script>

<template>
  <div class="lab-layout">
    <aside class="lab-side" aria-label="Matrix Laboratory controls">
      <div class="lab-side-head">
        <h1>Matrix Laboratory</h1>
        <p>How does that error affect matrix multiplication?</p>
      </div>
      <Section title="Operation">
        <Segmented v-model="op" label="Operation" :options="OPS" />
        <SelectField v-model="presetModel" label="Example" :options="presetOptions" test-id="matrix-preset" />
        <p v-if="preset" class="callout small">{{ preset.description }}</p>
        <div v-if="pendingShape.length" class="stack">
          <IssueList :issues="pendingShape" />
          <button type="button" class="btn btn-sm" @click="conform">Reshape B (and A) to fit {{ OPS.find((o) => o.value === m.op)?.label }}</button>
        </div>
      </Section>
      <Section title="Operands">
        <MatrixEditor v-model="m.A" name="A" />
        <NumberField v-if="m.op === 'scale'" v-model="m.scalar" label="Scalar α" />
        <MatrixEditor v-else v-model="m.B" name="B" />
      </Section>
      <Section title="1 · Operand storage">
        <label class="check"><input v-model="quantA" type="checkbox" data-testid="quant-a" /> Quantize A</label>
        <QuantConfigEditor v-if="m.quantA" v-model="cfgA" :shape="[m.A.rows, m.A.cols]" id-prefix="qa" :show-presets="false" />
        <template v-if="m.op !== 'scale'">
          <label class="check"><input v-model="quantB" type="checkbox" data-testid="quant-b" /> Quantize B</label>
          <QuantConfigEditor v-if="m.quantB" v-model="cfgB" :shape="[m.B.rows, m.B.cols]" id-prefix="qb" :show-presets="false" />
        </template>
      </Section>
      <Section title="2–4 · Arithmetic">
        <ArithConfigEditor v-model="m.arith" />
      </Section>
      <Section v-if="m.op === 'matmul' || m.op === 'matvec' || m.op === 'dot'" title="Integer kernel path" :initially-open="m.integerPath">
        <label class="check"><input v-model="m.integerPath" type="checkbox" data-testid="integer-path" /> Compute with integer products and an INT32 accumulator</label>
        <SelectField
          v-if="m.integerPath"
          v-model="m.intAccumulator"
          label="INT32 accumulator overflow"
          :options="[
            { value: 'int32-wrap', label: 'Wrap around (two\'s complement)' },
            { value: 'int32-saturate', label: 'Saturate at ±2³¹' },
            { value: 'exact', label: 'Exact (no overflow, for reference)' },
          ]"
        />
        <p class="field-hint">C = Σ s_A·s_B·Σ(q_A − z_A)(q_B − z_B), rescaled and accumulated in the accumulator format. Needs A scaled per tensor/row/row-groups and B per tensor/column/column-groups.</p>
      </Section>
    </aside>

    <div class="lab-content">
      <div class="stages" aria-label="Computation stages">
        <div v-for="s in stageText" :key="s.k" class="stage">
          <span class="stage-k">{{ s.k }}</span>
          <div>
            <div class="stage-t">{{ s.t }}</div>
            <div class="stage-d">{{ s.d }}</div>
          </div>
        </div>
      </div>

      <IssueList :issues="ev.issues" />

      <template v-if="ev.simulated.length">
        <div class="stat-grid">
          <div class="stat"><div class="stat-label">Max |error| vs exact</div><div class="stat-value" data-testid="matrix-max-error">{{ fmt(ev.metrics.maxAbs, 4) }}</div></div>
          <div class="stat"><div class="stat-label">RMSE</div><div class="stat-value">{{ fmt(ev.metrics.rmse, 4) }}</div></div>
          <div class="stat"><div class="stat-label">Mean relative error <InfoTip text="Relative to the exact result of the original operands; entries whose exact value is 0 are excluded unless the result is also 0." /></div><div class="stat-value">{{ fmt(ev.metrics.meanRelative, 4) }}</div></div>
          <div class="stat"><div class="stat-label">SNR</div><div class="stat-value">{{ db(ev.metrics.snrDb) }}</div></div>
          <div class="stat"><div class="stat-label">Cosine similarity</div><div class="stat-value">{{ ev.metrics.cosine === null ? '—' : ev.metrics.cosine.toFixed(8) }}</div></div>
          <div class="stat"><div class="stat-label">Arithmetic flags</div><div class="stat-value small">{{ flagLabels(ev.flags).join(', ') || 'none' }}</div></div>
        </div>

        <div class="card">
          <div class="card-header">
            <h2>Results <span class="muted small">— click a row to trace it</span></h2>
          </div>
          <div class="card-body table-wrap results">
            <table class="table" data-testid="matrix-results">
              <thead>
                <tr>
                  <th>Entry</th>
                  <th class="num">FP64 baseline <InfoTip text="Ordinary FP64 arithmetic on the original operands." /></th>
                  <th class="num">Exact (original) <InfoTip text="Mathematically exact result for the original operands, rounded once to FP64." /></th>
                  <th class="num">Exact (stored) <InfoTip text="Exact result for the quantized (stored) operands: what perfect arithmetic would give after storage." /></th>
                  <th class="num">Simulated</th>
                  <th v-if="ev.integer" class="num">Integer kernel</th>
                  <th class="num">Storage error</th>
                  <th class="num">Arithmetic error</th>
                  <th class="num">Total error</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="k in outCells" :key="k" :class="{ selected: usesReduction && k === selectedIndex }" :style="usesReduction ? 'cursor:pointer' : ''" @click="usesReduction && selectCell(k)">
                  <th scope="row">{{ ev.outRows > 1 || ev.outCols > 1 ? `[${Math.floor(k / ev.outCols)}, ${k % ev.outCols}]` : `[${k}]` }}</th>
                  <td class="num">{{ fmt(ev.baseline[k], 10) }}</td>
                  <td class="num">{{ fmt(ev.exactOriginal[k], 10) }}</td>
                  <td class="num">{{ fmt(ev.exactStored[k], 10) }}</td>
                  <td class="num strong">{{ fmt(ev.simulated[k], 10) }}</td>
                  <td v-if="ev.integer" class="num">{{ fmt(ev.integer[k], 10) }}</td>
                  <td class="num">{{ fmt(errorSplit(ev, k).storage, 3) }}</td>
                  <td class="num">{{ fmt(errorSplit(ev, k).arithmetic, 3) }}</td>
                  <td class="num">{{ fmt(errorSplit(ev, k).total, 3) }}</td>
                </tr>
              </tbody>
            </table>
            <p v-if="ev.simulated.length > outCells.length" class="muted small">Showing {{ outCells.length }} of {{ ev.simulated.length }} entries.</p>
          </div>
          <div v-if="m.integerPath" class="card-body">
            <p v-if="ev.integerUnsupported" class="callout callout-warning">Integer path unavailable: {{ ev.integerUnsupported }}</p>
            <p v-else-if="ev.integerInfo" class="small">
              Integer path: {{ ev.integerInfo.segments }} rescaled segments; largest |integer partial sum| {{ ev.integerInfo.maxAbsPartial.toLocaleString() }}
              <template v-if="ev.integerInfo.int32Overflows"> · <span class="badge badge-critical">{{ ev.integerInfo.int32Overflows }} entries overflowed INT32</span></template>
              <template v-else> (INT32 limit 2,147,483,647).</template>
            </p>
          </div>
        </div>

        <div class="grid-2">
          <ChartCard v-if="splitChart" title="Where the error comes from" caption="Storage error = exact(stored) − exact(original). Arithmetic error = simulated − exact(stored). They add up to the total error." :columns="splitChart.columns" :rows="splitChart.rows" test-id="chart-split">
            <EChart :option="splitChart.option" label="Stacked bar chart of storage and arithmetic error per output entry" @point-click="onSplitClick" />
          </ChartCard>
          <ChartCard v-if="traceChart && ev.trace" :title="`Dot-product trace for entry [${m.selectedCell[0]}, ${m.selectedCell[1]}]`" caption="How the rounded running sum drifts away from the exact running sum, step by step." :columns="traceChart.columns" :rows="traceChart.rows" test-id="chart-trace">
            <EChart :option="traceChart.option" label="Running sum of the simulated accumulator and the exact running sum" />
          </ChartCard>
        </div>

        <div v-if="ev.trace && ev.trace.steps" class="card">
          <div class="card-header">
            <h2>Step-by-step: entry [{{ m.selectedCell[0] }}, {{ m.selectedCell[1] }}] <span class="muted small">({{ m.arith.order }} order)</span></h2>
            <label v-if="ev.trace.steps.length > 40" class="check small"><input v-model="showAllSteps" type="checkbox" /> Show all {{ ev.trace.steps.length }} steps</label>
          </div>
          <div class="card-body table-wrap trace">
            <p v-if="m.arith.order === 'pairwise' || m.arith.order === 'kahan'" class="callout small">The table lists products in input order; with {{ m.arith.order }} summation the partial sums are combined differently, so only the final value and per-product rounding are shown.</p>
            <table class="table" data-testid="dot-trace">
              <thead>
                <tr><th>k</th><th class="num">a_k (stored)</th><th class="num">b_k (stored)</th><th class="num">a·b exact</th><th class="num">rounded product</th><th class="num">accumulator before</th><th class="num">accumulator after</th><th class="num">rounding error this step</th><th class="num">exact running sum</th></tr>
              </thead>
              <tbody>
                <tr v-for="s in traceSteps" :key="s.index">
                  <td>{{ s.index }}</td>
                  <td class="num">{{ fmt(s.a, 8) }}</td>
                  <td class="num">{{ fmt(s.b, 8) }}</td>
                  <td class="num">{{ fmt(s.productExact, 8) }}</td>
                  <td class="num">{{ fmt(s.product, 8) }}</td>
                  <td class="num">{{ fmt(s.accBefore, 8) }}</td>
                  <td class="num">{{ fmt(s.accAfter, 8) }}</td>
                  <td class="num" :class="{ hot: s.stepError !== 0 }">{{ fmt(s.stepError, 3) }}</td>
                  <td class="num">{{ fmt(s.exactRunning, 10) }}</td>
                </tr>
              </tbody>
            </table>
            <p class="small">Final simulated value <strong class="num">{{ fmt(ev.trace.value, 12) }}</strong> vs exact <strong class="num">{{ fmt(ev.trace.exact, 12) }}</strong> for the stored operands<template v-if="split">; storage contributed {{ fmt(split.storage, 4) }} and arithmetic {{ fmt(split.arithmetic, 4) }}</template>.</p>
          </div>
        </div>
      </template>

      <div class="card">
        <div class="card-header"><h2>Storage vs computation</h2></div>
        <div class="card-body prose grid-2">
          <div>
            <p><strong>1. Storing operands at reduced precision</strong> changes the numbers themselves before any arithmetic happens. Even perfect arithmetic on the stored values gives a different answer: the <em>storage error</em>.</p>
            <p><strong>2. Performing arithmetic at reduced precision</strong> rounds each product, and <strong>3. accumulating</strong> rounds each partial sum. Long sums in narrow accumulators lose small addends once the running sum is large.</p>
          </div>
          <div>
            <p><strong>4. Dequantizing for comparison</strong> maps the result back to real numbers so it can be compared with the exact answer. Integer kernels do this once at the end, after an exact (or INT32) integer accumulation.</p>
            <p>Real hardware fuses and reorders these steps in vendor-specific ways (e.g. tensor-core internal precision). This laboratory follows the explicit rules shown above and does not claim to match a specific GPU instruction.</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.stages {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}
.stage {
  display: flex;
  gap: 8px;
  padding: 9px 10px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
.stage-k {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--accent);
  color: var(--text-on-accent);
  font-size: 12px;
  font-weight: 700;
  flex: none;
}
.stage-t {
  font-weight: 600;
  font-size: 13px;
}
.stage-d {
  font-size: 12px;
  color: var(--text-2);
}
.results {
  max-height: 380px;
}
.trace {
  max-height: 460px;
}
td.strong {
  font-weight: 700;
}
td.hot {
  color: var(--serious);
}
@media (max-width: 1100px) {
  .stages {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
