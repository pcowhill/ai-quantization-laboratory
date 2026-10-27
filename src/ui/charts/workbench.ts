/**
 * ECharts option builders for the Quantization Workbench. Each returns the
 * option and the exact numbers it plots (used by the accessible table view
 * and by tests that check charts faithfully reflect engine results).
 */
import { RoundFlag } from '@/engine/float/round';
import { getFormat, characteristics } from '@/engine/formats/registry';
import { enumerateFinite } from '@/engine/float/codec';
import type { BlockParams, QuantResult } from '@/engine/quant/quantize';
import { empiricalCdf, finiteRange, histogram, sampleIndices, valueCounts } from '@/engine/viz/histogram';
import { axisStyle, baseOption, seriesColor, yAxisStyle, type ChartPalette } from '@/ui/chartTheme';
import { fmt } from '@/ui/format';

export interface ChartData {
  option: Record<string, unknown>;
  columns: string[];
  rows: (string | number)[][];
}

export interface SeriesInput {
  id: string;
  name: string;
  slot: number;
  result: QuantResult;
}

const SAT = RoundFlag.Saturated | RoundFlag.Overflow;

function grid(extra: Record<string, unknown> = {}) {
  return { left: 58, right: 18, top: 50, bottom: 42, containLabel: false, ...extra };
}

/** Original-value histogram (bars) overlaid with each variant's reconstructed histogram (step lines). */
export function distributionChart(p: ChartPalette, original: Float64Array, series: SeriesInput[], bins: number, logCounts: boolean): ChartData {
  const range = finiteRange(original, ...series.map((s) => s.result.recon)) ?? [0, 1];
  const [lo, hi] = range[0] === range[1] ? [range[0] - 0.5, range[1] + 0.5] : range;
  const hOrig = histogram(original, lo, hi, bins);
  const hs = series.map((s) => histogram(s.result.recon, lo, hi, bins));
  const centers = hOrig.counts.map((_, k) => lo + (k + 0.5) * hOrig.width);
  const axis = axisStyle(p);
  const option = {
    ...baseOption(p),
    grid: grid(),
    legend: { ...baseOption(p).legend, data: ['Original', ...series.map((s) => `${s.name} (reconstructed)`)] },
    tooltip: {
      ...baseOption(p).tooltip,
      trigger: 'axis',
      formatter: (items: { dataIndex: number; seriesName: string; value: number | [number, number]; marker: string }[]) => {
        const k = items[0]?.dataIndex ?? 0;
        const head = `<b>[${fmt(lo + k * hOrig.width, 5)}, ${fmt(lo + (k + 1) * hOrig.width, 5)})</b>`;
        return [head, ...items.map((i) => `${i.marker}${i.seriesName}: ${Array.isArray(i.value) ? i.value[1] : i.value}`)].join('<br/>');
      },
    },
    xAxis: { type: 'category', data: centers.map((c) => fmt(c, 4)), name: 'value', nameLocation: 'middle', nameGap: 26, ...axis, splitLine: { show: false }, axisLabel: { ...axis.axisLabel, hideOverlap: true } },
    yAxis: { type: logCounts ? 'log' : 'value', name: 'count', min: logCounts ? 1 : 0, ...yAxisStyle(p) },
    series: [
      { name: 'Original', type: 'bar', data: hOrig.counts.map((c) => (logCounts && c === 0 ? null : c)), itemStyle: { color: p.neutral, opacity: 0.55, borderRadius: [2, 2, 0, 0] }, barCategoryGap: '8%' },
      ...series.map((s, i) => ({
        name: `${s.name} (reconstructed)`,
        type: 'line',
        step: 'middle',
        symbol: 'none',
        data: hs[i]!.counts.map((c) => (logCounts && c === 0 ? null : c)),
        lineStyle: { width: 2, color: seriesColor(p, s.slot) },
        itemStyle: { color: seriesColor(p, s.slot) },
      })),
    ],
  };
  const columns = ['Bin start', 'Bin end', 'Original', ...series.map((s) => s.name)];
  const rows = hOrig.counts.map((c, k) => [fmt(lo + k * hOrig.width, 6), fmt(lo + (k + 1) * hOrig.width, 6), c, ...hs.map((h) => h.counts[k]!)]);
  return { option, columns, rows };
}

