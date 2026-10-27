/**
 * Runs compute tasks in a Web Worker when available (falling back to the
 * main thread, e.g. in tests or very old browsers). Small tasks run inline
 * to avoid messaging overhead.
 */
import { runTask, type TaskRequest, type TaskResult } from './tasks';

let worker: Worker | null = null;
let workerFailed = false;
let nextId = 1;
const pending = new Map<number, { resolve: (r: TaskResult) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (workerFailed || typeof Worker === 'undefined') return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./compute.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; result?: TaskResult; error?: string }>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data.result!);
      else p.reject(new Error(e.data.error));
    };
    worker.onerror = () => {
      workerFailed = true;
      for (const [, p] of pending) p.reject(new Error('Background worker failed'));
      pending.clear();
      worker = null;
    };
    return worker;
  } catch {
    workerFailed = true;
    return null;
  }
}

export const INLINE_THRESHOLD = 8192;

export function runCompute(task: TaskRequest, size: number): Promise<TaskResult> {
  const w = size > INLINE_THRESHOLD ? getWorker() : null;
  if (!w) {
    try {
      return Promise.resolve(runTask(task));
    } catch (e) {
      return Promise.reject(e as Error);
    }
  }
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, task });
  });
}
