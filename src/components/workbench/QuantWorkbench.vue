<script setup lang="ts">
import { computed, ref } from 'vue';
import { detectOutliers, OUTLIER_METHODS } from '@/engine/calibration/outliers';
import { summarize } from '@/engine/metrics/stats';
import { describeBlock } from '@/engine/quant/layout';
import { useWorkbenchEvaluation, variantSlot } from '@/composables/useWorkbench';
import { useLabStore } from '@/stores/lab';
import { usePalette } from '@/ui/usePalette';
import { bytes, fmt, plural } from '@/ui/format';
import {
  blockScalesChart,
  codeUsageChart,
  distributionChart,
  errorCdfChart,
  errorHistogramChart,
  heatmapChart,
  mseCurveChart,
  quantGridChart,
  transferChart,
  type SeriesInput,
} from '@/ui/charts/workbench';
import Section from '@/components/common/Section.vue';
import SelectField from '@/components/common/SelectField.vue';
import NumberField from '@/components/common/NumberField.vue';
import InfoTip from '@/components/common/InfoTip.vue';
import ChartCard from '@/components/charts/ChartCard.vue';
import EChart from '@/components/charts/EChart.vue';
import DataSourcePanel from './DataSourcePanel.vue';
import VariantList from './VariantList.vue';
import QuantConfigEditor from './QuantConfigEditor.vue';
import MetricsTable from './MetricsTable.vue';
import ElementInspector from './ElementInspector.vue';

const lab = useLabStore();
const w = computed(() => lab.state.workbench);
const palette = usePalette();
const { data, dataError, evaluations, computing, computeError } = useWorkbenchEvaluation(() => lab.state.workbench);

const activeVariant = computed(() => w.value.variants.find((v) => v.id === w.value.activeVariantId) ?? w.value.variants[0]!);
const activeConfig = computed({
  get: () => activeVariant.value.config,
  set: (c) => (activeVariant.value.config = c),
});

const summary = computed(() => (data.value ? summarize(data.value.data) : null));
const series = computed<SeriesInput[]>(() =>
  w.value.variants
    .filter((v) => v.enabled)
    .map((v) => {
      const e = evaluations.value.find((x) => x.id === v.id);
      return e?.result ? { id: v.id, name: v.name, slot: variantSlot(v.id), result: e.result } : null;
    })
    .filter((s): s is SeriesInput => s !== null),
);
const activeSeries = computed(() => series.value.find((s) => s.id === activeVariant.value.id) ?? null);
const activeEval = computed(() => evaluations.value.find((e) => e.id === activeVariant.value.id) ?? null);

const outliers = computed(() => (data.value ? detectOutliers(data.value.data, w.value.outlierMethod, w.value.outlierK) : null));
const showOutliers = ref(true);

const selected = computed({
  get: () => (w.value.selected !== null && data.value && w.value.selected < data.value.data.length ? w.value.selected : null),
  set: (v: number | null) => (w.value.selected = v),
});
const selectedBlock = computed(() => {
  const s = activeSeries.value;
  if (!s) return 0;
  return selected.value !== null ? s.result.layout.blockOf[selected.value]! : 0;
});

