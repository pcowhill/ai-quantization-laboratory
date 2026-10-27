/**
 * Local persistence of experiments in IndexedDB (never uploaded anywhere).
 * Falls back to an in-memory store when IndexedDB is unavailable (private
 * windows, tests); the UI reports that work will not survive a reload.
 */
import { encodeJson } from './validate';
import type { Experiment } from './schema';

const DB_NAME = 'ai-quantization-laboratory';
const DB_VERSION = 1;
const STORE = 'experiments';
const META = 'meta';

export interface ExperimentStorage {
  readonly persistent: boolean;
  list(): Promise<unknown[]>;
  put(e: Experiment): Promise<void>;
  remove(id: string): Promise<void>;
  getMeta(key: string): Promise<unknown>;
  setMeta(key: string, value: unknown): Promise<void>;
}

/** Experiments are stored as JSON text so NaN/±Inf/−0 in data survive. */
function serialize(e: Experiment): string {
  return encodeJson(e);
}

class MemoryStorage implements ExperimentStorage {
  readonly persistent = false;
  private items = new Map<string, string>();
  private meta = new Map<string, unknown>();
  async list() {
    return [...this.items.values()].map((s) => JSON.parse(s) as unknown);
  }
  async put(e: Experiment) {
    this.items.set(e.id, serialize(e));
  }
  async remove(id: string) {
    this.items.delete(id);
  }
  async getMeta(key: string) {
    return this.meta.get(key);
  }
  async setMeta(key: string, value: unknown) {
    this.meta.set(key, value);
  }
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

class IndexedDbStorage implements ExperimentStorage {
  readonly persistent = true;
  constructor(private readonly db: IDBDatabase) {}
  private tx(store: string, mode: IDBTransactionMode) {
    return this.db.transaction(store, mode).objectStore(store);
  }
  async list() {
    const rows = await req(this.tx(STORE, 'readonly').getAll());
    return (rows as { id: string; json: string }[]).map((r) => JSON.parse(r.json) as unknown);
  }
  async put(e: Experiment) {
    await req(this.tx(STORE, 'readwrite').put({ id: e.id, json: serialize(e) }));
  }
  async remove(id: string) {
    await req(this.tx(STORE, 'readwrite').delete(id));
  }
  async getMeta(key: string) {
    const r = (await req(this.tx(META, 'readonly').get(key))) as { key: string; value: unknown } | undefined;
    return r?.value;
  }
  async setMeta(key: string, value: unknown) {
    await req(this.tx(META, 'readwrite').put({ key, value }));
  }
}

export async function openStorage(): Promise<ExperimentStorage> {
  if (typeof indexedDB === 'undefined') return new MemoryStorage();
  try {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, DB_VERSION);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'key' });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.onblocked = () => reject(new Error('IndexedDB blocked'));
    });
    return new IndexedDbStorage(db);
  } catch {
    return new MemoryStorage();
  }
}

export function createMemoryStorage(): ExperimentStorage {
  return new MemoryStorage();
}
