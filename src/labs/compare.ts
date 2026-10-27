/**
 * Experiment comparison: a settings diff and key results per laboratory.
 */
import { getFormat } from '@/engine/formats/registry';
import { evaluateMatrix } from '@/labs/matrix';
import { evaluateNetwork } from '@/labs/network';
import { inspect } from '@/labs/inspector';
import { evaluateVariants, resolveData } from '@/labs/workbench';
import type { ExperimentState } from '@/state/schema';
import { encodeJson } from '@/state/validate';

export interface DiffEntry {
  path: string;
  a: string;
  b: string;
}

function summarizeValue(v: unknown): string {
  if (Array.isArray(v) && v.length > 8 && v.every((x) => typeof x === 'number' || typeof x === 'string')) {
    // Long numeric arrays (data, weights) are compared as a whole and shown compactly.
    let h = 2166136261;
    const s = encodeJson(v);
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
    return `[${v.length} values, fingerprint ${h.toString(16).padStart(8, '0')}]`;
  }
  if (v === null || typeof v !== 'object') return encodeJson(v);
  return '';
}

function flatten(v: unknown, path: string, out: Map<string, string>) {
  const summary = summarizeValue(v);
  if (summary || v === null || typeof v !== 'object') {
    out.set(path, summary || encodeJson(v));
    return;
  }
  if (Array.isArray(v)) {
    v.forEach((x, i) => flatten(x, `${path}[${i}]`, out));
    if (v.length === 0) out.set(path, '[]');
    return;
  }
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) flatten(x, path ? `${path}.${k}` : k, out);
}

/** Lists every setting that differs between two states. */
export function diffStates(a: ExperimentState, b: ExperimentState, limit = 300): { entries: DiffEntry[]; truncated: boolean } {
  const fa = new Map<string, string>();
  const fb = new Map<string, string>();
  flatten(a, '', fa);
  flatten(b, '', fb);
  const keys = [...new Set([...fa.keys(), ...fb.keys()])].sort();
  const entries: DiffEntry[] = [];
  for (const k of keys) {
    const x = fa.get(k) ?? '(absent)';
    const y = fb.get(k) ?? '(absent)';
    if (x !== y) entries.push({ path: k, a: x, b: y });
  }
  return { entries: entries.slice(0, limit), truncated: entries.length > limit };
}

export interface ResultSummary {
  inspector: string;
  workbench: { name: string; mse: number | null; snr: number | null; bits: number | null }[];
  workbenchData: string;
  matrix: { maxError: number; rmse: number };
  network: { name: string; agreement: number | null; accuracy: number | null }[];
  networkBaselineAccuracy: number | null;
}

/** Key results of every laboratory for one experiment state. */
export function summarizeResults(s: ExperimentState): ResultSummary {
  const ins = inspect(s.inspector);
  const inspector = ins.primary ? `${ins.inputExact ?? '(bits)'} → ${ins.primary.shortest} in ${getFormat(s.inspector.format).name} (abs. error ${ins.primary.absError ?? '—'})` : (ins.error ?? '—');
  let workbench: ResultSummary['workbench'] = [];
  let workbenchData = '';
  try {
    const d = resolveData(s.workbench.source);
    workbenchData = `${d.shape[0]}×${d.shape[1]} ${d.label}`;
    const ev = evaluateVariants(d.data, d.shape, s.workbench.variants.filter((v) => v.enabled));
    workbench = s.workbench.variants
      .filter((v) => v.enabled)
      .map((v, i) => ({ name: v.name, mse: ev[i]?.metrics?.mse ?? null, snr: ev[i]?.metrics?.snrDb ?? null, bits: ev[i]?.storage?.bitsPerElement ?? null }));
  } catch (e) {
    workbenchData = (e as Error).message;
  }
  const m = evaluateMatrix(s.matrix);
  const n = evaluateNetwork(s.network);
  return {
    inspector,
    workbench,
    workbenchData,
    matrix: { maxError: m.metrics.maxAbs, rmse: m.metrics.rmse },
    network: s.network.variants
      .filter((v) => v.enabled)
      .map((v) => {
        const x = n.summaries.find((y) => y.id === v.id);
        return { name: v.name, agreement: x?.agreement ?? null, accuracy: x?.accuracy ?? null };
      }),
    networkBaselineAccuracy: n.baselineAccuracy,
  };
}
