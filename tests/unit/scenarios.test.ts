/** The curated network scenarios must actually demonstrate what they claim. */
import { describe, expect, it } from 'vitest';
import { applyScenario } from '@/data/networkScenarios';
import { evaluateNetwork } from '@/labs/network';

const run = (id: string) => {
  const st = applyScenario(id);
  const e = evaluateNetwork(st);
  expect(e.variants.every((v) => v.error === null)).toBe(true);
  return Object.fromEntries(e.summaries.map((s) => [s.id, s]));
};

describe('network scenarios demonstrate their stated effects', () => {
  it('negligible: W8A8 keeps every prediction', () => {
    expect(run('negligible').n1!.agreement).toBe(1);
  });
  it('significant: INT4 per-tensor flips many spiral points; groups recover', () => {
    const r = run('significant');
    expect(r.n1!.agreement).toBeLessThan(0.93);
    expect(r.n2!.agreement).toBeGreaterThan(r.n1!.agreement + 0.05);
  });
  it('propagation: error grows from the first to the last layer', () => {
    const le = run('propagation').n1!.layerErrors;
    expect(le.at(-1)!.relError).toBeGreaterThan(3 * le[0]!.relError);
  });
  it('outlier: per-channel beats per-tensor', () => {
    const r = run('outlier');
    expect(r.n2!.agreement).toBeGreaterThan(r.n1!.agreement);
    expect(r.n2!.meanAbsOutputDiff).toBeLessThan(r.n1!.meanAbsOutputDiff / 5);
  });
  it('groups: group-wise has the lowest layer error', () => {
    const r = run('groups');
    expect(r.n3!.layerErrors[0]!.relError).toBeLessThan(r.n2!.layerErrors[0]!.relError);
    expect(r.n2!.layerErrors[0]!.relError).toBeLessThan(r.n1!.layerErrors[0]!.relError);
  });
  it('weights vs activations: activation quantization is the damaging one', () => {
    const r = run('weights-vs-activations');
    expect(r.n1!.agreement).toBeGreaterThan(0.98);
    expect(r.n2!.agreement).toBeLessThan(0.8);
  });
  it('formats: E4M3 has lower output error than E5M2; FP4 is worst', () => {
    const r = run('formats');
    expect(r.n2!.meanAbsOutputDiff).toBeLessThan(r.n3!.meanAbsOutputDiff);
    expect(r.n4!.meanAbsOutputDiff).toBeGreaterThan(r.n2!.meanAbsOutputDiff);
  });
  it('mx: both stay close to the baseline (as the scenario text states)', () => {
    const r = run('mx');
    expect(r.n1!.agreement).toBeGreaterThan(0.95);
    expect(r.n2!.agreement).toBeGreaterThan(0.95);
  });
});
