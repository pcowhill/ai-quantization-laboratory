/// <reference lib="webworker" />
/**
 * Background computation so large experiments never block the UI thread.
 * Every task is a pure function of its inputs (see src/labs/*).
 */
import { runTask, type TaskRequest } from './tasks';

self.onmessage = (e: MessageEvent<{ id: number; task: TaskRequest }>) => {
  const { id, task } = e.data;
  try {
    const result = runTask(task);
    (self as unknown as Worker).postMessage({ id, ok: true, result });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: (err as Error).message });
  }
};