/** Original (x) vs reconstructed (y) scatter: the quantization staircase. */
export function transferChart(p: ChartPalette, s: SeriesInput, selected: number | null, outliers: Uint8Array | null, maxPoints = 6000): ChartData & { stride: number } {
  const r = s.result;
  const n = r.original.length;
  const always: number[] = [];
  if (selected !== null) always.push(selected);
  for (let i = 0; i < n; i++) if (r.flags[i]! & SAT || (outliers && outliers[i])) always.push(i);
  const { indices, stride } = sampleIndices(n, maxPoints, always.slice(0, 4000));
  const normal: [number, number, number][] = [];
  const sat: [number, number, number][] = [];
  const outl: [number, number, number][] = [];
  for (const i of indices) {
    const x = r.original[i]!;
    const y = r.recon[i]!;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const pt: [number, number, number] = [x, y, i];
    if (r.flags[i]! & SAT) sat.push(pt);
    else normal.push(pt);
    if (outliers && outliers[i]) outl.push(pt);
  }
  const range = finiteRange(r.original, r.recon) ?? [-1, 1];
  const axis = axisStyle(p);
  const color = seriesColor(p, s.slot);
  const sel = selected !== null && Number.isFinite(r.original[selected]!) && Number.isFinite(r.recon[selected]!) ? [[r.original[selected]!, r.recon[selected]!, selected]] : [];
  const option = {
    ...baseOption(p),
    grid: grid(),
    legend: { ...baseOption(p).legend, data: ['Elements', 'Saturated / clipped', ...(outliers ? ['Outliers'] : []), 'Selected'] },
    tooltip: {
      ...baseOption(p).tooltip,
      trigger: 'item',
      formatter: (it: { value: [number, number, number]; seriesName: string }) =>
        it.value ? `<b>element #${it.value[2]}</b><br/>original: ${it.value[0]}<br/>reconstructed: ${it.value[1]}<br/>error: ${fmt(it.value[1] - it.value[0], 6)}` : it.seriesName,
    },
    xAxis: { type: 'value', name: 'original x', nameLocation: 'middle', nameGap: 26, scale: true, ...axis },
    yAxis: { type: 'value', name: 'reconstructed x̂', scale: true, ...yAxisStyle(p) },
    dataZoom: [{ type: 'inside', xAxisIndex: 0, filterMode: 'none' }, { type: 'inside', yAxisIndex: 0, filterMode: 'none' }],
    series: [
      {
        name: 'y = x',
        type: 'line',
        data: [
          [range[0], range[0]],
          [range[1], range[1]],
        ],
        symbol: 'none',
        silent: true,
        lineStyle: { color: p.axis, width: 1 },
      },
      { name: 'Elements', type: 'scatter', data: normal, symbolSize: 5, itemStyle: { color, opacity: 0.75 }, large: normal.length > 3000 },
      { name: 'Saturated / clipped', type: 'scatter', data: sat, symbolSize: 7, symbol: 'diamond', itemStyle: { color: p.critical } },
      ...(outliers ? [{ name: 'Outliers', type: 'scatter', data: outl, symbolSize: 11, itemStyle: { color: 'transparent', borderColor: p.warning, borderWidth: 1.5 } }] : []),
      { name: 'Selected', type: 'scatter', data: sel, symbolSize: 14, itemStyle: { color: 'transparent', borderColor: p.ink, borderWidth: 2 }, z: 10 },
    ],
  };
  const columns = ['Element', 'Original', 'Reconstructed', 'Error', 'Saturated'];
  const rows = indices.slice(0, 400).map((i) => [i, r.original[i]!, r.recon[i]!, fmt(r.recon[i]! - r.original[i]!, 6), r.flags[i]! & SAT ? 'yes' : '']);
  return { option, columns, rows, stride };
}

/** Distribution of signed errors x̂ − x for every variant. */
export function errorHistogramChart(p: ChartPalette, series: SeriesInput[], bins: number): ChartData {
  const errs = series.map((s) => s.result.recon.map((y, i) => y - s.result.original[i]!));
  const range = finiteRange(...errs) ?? [-1, 1];
  const [lo, hi] = range[0] === range[1] ? [range[0] - 1e-12, range[1] + 1e-12] : range;
  const hs = errs.map((e) => histogram(e, lo, hi, bins));
  const centers = hs[0]?.counts.map((_, k) => lo + (k + 0.5) * (hi - lo) / bins) ?? [];
  const axis = axisStyle(p);
  const option = {
    ...baseOption(p),
    grid: grid(),
    legend: { ...baseOption(p).legend, data: series.map((s) => s.name) },
    tooltip: { ...baseOption(p).tooltip, trigger: 'axis' },
    xAxis: { type: 'category', data: centers.map((c) => fmt(c, 3)), name: 'error x̂ − x', nameLocation: 'middle', nameGap: 26, ...axis, splitLine: { show: false }, axisLabel: { ...axis.axisLabel, hideOverlap: true } },
    yAxis: { type: 'value', name: 'count', ...yAxisStyle(p) },
    series: series.map((s, i) => ({ name: s.name, type: 'line', step: 'middle', symbol: 'none', data: hs[i]!.counts, lineStyle: { width: 2, color: seriesColor(p, s.slot) }, itemStyle: { color: seriesColor(p, s.slot) } })),
  };
  const columns = ['Bin centre', ...series.map((s) => s.name)];
  const rows = centers.map((c, k) => [fmt(c, 6), ...hs.map((h) => h.counts[k]!)]);
  return { option, columns, rows };
}

