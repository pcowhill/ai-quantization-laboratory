import { computed, shallowRef, watch } from 'vue';
import { resolveData, type ResolvedData, type VariantEvaluation } from '@/labs/workbench';
import { plainClone } from '@/state/clone';
import type { WorkbenchState } from '@/state/schema';
import { runCompute } from '@/workers/client';

/**
 * Resolves the data source and evaluates every enabled variant, in a Web
 * Worker for large tensors. Results from superseded requests are discarded,
 * so views never show a mix of old and new state.
 */
export function useWorkbenchEvaluation(state: () => WorkbenchState) {
  const data = shallowRef<ResolvedData | null>(null);
  const dataError = shallowRef<string | null>(null);
  const evaluations = shallowRef<VariantEvaluation[]>([]);
  const computing = shallowRef(false);
  const computeError = shallowRef<string | null>(null);
  let token = 0;

  const sourceKey = computed(() => JSON.stringify(state().source));
  watch(
    sourceKey,
    () => {
      try {
        data.value = resolveData(plainClone(state().source));
        dataError.value = null;
      } catch (e) {
        data.value = null;
        dataError.value = (e as Error).message;
      }
    },
    { immediate: true },
  );

  const variantsKey = computed(() => JSON.stringify(state().variants.filter((v) => v.enabled).map((v) => ({ id: v.id, config: v.config }))));
  let timer: ReturnType<typeof setTimeout> | null = null;
  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, 60);
  }
  async function run() {
    const d = data.value;
    const my = ++token;
    if (!d) {
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
      evaluations.value = result;
      computeError.value = null;
    } catch (e) {
      if (my !== token) return;
      computeError.value = (e as Error).message;
    } finally {
      if (my === token) computing.value = false;
    }
  }
  watch([data, variantsKey], schedule, { immediate: true });

  return { data, dataError, evaluations, computing, computeError };
}

/** Stable colour slot for a variant derived from its id ("v3" → slot 2). */
export function variantSlot(id: string): number {
  const m = /(\d+)$/.exec(id);
  return m ? (Number(m[1]) - 1) % 8 : 0;
}
