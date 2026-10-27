/** Regression tests for issues found in the independent review of M3. */
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { roundString } from '@/engine/float/rational';
import { FLOAT_FORMATS } from '@/engine/formats/registry';
import { quantizeTensor } from '@/engine/quant/quantize';
import { makeQuantConfig } from '@/engine/quant/types';
import { inspect } from '@/labs/inspector';
import { INSPECTOR_PRESETS } from '@/labs/inspectorPresets';
import { DataParseError, parseDelimited } from '@/labs/importData';
import { defaultExperimentState } from '@/state/defaults';
import { defaultInspector } from '@/state/schema';
import { encodeJson, makeExperimentFile, validateState } from '@/state/validate';
import { useExperimentsStore } from '@/stores/experiments';
import { useLabStore } from '@/stores/lab';
import { errorCdfChart, heatmapChart, quantGridChart, transferChart } from '@/ui/charts/workbench';
import { readPalette } from '@/ui/chartTheme';

const p = readPalette();
const preset = (id: string, f: Parameters<typeof INSPECTOR_PRESETS[number]['value']>[0]) => INSPECTOR_PRESETS.find((x) => x.id === id)!.value(f)!;

describe('charts', () => {
  it('quantization grid handles blocks with hundreds of thousands of elements', () => {
    const x = new Float64Array(300000).map((_, i) => Math.sin(i));
    const r = quantizeTensor(x, [1, x.length], makeQuantConfig({ format: 'int8' }));
    expect(() => quantGridChart(p, { id: 'v1', name: 'a', slot: 0, result: r }, 0, 64)).not.toThrow();
  });
  it('log-scale CDF quantiles still count exact (zero-error) elements', () => {
    const x = [1, 2, 3, 4, 5, 6, 7, 8, 0.1, 0.3];
    const r = quantizeTensor(x, [1, 10], makeQuantConfig({ format: 'fp16', scaling: 'none' }));
    const c = errorCdfChart(p, [{ id: 'v1', name: 'a', slot: 0, result: r }], true);
    expect(c.rows[0]![1]).toBe('0'); // the median error is 0 (8 of 10 values are exact)
  });
  it('transfer chart shows every saturated element (up to the documented cap) and reports the count', () => {
    const x = new Float64Array(20000).map((_, i) => (i % 2 ? 1000 : Math.cos(i)));
    const r = quantizeTensor(x, [1, x.length], makeQuantConfig({ format: 'int8', calibration: 'manual', manualScale: 0.01 }));
    const c = transferChart(p, { id: 'v1', name: 'a', slot: 0, result: r }, null, null);
    expect(c.forcedTotal).toBe(10000);
    expect(c.forcedShown).toBe(10000);
    const sat = (c.option.series as { name: string; data: unknown[] }[]).find((s) => s.name === 'Saturated / clipped')!;
    expect(sat.data.length).toBe(10000);
  });
  it('down-sampled heatmaps keep the peak value of each tile', () => {
    const v = new Float64Array(500 * 500);
    v[123 * 500 + 457] = 99;
    const c = heatmapChart(p, v, 500, 500, 'magnitude', 'x', null);
    const data = (c.option.series as { data: [number, number, number, number][] }[])[0]!.data;
    expect(Math.max(...data.map((d) => d[2]))).toBe(99);
    expect((c.option.visualMap as { max: number }).max).toBe(99);
  });
});