/** Empirical CDF of |x̂ − x| per variant. */
export function errorCdfChart(p: ChartPalette, series: SeriesInput[], logX: boolean): ChartData {
  const cdfs = series.map((s) => {
    const abs = s.result.recon.map((y, i) => Math.abs(y - s.result.original[i]!));
    return empiricalCdf(logX ? abs.filter((v) => v > 0) : abs, 300);
  });
  const axis = axisStyle(p);
  const option = {
    ...baseOption(p),
    grid: grid(),
    legend: { ...baseOption(p).legend, data: series.map((s) => s.name) },
    tooltip: {
      ...baseOption(p).tooltip,
      trigger: 'axis',
      valueFormatter: (v: number) => (typeof v === 'number' ? fmt(v, 5) : String(v)),
    },
    xAxis: { type: logX ? 'log' : 'value', name: '|error|', nameLocation: 'middle', nameGap: 26, ...axis },
    yAxis: { type: 'value', name: 'fraction ≤', min: 0, max: 1, ...yAxisStyle(p) },
    series: series.map((s, i) => ({ name: s.name, type: 'line', step: 'end', symbol: 'none', data: cdfs[i], lineStyle: { width: 2, color: seriesColor(p, s.slot) }, itemStyle: { color: seriesColor(p, s.slot) } })),
  };
  const columns = ['Variant', '50% of errors ≤', '90% ≤', '99% ≤', 'max'];
  const q = (c: [number, number][], f: number) => c.find((x) => x[1] >= f)?.[0] ?? NaN;
  const rows = series.map((s, i) => [s.name, fmt(q(cdfs[i]!, 0.5), 5), fmt(q(cdfs[i]!, 0.9), 5), fmt(q(cdfs[i]!, 0.99), 5), fmt(cdfs[i]!.at(-1)?.[0] ?? NaN, 5)]);
  return { option, columns, rows };
}

/** How often each quantized code / element value is used. */
export function codeUsageChart(p: ChartPalette, s: SeriesInput): ChartData & { possible: number | null; used: number } {
  const counts = valueCounts(s.result.q.filter((v) => Number.isFinite(v)));
  const fmtDef = getFormat(s.result.config.format);
  const axis = axisStyle(p);
  let possible: number | null = null;
  if (fmtDef.kind === 'int') possible = (s.result.config.narrowRange ? 2 * fmtDef.max : fmtDef.max - fmtDef.min) + 1;
  else if (fmtDef.totalBits <= 8) possible = enumerateFinite(fmtDef).length;
  const option = {
    ...baseOption(p),
    grid: grid(),
    legend: { show: false },
    tooltip: { ...baseOption(p).tooltip, trigger: 'axis' },
    xAxis: { type: 'category', data: counts.map((c) => fmt(c.value, 6)), name: fmtDef.kind === 'int' ? 'integer code q' : `${fmtDef.name} element value`, nameLocation: 'middle', nameGap: 26, ...axis, splitLine: { show: false }, axisLabel: { ...axis.axisLabel, hideOverlap: true } },
    yAxis: { type: 'value', name: 'count', ...yAxisStyle(p) },
    series: [{ name: 'Elements', type: 'bar', data: counts.map((c) => c.count), itemStyle: { color: seriesColor(p, s.slot), borderRadius: [3, 3, 0, 0] }, barMaxWidth: 14 }],
  };
  return { option, columns: ['Value', 'Count'], rows: counts.map((c) => [c.value, c.count]), possible, used: counts.length };
}

export interface GridView {
  block: number;
  params: BlockParams;
  /** Reconstructed values the grid can produce (≤ 8-bit formats; null otherwise). */
  levels: number[] | null;
}

