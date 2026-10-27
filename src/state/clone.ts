import { isProxy, toRaw } from 'vue';

/**
 * Deep copy of plain JSON-like data that may contain Vue reactive proxies
 * (structuredClone cannot clone proxies). Preserves NaN, ±Infinity and −0.
 */
export function plainClone<T>(value: T): T {
  const v = isProxy(value) ? toRaw(value) : value;
  if (Array.isArray(v)) return v.map((x) => plainClone(x)) as T;
  if (v !== null && typeof v === 'object') {
    if (ArrayBuffer.isView(v)) return structuredClone(v);
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = plainClone(x);
    return out as T;
  }
  return v;
}
