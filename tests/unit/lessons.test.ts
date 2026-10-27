import { describe, expect, it } from 'vitest';
import { LESSONS } from '@/lessons';
import { defaultExperimentState } from '@/state/defaults';
import { encodeJson, validateState } from '@/state/validate';

describe('guided lessons', () => {
  it('there are at least eight lessons with unique ids', () => {
    expect(LESSONS.length).toBeGreaterThanOrEqual(8);
    expect(new Set(LESSONS.map((l) => l.id)).size).toBe(LESSONS.length);
  });
  for (const lesson of LESSONS) {
    it(`${lesson.title}: every step leaves a valid state and every task is solvable`, () => {
      const s = defaultExperimentState();
      lesson.steps.forEach((step, i) => {
        step.setup?.(s);
        const v = validateState(JSON.parse(encodeJson(s)));
        expect(v.errors, `step ${i + 1} setup`).toEqual([]);
        if (step.task) {
          expect(step.task.check(s), `task in step ${i + 1} should not start solved`).toBe(false);
          step.task.solve(s);
          expect(step.task.check(s), `task in step ${i + 1} solution`).toBe(true);
          expect(validateState(JSON.parse(encodeJson(s))).errors, `step ${i + 1} after solving`).toEqual([]);
        }
      });
    });
  }
});

import { roundString } from '@/engine/float/rational';
import { FLOAT_FORMATS } from '@/engine/formats/registry';
import { evaluateMatrix, errorSplit } from '@/labs/matrix';
import { evaluateVariants, resolveData } from '@/labs/workbench';
import { makeQuantConfig } from '@/engine/quant/types';
import { DATASETS } from '@/data/datasets';
import { MATRIX_PRESETS } from '@/data/matrixPresets';
import { defaultMatrix } from '@/state/schema';

describe('numerical claims made in lesson and help text', () => {
  const r = (f: keyof typeof FLOAT_FORMATS, x: string) => roundString(FLOAT_FORMATS[f], x, { mode: 'nearest-even', overflow: 'nonsaturate' });
  it('format examples', () => {
    expect(r('fp8_e4m3', '300')).toBe(288);
    expect(r('fp8_e5m2', '300')).toBe(320);
    expect(r('fp16', '70000')).toBe(Infinity);
    expect(r('bf16', '70000')).toBe(70144);
    expect(r('bf16', '1.001')).toBe(1);
    expect(r('fp16', '1.001')).toBe(1.0009765625);
    expect(r('fp16', '0.1')).toBe(0.0999755859375);
    expect(r('fp8_e5m2', '0.1')).toBe(0.09375);
    expect(r('fp4_e2m1', '5')).toBe(4);
    expect(r('fp8_e4m3', '1000')).toBeNaN();
  });
  it('asymmetric INT4 beats symmetric INT4 on ReLU data; INT8 is far better still', () => {
    const d = resolveData(DATASETS.find((x) => x.id === 'relu')!.source);
    const [sym, asym, asym8] = evaluateVariants(d.data, d.shape, [
      { id: 'a', config: makeQuantConfig({ format: 'int4' }) },
      { id: 'b', config: makeQuantConfig({ format: 'int4', scheme: 'asymmetric' }) },
      { id: 'c', config: makeQuantConfig({ format: 'int8', scheme: 'asymmetric' }) },
    ]);
    expect(asym!.metrics!.mse).toBeLessThan(sym!.metrics!.mse);
    expect(sym!.result!.q.every((q) => q >= 0)).toBe(true);
    expect(asym!.metrics!.mse / asym8!.metrics!.mse).toBeGreaterThan(100);
  });
  it('FP8 GEMM preset: storage error dominates arithmetic error', () => {
    const e = evaluateMatrix({ ...defaultMatrix(), ...MATRIX_PRESETS.find((p) => p.id === 'fp8-gemm')!.apply() });
    let st = 0;
    let ar = 0;
    for (let k = 0; k < e.simulated.length; k++) {
      const s = errorSplit(e, k);
      st += Math.abs(s.storage);
      ar += Math.abs(s.arithmetic);
    }
    expect(st).toBeGreaterThan(100 * ar);
  });
  it('stagnation preset: FP16 sequential stalls, pairwise and FP32 do far better', () => {
    const base = { ...defaultMatrix(), ...MATRIX_PRESETS.find((p) => p.id === 'stagnation')!.apply() };
    const err = (arith: Partial<typeof base.arith>) => Math.abs(errorSplit(evaluateMatrix({ ...base, arith: { ...base.arith, ...arith } }), 0).total);
    const seq = err({});
    expect(seq).toBeGreaterThan(1000); // stalls near 2048 instead of ≈4096
    expect(err({ order: 'pairwise' })).toBeLessThan(seq / 10);
    expect(err({ accumulatorFormat: 'fp32' })).toBeLessThan(seq / 10);
  });
});