const distribution = computed(() => (data.value && series.value.length ? distributionChart(palette.value, data.value.data, series.value, w.value.histogramBins, w.value.logCounts) : null));
const transfer = computed(() => (activeSeries.value ? transferChart(palette.value, activeSeries.value, selected.value, showOutliers.value ? (outliers.value?.mask ?? null) : null) : null));
const errHist = computed(() => (series.value.length ? errorHistogramChart(palette.value, series.value, w.value.histogramBins) : null));
const cdfLog = ref(true);
const errCdf = computed(() => (series.value.length ? errorCdfChart(palette.value, series.value, cdfLog.value) : null));
const codes = computed(() => (activeSeries.value ? codeUsageChart(palette.value, activeSeries.value) : null));
const gridChart = computed(() => (activeSeries.value ? quantGridChart(palette.value, activeSeries.value, selectedBlock.value, Math.min(120, w.value.histogramBins * 2)) : null));
const isMatrix = computed(() => !!data.value && data.value.shape[0] > 1 && data.value.shape[1] > 1);
const heatOrig = computed(() => (data.value && isMatrix.value ? heatmapChart(palette.value, data.value.data, data.value.shape[0], data.value.shape[1], 'signed', 'original', selected.value) : null));
const absErr = computed(() => (activeSeries.value ? activeSeries.value.result.recon.map((y, i) => Math.abs(y - activeSeries.value!.result.original[i]!)) : null));
const heatErr = computed(() => (data.value && isMatrix.value && absErr.value ? heatmapChart(palette.value, absErr.value, data.value.shape[0], data.value.shape[1], 'magnitude', '|error|', selected.value) : null));
const scales = computed(() => (activeSeries.value && activeSeries.value.result.params.length > 1 ? blockScalesChart(palette.value, activeSeries.value) : null));
const mse = computed(() => (activeSeries.value ? mseCurveChart(palette.value, activeSeries.value, selectedBlock.value) : null));

function pick(payload: { data: unknown }) {
  const d = payload.data as number[] | { value?: number[] } | undefined;
  const arr = Array.isArray(d) ? d : d?.value;
  if (arr && arr.length >= 3) selected.value = arr[arr.length - 1]!;
}

const outlierOptions = OUTLIER_METHODS.map((m) => ({ value: m.id, label: m.name, title: m.description }));
const storage = computed(() => activeEval.value?.storage ?? null);
</script>

