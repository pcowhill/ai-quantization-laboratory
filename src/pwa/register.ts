/**
 * Service-worker registration, update prompt and a verified offline status.
 *
 * Offline readiness is reported only after the worker confirms that every
 * precached file is actually present in its cache — registration alone does
 * not make the app work offline.
 */
import { ref } from 'vue';

export interface OfflineStatus {
  state: 'unsupported' | 'development' | 'installing' | 'ready' | 'incomplete' | 'error';
  version?: string;
  cached?: number;
  total?: number;
  message?: string;
}

/** True when a new version has been downloaded and is waiting to take over. */
export const updateReady = ref(false);
let waiting: ServiceWorker | null = null;
let reloading = false;

export function dismissUpdate() {
  updateReady.value = false;
}

export function applyUpdate() {
  if (!waiting) return;
  reloading = true;
  waiting.postMessage({ type: 'skip-waiting' });
}

function watchForWaiting(reg: ServiceWorkerRegistration) {
  const offer = (w: ServiceWorker | null) => {
    // Only an update (an existing controller) needs a prompt; the first install activates by itself.
    if (w && navigator.serviceWorker.controller) {
      waiting = w;
      updateReady.value = true;
    }
  };
  offer(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const w = reg.installing;
    w?.addEventListener('statechange', () => {
      if (w.state === 'installed') offer(w);
    });
  });
}

export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) window.location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .then((reg) => {
        watchForWaiting(reg);
        // Check for a new deployment hourly while the app stays open.
        setInterval(() => void reg.update().catch(() => undefined), 60 * 60 * 1000);
      })
      .catch((e: unknown) => console.warn('Service worker registration failed', e));
  });
}

/** Asks the active worker how many precached files are in its cache. */
export async function offlineStatus(): Promise<OfflineStatus> {
  if (!import.meta.env.PROD) return { state: 'development' };
  if (!('serviceWorker' in navigator)) return { state: 'unsupported' };
  const reg = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
  const active = reg?.active;
  if (!active) return { state: 'installing' };
  try {
    const reply = await new Promise<{ version: string; cached: number; total: number }>((resolve, reject) => {
      const ch = new MessageChannel();
      const t = setTimeout(() => reject(new Error('The service worker did not answer.')), 5000);
      ch.port1.onmessage = (e) => {
        clearTimeout(t);
        resolve(e.data as { version: string; cached: number; total: number });
      };
      active.postMessage({ type: 'status' }, [ch.port2]);
    });
    return { state: reply.cached === reply.total ? 'ready' : 'incomplete', ...reply };
  } catch (e) {
    return { state: 'error', message: (e as Error).message };
  }
}
