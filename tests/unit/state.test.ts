import fc from 'fast-check';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { defaultExperimentState } from '@/state/defaults';
import { decodeNumber, encodeJson, parseExperimentFile, validateExperiment, validateState } from '@/state/validate';
import { useExperimentsStore } from '@/stores/experiments';
import { useLabStore } from '@/stores/lab';

describe('experiment schema validation', () => {
  it('the default state is valid and already in canonical key order', () => {
    const s = encodeJson(defaultExperimentState());
    const r = validateState(JSON.parse(s));
    expect(r.errors).toEqual([]);
    expect(encodeJson(r.state)).toBe(s);
  });
  it('reports precise paths for invalid fields instead of repairing them', () => {
    const s = JSON.parse(encodeJson(defaultExperimentState()));
    s.inspector.format = 'fp7';
    s.workbench.variants[0].config.manualScale = 'abc';
    s.matrix.A.values.push(1);
    s.network.network.layers[0].weights = [1, 2];
    const { errors } = validateState(s);
    expect(errors.some((e) => e.includes('state.inspector.format'))).toBe(true);
    expect(errors.some((e) => e.includes('manualScale'))).toBe(true);
    expect(errors.some((e) => e.includes('state.matrix.A.values'))).toBe(true);
  });
  it('semantic checks: invalid quantization combinations are rejected', () => {
    const s = JSON.parse(encodeJson(defaultExperimentState()));
    s.workbench.variants[0].config.format = 'fp8_e4m3';
    s.workbench.variants[0].config.scheme = 'asymmetric';
    expect(validateState(s).errors.join(' ')).toMatch(/Asymmetric/);
  });
  it('NaN, ±Infinity and −0 survive JSON round trips', () => {
    const s = defaultExperimentState();
    s.workbench.source = { kind: 'manual', rows: 1, cols: 4, values: [NaN, Infinity, -Infinity, -0] };
    const back = validateState(JSON.parse(encodeJson(s)));
    expect(back.errors).toEqual([]);
    const v = (back.state.workbench.source as { values: number[] }).values;
    expect(Number.isNaN(v[0])).toBe(true);
    expect(v[1]).toBe(Infinity);
    expect(v[2]).toBe(-Infinity);
    expect(Object.is(v[3], -0)).toBe(true);
    expect(decodeNumber('1')).toBeUndefined();
  });
  it('serialization is stable: encode → validate → encode is the identity', () => {
    fc.assert(
      fc.property(fc.array(fc.double(), { minLength: 1, maxLength: 40 }), fc.integer({ min: 0, max: 2 ** 32 - 1 }), (values, seed) => {
        const s = defaultExperimentState();
        s.workbench.source = { kind: 'imported', name: 'x.csv', rows: 1, cols: values.length, values };
        s.inspector.seed = seed;
        const once = encodeJson(validateState(JSON.parse(encodeJson(s))).state);
        const r = validateState(JSON.parse(once));
        return r.errors.length === 0 && encodeJson(r.state) === once;
      }),
      { numRuns: 200 },
    );
  });
  it('experiment files: format marker, version and content are checked', () => {
    expect(parseExperimentFile('nope').errors[0]).toMatch(/not valid JSON/);
    expect(parseExperimentFile('{}').errors[0]).toMatch(/not an AI Quantization Laboratory/);
    expect(parseExperimentFile(JSON.stringify({ format: 'ai-quantization-laboratory/experiment', schemaVersion: 99, experiments: [] })).errors[0]).toMatch(/schema version 99/);
    const bad = { id: 'x', name: 'x', createdAt: 'not a date', updatedAt: new Date().toISOString(), parentId: null, notes: '', state: {}, snapshots: [] };
    expect(validateExperiment(bad).errors.length).toBeGreaterThan(1);
  });
});

describe('experiments store', () => {
  beforeEach(() => setActivePinia(createPinia()));

  async function ready() {
    const exps = useExperimentsStore();
    await exps.init();
    return { exps, lab: useLabStore() };
  }
  const tick = () => new Promise((r) => setTimeout(r, 400));

  it('creates a default experiment on first run', async () => {
    const { exps } = await ready();
    expect(exps.experiments).toHaveLength(1);
    expect(exps.persistent).toBe(false); // no IndexedDB in the test environment
  });

  it('undo / redo restore exact states', async () => {
    const { exps, lab } = await ready();
    lab.state.inspector.input = '1/3';
    await tick();
    lab.state.inspector.format = 'bf16';
    await tick();
    expect(exps.canUndo).toBe(true);
    exps.undo();
    expect(lab.state.inspector.format).toBe('fp16');
    expect(lab.state.inspector.input).toBe('1/3');
    exps.undo();
    expect(lab.state.inspector.input).toBe('0.1');
    exps.redo();
    exps.redo();
    expect(lab.state.inspector.format).toBe('bf16');
    expect(exps.canRedo).toBe(false);
  });

  it('snapshots, branching and duplication keep independent states', async () => {
    const { exps, lab } = await ready();
    lab.state.matrix.scalar = 7;
    const snap = await exps.takeSnapshot('seven');
    lab.state.matrix.scalar = 9;
    exps.restoreSnapshot(snap!.id);
    expect(lab.state.matrix.scalar).toBe(7);
    const parent = exps.currentId;
    const b = await exps.branch(parent, snap!.id, 'branch');
    expect(b!.parentId).toBe(parent);
    expect(exps.currentId).toBe(b!.id);
    lab.state.matrix.scalar = 11;
    await exps.saveCurrent();
    await exps.switchTo(parent);
    expect(lab.state.matrix.scalar).toBe(7);
    const d = await exps.duplicate(parent);
    expect(d!.name).toMatch(/copy/);
    expect(exps.experiments).toHaveLength(3);
  });

  it('export → import reproduces the state exactly (deterministic replay)', async () => {
    const { exps, lab } = await ready();
    lab.state.workbench.source = { kind: 'manual', rows: 1, cols: 3, values: [NaN, -0, 1e-320] };
    lab.state.inspector.input = '0x1.8p-3';
    const json = exps.exportJson([exps.currentId]);
    const norm = (x: unknown) => encodeJson(validateState(JSON.parse(encodeJson(x))).state);
    const before = norm(lab.snapshot());
    const { imported, errors } = await exps.importJson(json);
    expect(errors).toEqual([]);
    expect(imported).toHaveLength(1);
    expect(imported[0]!.id).not.toBe(exps.experiments[1]!.id); // id collision renamed
    expect(norm(lab.snapshot())).toBe(before);
  });

  it('reset affects only the chosen laboratory and is undoable', async () => {
    const { exps, lab } = await ready();
    lab.state.inspector.input = '42';
    lab.state.matrix.scalar = 3;
    await tick();
    exps.resetLab('matrix');
    expect(lab.state.matrix.scalar).toBe(0.1);
    expect(lab.state.inspector.input).toBe('42');
    await tick();
    exps.undo();
    expect(lab.state.matrix.scalar).toBe(3);
  });

  it('deleting removes only that experiment', async () => {
    const { exps } = await ready();
    const first = exps.currentId;
    await exps.createExperiment('second');
    expect(exps.experiments).toHaveLength(2);
    await exps.remove(first);
    expect(exps.experiments.map((e) => e.name)).toEqual(['second']);
  });
});