/** Representable reconstruction levels for a block (only for formats with ≤ 256 codes). */
export function gridLevels(r: QuantResult, block: number): GridView {
  const params = r.params[block]!;
  const f = getFormat(r.config.format);
  let levels: number[] | null = null;
  if (f.kind === 'int') {
    const qmin = r.config.narrowRange ? -f.max : f.min;
    levels = [];
    for (let q = qmin; q <= f.max; q++) levels.push(params.scale * (q - params.zeroPoint));
  } else if (f.totalBits <= 8) {
    const s = r.config.scaling === 'scaled' ? params.scale : 1;
    levels = Array.from(enumerateFinite(f), (v) => v * s);
  }
  return { block, params, levels };
}

/** Histogram of one block's original values with the representable grid and saturation zones. */
export function quantGridChart(p: ChartPalette, s: SeriesInput, block: number, bins: number): ChartData & { view: GridView } {
  const r = s.result;
  const view = gridLevels(r, block);
  const vals: number[] = [];
  for (let i = 0; i < r.original.length; i++) if (r.layout.blockOf[i] === block) vals.push(r.original[i]!);
  const lo0 = Math.min(view.params.representableLow, ...vals.filter(Number.isFinite));
  const hi0 = Math.max(view.params.representableHigh, ...vals.filter(Number.isFinite));
  const pad = (hi0 - lo0) * 0.04 || 1;
  const lo = lo0 - pad;
  const hi = hi0 + pad;
  const h = histogram(vals, lo, hi, bins);
  const axis = axisStyle(p);
  const color = seriesColor(p, s.slot);
  const showLevels = view.levels && view.levels.length <= 300;
  const option = {
    ...baseOption(p),
    grid: grid({ top: 30 }),
    legend: { show: false },
    tooltip: { ...baseOption(p).tooltip, trigger: 'item' },
    xAxis: { type: 'value', min: lo, max: hi, name: 'value', nameLocation: 'middle', nameGap: 26, ...axis },
    yAxis: { type: 'value', name: 'count', ...yAxisStyle(p) },
    series: [
      {
        name: 'Original values',
        type: 'bar',
        data: h.counts.map((c, k) => [lo + (k + 0.5) * h.width, c]),
        barWidth: '92%',
        itemStyle: { color: p.neutral, opacity: 0.55 },
        markArea: {
          silent: true,
          itemStyle: { color: p.critical, opacity: 0.08 },
          data: [
            [{ xAxis: lo }, { xAxis: view.params.representableLow }],
            [{ xAxis: view.params.representableHigh }, { xAxis: hi }],
          ],
        },
        markLine: {
          silent: true,
          symbol: 'none',
          label: { show: false },
          lineStyle: { color, width: 1, opacity: view.levels && view.levels.length > 64 ? 0.25 : 0.75, type: 'solid' },
          data: showLevels ? view.levels!.filter((v) => v >= lo && v <= hi).map((v) => ({ xAxis: v })) : [],
        },
      },
    ],
  };
  return {
    option,
    view,
    columns: ['Level #', 'Reconstructed value'],
    rows: (view.levels ?? []).map((v, i) => [i, v]),
  };
}

