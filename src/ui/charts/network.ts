import type { ForwardTrace } from '@/engine/nn/network';
import type { VariantSummary } from '@/labs/network';
import { axisStyle, baseOption, mixHex, seriesColor, yAxisStyle, type ChartPalette } from '@/ui/chartTheme';
import { fmt } from '@/ui/format';
import type { ChartData } from './workbench';

export interface NamedTrace {
  id: string;
  name: string;
  slot: number;
  trace: ForwardTrace;
}

/** Output values (probabilities for softmax) of the baseline and each variant for one input. */
export function outputsChart(p: ChartPalette, base: ForwardTrace, variants: NamedTrace[], names: string[], ylabel: string): ChartData {
  const axis = axisStyle(p);
  const k = base.output.length;
  const labels = Array.from({ length: k }, (_, i) => names[i] ?? `out ${i}`);
  return {
    option: {
      ...baseOption(p),
      grid: { left: 58, right: 16, top: 50, bottom: 40 },
      legend: { ...baseOption(p).legend, data: ['Baseline (FP64)', ...variants.map((v) => v.name)] },
      tooltip: { ...baseOption(p).tooltip, trigger: 'axis', valueFormatter: (v: number) => fmt(v, 6) },
      xAxis: { type: 'category', data: labels, ...axis, splitLine: { show: false } },
      yAxis: { type: 'value', name: ylabel, ...yAxisStyle(p) },
      series: [
        { name: 'Baseline (FP64)', type: 'bar', data: Array.from(base.output), itemStyle: { color: p.neutral, borderRadius: [3, 3, 0, 0] } },
        ...variants.map((v) => ({ name: v.name, type: 'bar', data: Array.from(v.trace.output), itemStyle: { color: seriesColor(p, v.slot), borderRadius: [3, 3, 0, 0] } })),
      ],
    },
    columns: ['Output', 'Baseline', ...variants.map((v) => v.name)],
    rows: labels.map((l, i) => [l, base.output[i]!, ...variants.map((v) => v.trace.output[i]!)]),
  };
}

/** Mean relative error of each layer's output, per variant (log scale). */
export function propagationChart(p: ChartPalette, summaries: (VariantSummary & { name: string; slot: number })[], layers: number): ChartData {
  const axis = axisStyle(p);
  const labels = Array.from({ length: layers }, (_, i) => (i === layers - 1 ? 'output' : `layer ${i + 1}`));
  return {
    option: {
      ...baseOption(p),
      grid: { left: 64, right: 16, top: 50, bottom: 40 },
      legend: { ...baseOption(p).legend, data: summaries.map((s) => s.name) },
      tooltip: { ...baseOption(p).tooltip, trigger: 'axis', valueFormatter: (v: number) => fmt(v, 4) },
      xAxis: { type: 'category', data: labels, ...axis, splitLine: { show: false } },
      yAxis: { type: 'log', name: 'mean ‖a_q − a‖ / ‖a‖', ...yAxisStyle(p) },
      series: summaries.map((s) => ({
        name: s.name,
        type: 'line',
        data: s.layerErrors.map((l) => Math.max(l.relError, 1e-17)),
        symbolSize: 7,
        lineStyle: { width: 2, color: seriesColor(p, s.slot) },
        itemStyle: { color: seriesColor(p, s.slot) },
      })),
    },
    columns: ['Layer', ...summaries.flatMap((s) => [`${s.name} rel. error`, `${s.name} cosine`])],
    rows: labels.map((l, i) => [l, ...summaries.flatMap((s) => [s.layerErrors[i]!.relError, s.layerErrors[i]!.cosine])]),
  };
}

/** Decision regions on a G×G grid with optional disagreement overlay and the samples. */
export function decisionChart(
  p: ChartPalette,
  grid: Uint8Array,
  G: number,
  range: { x: [number, number]; y: [number, number] },
  classes: number,
  samples: number[][],
  labels: number[] | null,
  compareTo: Uint8Array | null,
  selected: number,
): ChartData {
  const cells: [number, number, number][] = [];
  const diff: [number, number, number][] = [];
  const cx = (c: number) => range.x[0] + ((c + 0.5) / G) * (range.x[1] - range.x[0]);
  const cy = (r: number) => range.y[1] - ((r + 0.5) / G) * (range.y[1] - range.y[0]);
  for (let r = 0; r < G; r++)
    for (let c = 0; c < G; c++) {
      const k = grid[r * G + c]!;
      cells.push([cx(c), cy(r), k]);
      if (compareTo && compareTo[r * G + c] !== k) diff.push([cx(c), cy(r), 1]);
    }
  const axis = axisStyle(p);
  const classColors = Array.from({ length: classes }, (_, i) => seriesColor(p, i));
  const cellW = (range.x[1] - range.x[0]) / G;
  const cellH = (range.y[1] - range.y[0]) / G;
  const renderRect = (opacity: number, fill: (v: number) => string) =>
    // custom series draws each grid cell as a rectangle in data coordinates
    (params: { coordSys: unknown }, api: { value: (i: number) => number; coord: (v: [number, number]) => [number, number] }) => {
      const x = api.value(0);
      const y = api.value(1);
      const a = api.coord([x - cellW / 2, y + cellH / 2]);
      const b = api.coord([x + cellW / 2, y - cellH / 2]);
      void params;
      return { type: 'rect', shape: { x: a[0], y: a[1], width: b[0] - a[0] + 0.5, height: b[1] - a[1] + 0.5 }, style: { fill: fill(api.value(2)), opacity } };
    };
  const pts = samples.map((s, i) => [s[0]!, s[1]!, labels ? labels[i]! : 0, i]);
  return {
    option: {
      ...baseOption(p),
      grid: { left: 44, right: 12, top: 12, bottom: 32 },
      legend: { show: false },
      tooltip: {
        ...baseOption(p).tooltip,
        trigger: 'item',
        formatter: (it: { seriesName: string; value: number[] }) =>
          it.seriesName === 'Samples' ? `sample #${it.value[3]}<br/>(${fmt(it.value[0]!, 4)}, ${fmt(it.value[1]!, 4)})${labels ? `<br/>label ${it.value[2]}` : ''}` : `predicted class ${it.value[2]}`,
      },
      xAxis: { type: 'value', min: range.x[0], max: range.x[1], ...axis, splitLine: { show: false } },
      yAxis: { type: 'value', min: range.y[0], max: range.y[1], ...axis, splitLine: { show: false } },
      series: [
        { name: 'Regions', type: 'custom', renderItem: renderRect(1, (v) => mixHex(classColors[v] ?? p.neutral, p.surface, 0.72)), data: cells, silent: true, progressive: 0 },
        ...(compareTo ? [{ name: 'Changed', type: 'custom', renderItem: renderRect(1, () => mixHex(p.ink, p.surface, 0.15)), data: diff, silent: true, progressive: 0 }] : []),
        {
          name: 'Samples',
          type: 'scatter',
          data: pts,
          symbolSize: (v: number[]) => (v[3] === selected ? 13 : 6),
          itemStyle: { color: (q: { value: number[] }) => classColors[q.value[2]!] ?? p.neutral, borderColor: p.surface, borderWidth: 1 },
        },
      ],
    },
    columns: ['Region', 'Cells'],
    rows: classColors.map((_, k) => [`class ${k}`, cells.filter((c) => c[2] === k).length]),
  };
}
