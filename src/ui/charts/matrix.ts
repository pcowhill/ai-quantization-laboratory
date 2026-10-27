import type { DotResult } from '@/engine/arith/dot';
import { errorSplit, type MatrixEvaluation } from '@/labs/matrix';
import { axisStyle, baseOption, seriesColor, yAxisStyle, type ChartPalette } from '@/ui/chartTheme';
import { fmt } from '@/ui/format';
import type { ChartData } from './workbench';

/** Per-entry error split into storage error and arithmetic error. */
export function errorSplitChart(p: ChartPalette, e: MatrixEvaluation, maxEntries = 64): ChartData {
  const n = Math.min(e.simulated.length, maxEntries);
  const labels: string[] = [];
  const storage: number[] = [];
  const arith: number[] = [];
  const rows: (string | number)[][] = [];
  for (let k = 0; k < n; k++) {
    const s = errorSplit(e, k);
    const label = e.outCols > 1 || e.outRows > 1 ? `[${Math.floor(k / e.outCols)},${k % e.outCols}]` : `[${k}]`;
    labels.push(label);
    storage.push(s.storage);
    arith.push(s.arithmetic);
    rows.push([label, s.storage, s.arithmetic, s.total]);
  }
  const axis = axisStyle(p);
  return {
    option: {
      ...baseOption(p),
      grid: { left: 64, right: 16, top: 50, bottom: 40 },
      legend: { ...baseOption(p).legend, data: ['Storage error', 'Arithmetic error'] },
      tooltip: { ...baseOption(p).tooltip, trigger: 'axis', valueFormatter: (v: number) => fmt(v, 6) },
      xAxis: { type: 'category', data: labels, name: 'output entry', nameLocation: 'middle', nameGap: 26, ...axis, splitLine: { show: false }, axisLabel: { ...axis.axisLabel, hideOverlap: true } },
      yAxis: { type: 'value', name: 'error vs exact result', ...yAxisStyle(p) },
      series: [
        { name: 'Storage error', type: 'bar', stack: 'err', data: storage, itemStyle: { color: seriesColor(p, 0) } },
        { name: 'Arithmetic error', type: 'bar', stack: 'err', data: arith, itemStyle: { color: seriesColor(p, 1) } },
      ],
    },
    columns: ['Entry', 'Storage error', 'Arithmetic error', 'Total error'],
    rows,
  };
}

/** Running sum of a dot product: simulated accumulator vs exact running sum. */
export function dotTraceChart(p: ChartPalette, t: DotResult): ChartData {
  const steps = t.steps ?? [];
  const axis = axisStyle(p);
  return {
    option: {
      ...baseOption(p),
      grid: { left: 64, right: 16, top: 50, bottom: 40 },
      legend: { ...baseOption(p).legend, data: ['Simulated accumulator', 'Exact running sum'] },
      tooltip: { ...baseOption(p).tooltip, trigger: 'axis', valueFormatter: (v: number) => fmt(v, 8) },
      xAxis: { type: 'category', data: steps.map((s) => s.index), name: 'step k', nameLocation: 'middle', nameGap: 26, ...axis, splitLine: { show: false } },
      yAxis: { type: 'value', name: 'partial sum', scale: true, ...yAxisStyle(p) },
      series: [
        { name: 'Simulated accumulator', type: 'line', step: 'end', symbol: steps.length > 60 ? 'none' : 'circle', symbolSize: 5, data: steps.map((s) => s.accAfter), lineStyle: { color: seriesColor(p, 0), width: 2 }, itemStyle: { color: seriesColor(p, 0) } },
        { name: 'Exact running sum', type: 'line', symbol: 'none', data: steps.map((s) => s.exactRunning), lineStyle: { color: p.neutral, width: 1.5 }, itemStyle: { color: p.neutral } },
      ],
    },
    columns: ['Step', 'a', 'b', 'Product (rounded)', 'Accumulator after', 'Exact running sum'],
    rows: steps.map((s) => [s.index, s.a, s.b, s.product, s.accAfter, s.exactRunning]),
  };
}