/** Diverging (signed) or sequential (magnitude) heatmap of a matrix. */
export function heatmapChart(p: ChartPalette, values: ArrayLike<number>, rows: number, cols: number, kind: 'signed' | 'magnitude', label: string, selected: number | null, maxCells = 40000): ChartData {
  const stepR = Math.max(1, Math.ceil(rows / Math.sqrt(maxCells)));
  const stepC = Math.max(1, Math.ceil(cols / Math.sqrt(maxCells)));
  const data: [number, number, number, number][] = [];
  let maxAbs = 0;
  for (let r = 0; r < rows; r += stepR)
    for (let c = 0; c < cols; c += stepC) {
      const i = r * cols + c;
      const v = values[i]!;
      if (Number.isFinite(v)) maxAbs = Math.max(maxAbs, Math.abs(v));
      data.push([c / stepC, r / stepR, Number.isFinite(v) ? v : 0, i]);
    }
  const axis = axisStyle(p);
  const seq = [p.divMid, p.series[0]!];
  const option = {
    ...baseOption(p),
    grid: { left: 44, right: 70, top: 12, bottom: 36 },
    legend: { show: false },
    tooltip: {
      ...baseOption(p).tooltip,
      formatter: (it: { value: [number, number, number, number] }) => `row ${Math.floor(it.value[3] / cols)}, col ${it.value[3] % cols}<br/>${label}: ${values[it.value[3]]}`,
    },
    xAxis: { type: 'category', data: Array.from({ length: Math.ceil(cols / stepC) }, (_, k) => k * stepC), name: 'column', nameLocation: 'middle', nameGap: 22, ...axis, splitLine: { show: false }, axisLabel: { ...axis.axisLabel, hideOverlap: true } },
    yAxis: { type: 'category', inverse: true, data: Array.from({ length: Math.ceil(rows / stepR) }, (_, k) => k * stepR), name: 'row', ...yAxisStyle(p), splitLine: { show: false }, axisLabel: { ...yAxisStyle(p).axisLabel, hideOverlap: true } },
    visualMap: {
      dimension: 2,
      min: kind === 'signed' ? -maxAbs || -1 : 0,
      max: maxAbs || 1,
      calculable: true,
      orient: 'vertical',
      right: 4,
      top: 10,
      itemHeight: 120,
      textStyle: { color: p.muted, fontSize: 10 },
      inRange: { color: kind === 'signed' ? [p.divNeg, p.divMid, p.divPos] : seq },
      formatter: (v: number) => fmt(v, 3),
    },
    series: [
      {
        name: label,
        type: 'heatmap',
        data,
        progressive: 0,
        emphasis: { itemStyle: { borderColor: p.ink, borderWidth: 1 } },
        markPoint:
          selected !== null && selected < rows * cols
            ? { symbol: 'rect', symbolSize: 10, itemStyle: { color: 'transparent', borderColor: p.ink, borderWidth: 2 }, data: [{ coord: [Math.floor((selected % cols) / stepC), Math.floor(Math.floor(selected / cols) / stepR)] }] }
            : undefined,
      },
    ],
  };
  return { option, columns: ['Row', 'Column', label], rows: data.slice(0, 400).map((d) => [Math.floor(d[3] / cols), d[3] % cols, values[d[3]]!]) };
}

/** Per-block scale and saturation counts. */
export function blockScalesChart(p: ChartPalette, s: SeriesInput): ChartData {
  const ps = s.result.params;
  const axis = axisStyle(p);
  const option = {
    ...baseOption(p),
    grid: grid(),
    legend: { show: false },
    tooltip: { ...baseOption(p).tooltip, trigger: 'axis' },
    xAxis: { type: 'category', data: ps.map((_, i) => i), name: 'block', nameLocation: 'middle', nameGap: 26, ...axis, splitLine: { show: false } },
    yAxis: { type: 'log', name: 'scale', ...yAxisStyle(p) },
    series: [{ name: 'Scale', type: 'line', data: ps.map((b) => b.scale), symbolSize: ps.length > 100 ? 0 : 5, lineStyle: { color: seriesColor(p, s.slot), width: 1.5 }, itemStyle: { color: seriesColor(p, s.slot) } }],
  };
  return { option, columns: ['Block', 'Scale', 'Zero-point', 'Saturated'], rows: ps.map((b, i) => [i, b.scale, b.zeroPoint, b.saturated]) };
}

/** MSE versus clipping ratio for one block (MSE calibration). */
export function mseCurveChart(p: ChartPalette, s: SeriesInput, block: number): ChartData | null {
  const b = s.result.params[block];
  if (!b?.search) return null;
  const axis = axisStyle(p);
  const option = {
    ...baseOption(p),
    grid: grid(),
    legend: { show: false },
    tooltip: { ...baseOption(p).tooltip, trigger: 'axis', valueFormatter: (v: number) => fmt(v, 6) },
    xAxis: { type: 'value', name: 'clipping ratio α', nameLocation: 'middle', nameGap: 26, min: Math.min(...b.search.map((x) => x.ratio)), max: 1, ...axis },
    yAxis: { type: 'log', name: 'MSE', ...yAxisStyle(p) },
    series: [
      {
        name: 'MSE',
        type: 'line',
        data: b.search.map((x) => [x.ratio, x.mse || Number.MIN_VALUE]),
        symbol: 'none',
        lineStyle: { color: seriesColor(p, s.slot), width: 2 },
        markLine: { symbol: 'none', label: { formatter: `chosen α = ${fmt(b.chosenRatio ?? 1, 4)}`, color: p.ink2 }, lineStyle: { color: p.ink2, type: 'solid' }, data: [{ xAxis: b.chosenRatio ?? 1 }] },
      },
    ],
  };
  return { option, columns: ['Ratio α', 'MSE'], rows: b.search.map((x) => [x.ratio, x.mse]) };
}

export function formatMaxFinite(id: Parameters<typeof getFormat>[0]): number {
  const f = getFormat(id);
  return f.kind === 'int' ? f.max : characteristics(f).maxFinite;
}