describe('inspector', () => {
  it('FP64 rounding-boundary presets are exact', () => {
    const f = FLOAT_FORMATS.fp64;
    expect(roundString(f, preset('underflow', 'fp64'), { mode: 'nearest-even' })).toBe(0);
    expect(roundString(f, preset('underflow', 'fp64'), { mode: 'toward-positive' })).toBe(Number.MIN_VALUE);
    expect(roundString(f, preset('tie-one', 'fp64'), { mode: 'nearest-even' })).toBe(1);
    expect(roundString(f, preset('tie-one', 'fp64'), { mode: 'nearest-away' })).toBe(1 + Number.EPSILON);
    expect(roundString(f, preset('tie-one-up', 'fp64'), { mode: 'nearest-even' })).toBe(1 + Number.EPSILON);
    expect(roundString(f, preset('tie-odd', 'fp64'), { mode: 'nearest-even' })).toBe(1 + 2 * Number.EPSILON);
    expect(roundString(f, preset('overflow-tie', 'fp64'), { mode: 'nearest-even', overflow: 'nonsaturate' })).toBe(Infinity);
    expect(roundString(f, preset('just-below-overflow', 'fp64'), { mode: 'nearest-even' })).toBe(Number.MAX_VALUE);
  });
  it('integer errors are computed exactly from q·scale', () => {
    const r = inspect({ ...defaultInspector(), input: '0.3', format: 'int8', intScale: 0.1 });
    // exact: 3 × fl(0.1) − 0.3 = 1.665…e-17
    expect(r.primary!.absError).toBeCloseTo(1.6653345369377348e-17, 30);
  });
});

describe('CSV parsing', () => {
  it('rejects out-of-range numbers instead of silently producing infinity', () => {
    expect(() => parseDelimited('1, 1e400')).toThrow(DataParseError);
    expect(parseDelimited('1, inf').values[1]).toBe(Infinity);
  });
  it('signed hex values parse; malformed first rows are errors, not headers', () => {
    expect(parseDelimited('-0x10, 0x10').values).toEqual([-16, 16]);
    expect(() => parseDelimited('1.2.3, 4\n5, 6')).toThrow(DataParseError);
    expect(parseDelimited('weight, bias\n1, 2').notes[0]).toMatch(/header/);
  });
  it('tall imports (more than 4096 rows) produce a valid state', () => {
    const t = parseDelimited(Array.from({ length: 5000 }, (_, i) => String(i)).join('\n'));
    const s = defaultExperimentState();
    s.workbench.source = { kind: 'imported', name: 'tall.csv', rows: t.rows, cols: t.cols, values: t.values };
    s.workbench.datasetId = null;
    expect(validateState(JSON.parse(encodeJson(s))).errors).toEqual([]);
  });
});

describe('experiments store', () => {
  beforeEach(() => setActivePinia(createPinia()));
  const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

  it('redo after a fresh (unrecorded) edit keeps the edit', async () => {
    const exps = useExperimentsStore();
    await exps.init();
    const lab = useLabStore();
    lab.state.inspector.input = 'A';
    await tick(400);
    exps.undo();
    lab.state.inspector.input = 'C';
    await tick();
    exps.redo();
    expect(lab.state.inspector.input).toBe('C');
  });
  it('generated names never exceed 200 characters; duplicate records its source as parent', async () => {
    const exps = useExperimentsStore();
    await exps.init();
    await exps.rename(exps.currentId, 'x'.repeat(200));
    const src = exps.currentId;
    const d = await exps.duplicate(src);
    expect(d!.name.length).toBeLessThanOrEqual(200);
    expect(d!.parentId).toBe(src);
  });
  it('duplicate ids inside one imported file are made unique', async () => {
    const exps = useExperimentsStore();
    await exps.init();
    const e = JSON.parse(exps.exportJson([exps.currentId])).experiments[0];
    const file = encodeJson(makeExperimentFile([{ ...e, id: 'same' }, { ...e, id: 'same' }]));
    const { imported } = await exps.importJson(file);
    expect(new Set(exps.experiments.map((x) => x.id)).size).toBe(exps.experiments.length);
    expect(imported).toHaveLength(2);
  });
  it('experiment management is blocked during a lesson', async () => {
    const exps = useExperimentsStore();
    await exps.init();
    exps.suspended = true;
    await expect(exps.createExperiment('x')).rejects.toThrow(/lesson/);
    await expect(exps.takeSnapshot('x')).rejects.toThrow(/lesson/);
    expect(() => exps.exportJson([exps.currentId])).toThrow(/lesson/);
  });
});
