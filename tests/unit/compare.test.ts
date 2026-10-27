import { describe, expect, it } from 'vitest';
import { diffStates, summarizeResults } from '@/labs/compare';
import { defaultExperimentState } from '@/state/defaults';

describe('experiment comparison', () => {
  it('identical states have no differences', () => {
    expect(diffStates(defaultExperimentState(), defaultExperimentState()).entries).toEqual([]);
  });
  it('lists changed settings by path, including special values', () => {
    const a = defaultExperimentState();
    const b = defaultExperimentState();
    b.inspector.input = '-0';
    b.workbench.variants[0]!.config.format = 'int4';
    b.matrix.scalar = Number.NaN;
    const { entries, truncated } = diffStates(a, b);
    expect(truncated).toBe(false);
    const paths = entries.map((e) => e.path);
    expect(paths).toContain('inspector.input');
    expect(paths).toContain('workbench.variants[0].config.format');
    expect(entries.find((e) => e.path === 'matrix.scalar')?.b).toBe('"NaN"');
    expect(entries.find((e) => e.path === 'workbench.variants[0].config.format')?.b).toBe('"int4"');
  });
  it('compares long numeric arrays as a whole with a fingerprint', () => {
    const a = defaultExperimentState();
    const b = defaultExperimentState();
    b.matrix.A = { rows: 1, cols: 20, values: Array.from({ length: 20 }, (_, i) => i) };
    a.matrix.A = { rows: 1, cols: 20, values: Array.from({ length: 20 }, (_, i) => (i === 7 ? 99 : i)) };
    const e = diffStates(a, b).entries.find((x) => x.path === 'matrix.A.values');
    expect(e?.a).toMatch(/^\[20 values, fingerprint [0-9a-f]{8}\]$/);
    expect(e?.a).not.toBe(e?.b);
  });
  it('truncates long diffs', () => {
    const a = defaultExperimentState();
    const b = defaultExperimentState();
    b.inspector.input = '12345.678';
    b.inspector.format = 'fp8_e5m2';
    const r = diffStates(a, b, 1);
    expect(r.entries).toHaveLength(1);
    expect(r.truncated).toBe(true);
  });
  it('summarizes results of every laboratory', () => {
    const s = summarizeResults(defaultExperimentState());
    expect(s.inspector).toContain('→');
    expect(s.workbench.length).toBeGreaterThan(0);
    for (const v of s.workbench) expect(v.mse).not.toBeNull();
    expect(Number.isFinite(s.matrix.rmse)).toBe(true);
    expect(s.network.length).toBeGreaterThan(0);
    expect(s.networkBaselineAccuracy).not.toBeNull();
  });
});