<template>
  <div class="lab-layout">
    <aside class="lab-side" aria-label="Quantization Workbench controls">
      <div class="lab-side-head">
        <h1>Quantization Workbench</h1>
        <p>What happens when I quantize it?</p>
      </div>
      <Section title="Data">
        <DataSourcePanel v-model="w.source" :catalog-id="w.datasetId" @catalog="w.datasetId = $event" />
        <div v-if="summary && data" class="summary small">
          <span class="badge">{{ data.shape[0] }}×{{ data.shape[1] }} = {{ data.data.length.toLocaleString() }} values</span>
          <span class="muted">min {{ fmt(summary.min, 4) }} · max {{ fmt(summary.max, 4) }} · mean {{ fmt(summary.mean, 4) }} · σ {{ fmt(summary.std, 4) }}</span>
          <span v-if="summary.nonFinite" class="badge badge-warning">{{ summary.nonFinite }} non-finite</span>
        </div>
        <p v-if="dataError" class="callout callout-critical">{{ dataError }}</p>
      </Section>
      <Section title="Variants to compare">
        <VariantList v-model="w.variants" v-model:active="w.activeVariantId" />
      </Section>
      <Section :title="`Settings: ${activeVariant.name}`">
        <QuantConfigEditor :key="activeVariant.id" v-model="activeConfig" :shape="data?.shape" id-prefix="wb" />
      </Section>
      <Section title="Outlier analysis" :initially-open="false">
        <SelectField v-model="w.outlierMethod" label="Method" :options="outlierOptions" />
        <NumberField v-model="w.outlierK" label="Threshold k" :min="0" />
        <label class="check"><input v-model="showOutliers" type="checkbox" /> Highlight outliers in the scatter plot</label>
        <div v-if="outliers" class="stat-grid">
          <div class="stat"><div class="stat-label">Outliers</div><div class="stat-value">{{ outliers.count }}</div><div class="stat-sub">{{ (outliers.fraction * 100).toFixed(2) }}% of values</div></div>
          <div class="stat"><div class="stat-label">Share of energy Σx²</div><div class="stat-value">{{ (outliers.energyShare * 100).toFixed(1) }}%</div></div>
          <div class="stat"><div class="stat-label">max|x| / median|x|</div><div class="stat-value">{{ fmt(outliers.maxToMedianRatio, 4) }}</div></div>
          <div class="stat"><div class="stat-label">Excess kurtosis</div><div class="stat-value">{{ fmt(outliers.kurtosis, 3) }}</div><div class="stat-sub">0 for a normal distribution</div></div>
        </div>
      </Section>
      <Section title="Display" :initially-open="false">
        <NumberField v-model="w.histogramBins" label="Histogram bins" :min="4" :max="512" integer />
        <label class="check"><input v-model="w.logCounts" type="checkbox" /> Logarithmic counts</label>
      </Section>
    </aside>

    <div class="lab-content">
      <div class="status-row">
        <h2>Comparison <span class="muted small">— {{ plural(w.variants.filter((v) => v.enabled).length, 'variant') }} on {{ data?.label ?? '…' }}</span></h2>
        <span v-if="computing" class="badge" role="status" data-testid="computing">computing…</span>
        <span v-if="computeError" class="badge badge-critical">{{ computeError }}</span>
      </div>
      <div class="card">
        <div class="card-body">
          <MetricsTable :variants="w.variants" :evaluations="evaluations" :active="w.activeVariantId" @select="w.activeVariantId = $event" />
        </div>
      </div>

      <div v-if="storage && activeEval" class="card">
        <div class="card-header">
          <h2>Storage — {{ activeVariant.name }} <InfoTip text="Theoretical bit-packed size. Real implementations add padding/alignment, and smaller encodings do not automatically translate into proportional speed or bandwidth gains." /></h2>
        </div>
        <div class="card-body stat-grid">
          <div class="stat"><div class="stat-label">Elements</div><div class="stat-value">{{ storage.elements.toLocaleString() }} × {{ storage.elementBits }} bits</div></div>
          <div class="stat"><div class="stat-label">Scales</div><div class="stat-value">{{ storage.blocks.toLocaleString() }} × {{ storage.blocks ? storage.scaleBits / storage.blocks : 0 }} bits</div></div>
          <div class="stat"><div class="stat-label">Zero-points</div><div class="stat-value">{{ storage.zeroPointBits ? `${storage.blocks} × ${storage.zeroPointBits / storage.blocks} bits` : 'none' }}</div></div>
          <div class="stat"><div class="stat-label">Packed total</div><div class="stat-value" data-testid="storage-total">{{ bytes(storage.totalBytes) }}</div><div class="stat-sub">{{ storage.bitsPerElement.toFixed(3) }} bits/value · {{ storage.compressionVsFp32.toFixed(2) }}× smaller than FP32</div></div>
          <div class="stat"><div class="stat-label">Levels actually used</div><div class="stat-value">{{ activeEval.levelsUsed.toLocaleString() }}</div><div class="stat-sub">distinct reconstructed values</div></div>
          <div class="stat"><div class="stat-label">In this browser</div><div class="stat-value">{{ bytes(storage.inMemoryBytes) }}</div><div class="stat-sub">{{ storage.inMemoryNote }}</div></div>
        </div>
      </div>

      <div class="grid-2">
        <ChartCard v-if="distribution" title="Value distributions" caption="Grey bars: original values. Lines: reconstructed values for each variant (same bins)." :columns="distribution.columns" :rows="distribution.rows" test-id="chart-distribution">
          <EChart :option="distribution.option" label="Histogram of original and reconstructed values" />
        </ChartCard>
        <ChartCard
          v-if="transfer"
          :title="`Original vs reconstructed — ${activeVariant.name}`"
          :caption="`Each dot is one element; the staircase is the quantizer. Red diamonds were clipped/saturated. Click a dot to inspect it.${transfer.stride > 1 ? ` Showing every ${transfer.stride}th element plus all saturated/outlier/selected ones.` : ''}`"
          :columns="transfer.columns"
          :rows="transfer.rows"
          test-id="chart-transfer"
        >
          <EChart :option="transfer.option" label="Scatter plot of original versus reconstructed values" @point-click="pick" />
        </ChartCard>
        <ChartCard
          v-if="gridChart"
          :title="`Quantization grid — ${activeVariant.name}`"
          :caption="`${activeSeries ? describeBlock(activeSeries.result.layout, selectedBlock) : ''}: histogram of this block's values. Vertical lines: values the grid can represent. Shaded: outside the representable range (saturation).`"
          :columns="gridChart.columns"
          :rows="gridChart.rows"
          info="For formats with more than 256 codes (FP16, BF16, FP32, FP64) the individual levels are too dense to draw."
          test-id="chart-grid"
        >
          <EChart :option="gridChart.option" label="Quantization bins and representable values for one block" />
          <template #footer>
            scale {{ fmt(gridChart.view.params.scale, 6) }} · zero-point {{ gridChart.view.params.zeroPoint }} · representable [{{ fmt(gridChart.view.params.representableLow, 5) }}, {{ fmt(gridChart.view.params.representableHigh, 5) }}]
            <template v-if="gridChart.view.params.degenerate"> · all-zero block (degenerate)</template>
            <template v-if="gridChart.view.params.scaleUnderflow"> · ⚠ scale underflowed</template>
          </template>
        </ChartCard>
        <ChartCard v-if="codes" :title="`Quantized values used — ${activeVariant.name}`" :caption="codes.possible ? `${codes.used} of ${codes.possible} possible codes are used.` : `${codes.used} distinct element values used.`" :columns="codes.columns" :rows="codes.rows" test-id="chart-codes">
          <EChart :option="codes.option" label="Histogram of quantized codes" />
        </ChartCard>
        <ChartCard v-if="errHist" title="Error distribution" caption="Signed reconstruction error x̂ − x for each variant." :columns="errHist.columns" :rows="errHist.rows" test-id="chart-errhist">
          <EChart :option="errHist.option" label="Histogram of reconstruction errors" />
        </ChartCard>
        <ChartCard v-if="errCdf" title="Cumulative error distribution" caption="Fraction of elements whose |error| is at most the x value. Curves further left are better." :columns="errCdf.columns" :rows="errCdf.rows" test-id="chart-cdf">
          <template #actions>
            <label class="check small"><input v-model="cdfLog" type="checkbox" /> log x</label>
          </template>
          <EChart :option="errCdf.option" label="Cumulative distribution of absolute errors" />
          <template v-if="cdfLog" #footer>Elements with zero error are omitted on the log axis.</template>
        </ChartCard>
        <ChartCard v-if="heatOrig" title="Original matrix" caption="Blue negative, red positive. Click a cell to select it." :columns="heatOrig.columns" :rows="heatOrig.rows" test-id="chart-heat-orig">
          <EChart :option="heatOrig.option" label="Heatmap of the original matrix" height="280px" @point-click="pick" />
        </ChartCard>
        <ChartCard v-if="heatErr" :title="`|Error| — ${activeVariant.name}`" caption="Where the quantization error is concentrated." :columns="heatErr.columns" :rows="heatErr.rows" test-id="chart-heat-err">
          <EChart :option="heatErr.option" label="Heatmap of absolute errors" height="280px" @point-click="pick" />
        </ChartCard>
        <ChartCard v-if="scales" :title="`Scale per block — ${activeVariant.name}`" :caption="`${activeSeries!.result.params.length} blocks (log scale).`" :columns="scales.columns" :rows="scales.rows">
          <EChart :option="scales.option" label="Scale of each block" />
        </ChartCard>
        <ChartCard v-if="mse" title="MSE calibration search" caption="MSE of the block for each clipping ratio on the grid; the minimum is chosen (ties → larger ratio). This is a grid search, not a proof of optimality." :columns="mse.columns" :rows="mse.rows">
          <EChart :option="mse.option" label="MSE versus clipping ratio" />
        </ChartCard>
      </div>

      <div v-if="data" class="card">
        <div class="card-header"><h2>Element inspector</h2></div>
        <div class="card-body">
          <ElementInspector v-model="selected" :variants="w.variants" :evaluations="evaluations" :shape="data.shape" :original="data.data" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.status-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.summary {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  align-items: center;
}
</style>
