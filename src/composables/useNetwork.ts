import { computed, shallowRef, watch } from 'vue';
import type { GridResult } from '@/workers/tasks';
import { EVAL_SAMPLE_LIMIT, type NetworkEvaluation } from '@/labs/network';
import { networkPreset } from '@/data/networks';
import { plainClone } from '@/state/clone';
import type { NetworkState } from '@/state/schema';
import { runCompute } from '@/workers/client';

/** Background evaluation of the network laboratory with stale-result protection. */
export function useNetworkEvaluation(state: () => NetworkState) {
  const evaluation = shallowRef<NetworkEvaluation | null>(null);
  const grids = shallowRef<GridResult[]>([]);
  const computing = shallowRef(false);
  const error = shallowRef<string | null>(null);
  let token = 0;
  let gridToken = 0;

  const key = computed(() => JSON.stringify(state()));
  const gridKey = computed(() => {
    const s = state();
    return JSON.stringify({ n: s.network, v: s.variants.filter((v) => v.enabled), samples: s.samples, show: s.showBoundary, preset: s.presetId });
  });

  async function run() {
    const my = ++token;
    computing.value = true;
    try {
      const r = (await runCompute({ kind: 'network-eval', state: plainClone(state()) }, 1e9)) as NetworkEvaluation;
      if (my !== token) return;
      evaluation.value = r;
      error.value = null;
    } catch (e) {
      if (my === token) error.value = (e as Error).message;
    } finally {
      if (my === token) computing.value = false;
    }
  }

  const plotRange = computed(() => {
    const s = state();
    if (s.network.inputSize !== 2) return null;
    try {
      const p = s.presetId ? networkPreset(s.presetId) : null;
      if (p?.plotRange) return p.plotRange;
    } catch {
      /* custom network */
    }
    const xs = s.samples.map((x) => x[0]!);
    const ys = s.samples.map((x) => x[1]!);
    const pad = (a: number[]) => {
      const lo = Math.min(...a);
      const hi = Math.max(...a);
      const d = (hi - lo) * 0.1 || 1;
      return [lo - d, hi + d] as [number, number];
    };
    return { x: pad(xs), y: pad(ys) };
  });

  async function runGrid() {
    const s = state();
    const my = ++gridToken;
    const range = plotRange.value;
    if (!s.showBoundary || !range) {
      grids.value = [];
      return;
    }
    try {
      const r = (await runCompute(
        { kind: 'network-grid', net: plainClone(s.network), variants: plainClone(s.variants.filter((v) => v.enabled)), samples: plainClone(s.samples.slice(0, EVAL_SAMPLE_LIMIT)), range, G: 64 },
        1e9,
      )) as GridResult[];
      if (my === gridToken) grids.value = r;
    } catch (e) {
      if (my === gridToken) error.value = (e as Error).message;
    }
  }

  let t1: ReturnType<typeof setTimeout> | null = null;
  let t2: ReturnType<typeof setTimeout> | null = null;
  watch(key, () => {
    if (t1) clearTimeout(t1);
    t1 = setTimeout(run, 50);
  }, { immediate: true });
  watch(gridKey, () => {
    if (t2) clearTimeout(t2);
    t2 = setTimeout(runGrid, 120);
  }, { immediate: true });

  return { evaluation, grids, computing, error, plotRange };
}
