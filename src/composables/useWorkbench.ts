import { computed, shallowRef, watch } from 'vue';
import { resolveData, type ResolvedData, type VariantEvaluation } from '@/labs/workbench';
import { plainClone } from '@/state/clone';
import type { WorkbenchState } from '@/state/schema';
import { encodeJson } from '@/state/validate';
import { runCompute } from '@/workers/client';

/**
 * Resolves the data source and evaluates every enabled variant, in a Web
 * Worker for large tensors. The data and the evaluations are published
 * together, and results from superseded requests are discarded, so views
 * never mix old results with new data.
 */
export function useWorkbenchEvaluation(state: () => WorkbenchState) {
  const data = shallowRef<ResolvedData | null>(null);
  const dataError = shallowRef<string | null>(null);
  const evaluations = shallowRef<VariantEvaluation[]>([]);
  const computing = shallowRef(false);
  const computeError = shallowRef<string | null>(null);
  let token = 0;

  // encodeJson keeps NaN, ±∞ and −0 distinct (JSON.stringify would not).
  const sourceKey = computed(() => encodeJson(state().source));
  const variantsKey = computed(() => encodeJson(state().variants.filter((v) => v.enabled).map((v) => ({ id: v.id, config: v.config }))));

  let pending: ResolvedData | null = null;
  watch(
    sourceKey,
    () => {
      try {
        pending = resolveData(plainClone(state().source));
        dataError.value = null;
      } catch (e) {
        pending = null;
        dataError.value = (e as Error).message;
      }
    },
    { immediate: true },
  );

  let timer: ReturnType<typeof setTimeout> | null = null;
  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, 60);
  }
  async function run() {
    const d = pending;
    const my = ++token;
    if (!d) {
      data.value = null;
      evaluations.value = [];
      return;
    }
    computing.value = true;
    const variants = state()
      .variants.filter((v) => v.enabled)
      .map((v) => ({ id: v.id, config: plainClone(v.config) }));
    try {
      const result = await runCompute({ kind: 'workbench', data: d.data, shape: d.shape, variants }, d.data.length * Math.max(1, variants.length));
      if (my !== token) return;
      // Publish data and results in the same tick.
      data.value = d;
      evaluations.value = result;
      computeError.value = null;
    } catch (e) {
      if (my !== token) return;
      computeError.value = (e as Error).message;
    } finally {
      if (my === token) computing.value = false;
    }
  }
  watch([sourceKey, variantsKey], schedule, { immediate: true });

  return { data, dataError, evaluations, computing, computeError };
}

/** Stable colour slot for a variant derived from its id ("v3" → slot 2). */
export function variantSlot(id: string): number {
  const m = /(\d+)$/.exec(id);
  return m ? (Number(m[1]) - 1) % 8 : 0;
}
