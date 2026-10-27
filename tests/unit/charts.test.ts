/** Charts must faithfully reflect the numerical engine's results. */
import { describe, expect, it } from 'vitest';
import { histogram, finiteRange } from '@/engine/viz/histogram';
import { quantizeTensor } from '@/engine/quant/quantize';
import { makeQuantConfig } from '@/engine/quant/types';
import { generate } from '@/engine/random/distributions';
import { codeUsageChart, distributionChart, errorCdfChart, gridLevels, transferChart } from '@/ui/charts/workbench';
import { readPalette } from '@/ui/chartTheme';
import { evaluateMatrix, errorSplit } from '@/labs/matrix';
import { errorSplitChart } from '@/ui/charts/matrix';
import { defaultMatrix } from '@/state/schema';

const p = readPalette();
const x = generate({ kind: 'normal', params: {}, rows: 8, cols: 64, seed: 5 });
const r = quantizeTensor(x, [8, 64], makeQuantConfig({ format: 'int4' }));
const s = { id: 'v1', name: 'INT4', slot: 0, result: r };

describe('workbench charts plot exactly the engine output', () => {
  it('distribution chart counts equal histograms of original and reconstruction', () => {
    const c = distributionChart(p, x, [s], 32, false);
    const [lo, hi] = finiteRange(x, r.recon)!;
    const series = (c.option.series as { data: number[] }[]);
    expect(series[0]!.data).toEqual(histogram(x, lo, hi, 32).counts);
    expect(series[1]!.data).toEqual(histogram(r.recon, lo, hi, 32).counts);
    expect(c.rows.reduce((a, row) => a + (row[2] as number), 0)).toBe(512);
  });
  it('transfer scatter points are (original, reconstructed, index) triples', () => {
    const c = transferChart(p, s, 3, null);
    const pts = (c.option.series as { data: [number, number, number][] }[]).slice(1, 3).flatMap((q) => q.data);
    for (const [a, b, i] of pts) {
      expect(a).toBe(r.original[i]);
      expect(b).toBe(r.recon[i]);
    }
    expect(pts.length).toBe(512);
  });
  it('code usage counts every element once', () => {
    const c = codeUsageChart(p, s);
    expect(c.rows.reduce((a, row) => a + (row[1] as number), 0)).toBe(512);
    expect(c.possible).toBe(16);
  });
  it('grid levels are s·(q − z) for every code', () => {
    const g = gridLevels(r, 0);
    expect(g.levels).toHaveLength(16);
    expect(g.levels![8]).toBe(0); // q = 0
    expect(g.levels![15]).toBe(r.params[0]!.scale * 7);
  });
  it('error CDF reaches 1', () => {
    const c = errorCdfChart(p, [s], false);
    const data = (c.option.series as { data: [number, number][] }[])[0]!.data;
    expect(data.at(-1)![1]).toBe(1);
  });
});

describe('matrix charts', () => {
  it('error split bars sum to the total error', () => {
    const e = evaluateMatrix(defaultMatrix());
    const c = errorSplitChart(p, e);
    c.rows.forEach((row, k) => {
      const sp = errorSplit(e, k);
      expect(row[1]).toBe(sp.storage);
      expect(row[2]).toBe(sp.arithmetic);
      expect((row[1] as number) + (row[2] as number)).toBeCloseTo(sp.total, 12);
    });
  });
});
