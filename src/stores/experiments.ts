/**
 * Experiment management: the saved experiment list, the current experiment,
 * snapshots, duplication/branching, undo/redo history, local persistence and
 * JSON import/export.
 */
import { defineStore } from 'pinia';
import { computed, ref, shallowRef, watch } from 'vue';
import { plainClone } from '@/state/clone';
import { defaultExperimentState } from '@/state/defaults';
import { openStorage, type ExperimentStorage } from '@/state/persistence';
import type { Experiment, ExperimentState, LabId } from '@/state/schema';
import { encodeJson, makeExperimentFile, parseExperimentFile, validateExperiment, validateState } from '@/state/validate';
import { useLabStore } from './lab';

const HISTORY_LIMIT = 200;
const HISTORY_DEBOUNCE_MS = 350;
const SAVE_DEBOUNCE_MS = 600;

export function newId(prefix = 'e'): string {
  const rnd = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${rnd}`;
}

function now(): string {
  return new Date().toISOString();
}

export const useExperimentsStore = defineStore('experiments', () => {
  const lab = useLabStore();
  const experiments = ref<Experiment[]>([]);
  const currentId = ref<string>('');
  const ready = ref(false);
  const persistent = ref(false);
  const loadWarnings = ref<string[]>([]);
  /** While true (e.g. during a guided lesson) state changes are not saved to the current experiment. */
  const suspended = ref(false);
  const storage = shallowRef<ExperimentStorage | null>(null);

  // Undo/redo history of serialized states for the current experiment.
  const past = ref<string[]>([]);
  const future = ref<string[]>([]);
  let lastSerialized = '';
  let applyingHistory = false;
  let historyTimer: ReturnType<typeof setTimeout> | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  const current = computed(() => experiments.value.find((e) => e.id === currentId.value) ?? null);
  const canUndo = computed(() => past.value.length > 0);
  const canRedo = computed(() => future.value.length > 0);

  function serializeState(): string {
    return encodeJson(lab.snapshot());
  }

  function resetHistory() {
    past.value = [];
    future.value = [];
    lastSerialized = serializeState();
  }

  function recordHistory() {
    const s = serializeState();
    if (s === lastSerialized) return;
    past.value.push(lastSerialized);
    if (past.value.length > HISTORY_LIMIT) past.value.shift();
    future.value = [];
    lastSerialized = s;
  }

  /** Flushes a pending history entry immediately (e.g. before undo). */
  function flushHistory() {
    if (historyTimer) {
      clearTimeout(historyTimer);
      historyTimer = null;
      recordHistory();
    }
  }

  function restoreSerialized(s: string) {
    const { state, errors } = parseStateText(s);
    if (errors.length) throw new Error(errors.join('; '));
    applyingHistory = true;
    lab.replace(state);
    lastSerialized = s;
    queueMicrotask(() => (applyingHistory = false));
    scheduleSave();
  }

  function undo() {
    flushHistory();
    const prev = past.value.pop();
    if (prev === undefined) return;
    future.value.push(lastSerialized);
    restoreSerialized(prev);
  }

  function redo() {
    const next = future.value.pop();
    if (next === undefined) return;
    past.value.push(lastSerialized);
    restoreSerialized(next);
  }

  watch(
    () => lab.state,
    () => {
      if (applyingHistory || !ready.value) return;
      if (historyTimer) clearTimeout(historyTimer);
      historyTimer = setTimeout(() => {
        historyTimer = null;
        recordHistory();
      }, HISTORY_DEBOUNCE_MS);
      scheduleSave();
    },
    { deep: true },
  );

  function scheduleSave() {
    if (suspended.value) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void saveCurrent();
    }, SAVE_DEBOUNCE_MS);
  }

  async function persist(e: Experiment) {
    try {
      await storage.value?.put(plainClone(e));
    } catch (err) {
      console.error('Failed to save experiment', err);
    }
  }

  async function saveCurrent() {
    if (suspended.value) return;
    const e = current.value;
    if (!e) return;
    e.state = lab.snapshot();
    e.updatedAt = now();
    await persist(e);
  }

  function makeExperiment(name: string, state: ExperimentState, parentId: string | null = null): Experiment {
    const t = now();
    return { id: newId(), name, createdAt: t, updatedAt: t, parentId, notes: '', state: plainClone(state), snapshots: [] };
  }

  async function init() {
    storage.value = await openStorage();
    persistent.value = storage.value.persistent;
    const raw = await storage.value.list();
    const loaded: Experiment[] = [];
    const warnings: string[] = [];
    for (const r of raw) {
      const { experiment, errors } = validateExperiment(r);
      if (errors.length) warnings.push(`A saved experiment could not be loaded (${errors[0]}${errors.length > 1 ? ` and ${errors.length - 1} more problems` : ''}). It was left untouched in storage.`);
      else loaded.push(experiment);
    }
    loaded.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    experiments.value = loaded;
    loadWarnings.value = warnings;
    const lastId = (await storage.value.getMeta('currentId')) as string | undefined;
    let target = loaded.find((e) => e.id === lastId) ?? loaded[0];
    if (!target) {
      target = makeExperiment('Untitled experiment', defaultExperimentState());
      experiments.value.push(target);
      await persist(target);
    }
    currentId.value = target.id;
    lab.replace(target.state);
    resetHistory();
    ready.value = true;
  }

  async function switchTo(id: string) {
    if (id === currentId.value) return;
    flushHistory();
    await saveCurrent();
    const e = experiments.value.find((x) => x.id === id);
    if (!e) return;
    currentId.value = id;
    applyingHistory = true;
    lab.replace(e.state);
    queueMicrotask(() => (applyingHistory = false));
    resetHistory();
    await storage.value?.setMeta('currentId', id);
  }

  async function createExperiment(name = 'Untitled experiment', state?: ExperimentState, parentId: string | null = null) {
    await saveCurrent();
    const e = makeExperiment(name, state ?? defaultExperimentState(), parentId);
    experiments.value.unshift(e);
    await persist(e);
    await switchTo(e.id);
    return e;
  }

  async function duplicate(id: string) {
    await saveCurrent();
    const src = experiments.value.find((e) => e.id === id);
    if (!src) return null;
    const e = makeExperiment(`${src.name} (copy)`, src.state, src.parentId);
    e.notes = src.notes;
    e.snapshots = plainClone(src.snapshots).map((s) => ({ ...s, id: newId('s') }));
    experiments.value.unshift(e);
    await persist(e);
    await switchTo(e.id);
    return e;
  }

  /** Branch: a new experiment whose parent is `id`, starting from its current state or one of its snapshots. */
  async function branch(id: string, snapshotId?: string, name?: string) {
    await saveCurrent();
    const src = experiments.value.find((e) => e.id === id);
    if (!src) return null;
    const snap = snapshotId ? src.snapshots.find((s) => s.id === snapshotId) : undefined;
    const e = makeExperiment(name ?? `${src.name} › ${snap ? snap.name : 'branch'}`, snap ? snap.state : src.state, src.id);
    experiments.value.unshift(e);
    await persist(e);
    await switchTo(e.id);
    return e;
  }

  async function rename(id: string, name: string) {
    const e = experiments.value.find((x) => x.id === id);
    const trimmed = name.trim();
    if (!e || !trimmed) return;
    e.name = trimmed.slice(0, 200);
    e.updatedAt = now();
    await persist(e);
  }

  async function setNotes(id: string, notes: string) {
    const e = experiments.value.find((x) => x.id === id);
    if (!e) return;
    e.notes = notes.slice(0, 20000);
    await persist(e);
  }

  /** Deletes one experiment (never more than one at a time). */
  async function remove(id: string) {
    const idx = experiments.value.findIndex((e) => e.id === id);
    if (idx < 0) return;
    const wasCurrent = id === currentId.value;
    experiments.value.splice(idx, 1);
    await storage.value?.remove(id);
    if (wasCurrent) {
      const next = experiments.value[0];
      if (next) {
        currentId.value = '';
        await switchTo(next.id);
      } else {
        await createExperiment();
      }
    }
  }

  async function takeSnapshot(name: string) {
    const e = current.value;
    if (!e) return null;
    const snap = { id: newId('s'), name: name.trim() || `Snapshot ${e.snapshots.length + 1}`, createdAt: now(), state: lab.snapshot() };
    e.snapshots.push(snap);
    await saveCurrent();
    return snap;
  }

  /** Restores a snapshot into the current experiment (undoable). */
  function restoreSnapshot(snapshotId: string) {
    const snap = current.value?.snapshots.find((s) => s.id === snapshotId);
    if (!snap) return;
    flushHistory();
    lab.replace(snap.state);
  }

  async function deleteSnapshot(snapshotId: string) {
    const e = current.value;
    if (!e) return;
    e.snapshots = e.snapshots.filter((s) => s.id !== snapshotId);
    await saveCurrent();
  }

  /** Resets only the given laboratory of the current experiment (undoable). */
  function resetLab(labId: LabId) {
    flushHistory();
    lab.resetLab(labId);
  }

  function exportJson(ids: string[]): string {
    const list = experiments.value.filter((e) => ids.includes(e.id)).map((e) => (e.id === currentId.value ? { ...e, state: lab.snapshot() } : e));
    return encodeJson(makeExperimentFile(plainClone(list)), 2);
  }

  async function importJson(text: string): Promise<{ imported: Experiment[]; errors: string[] }> {
    const { experiments: parsed, errors } = parseExperimentFile(text);
    if (errors.length) return { imported: [], errors };
    const existing = new Set(experiments.value.map((e) => e.id));
    const imported: Experiment[] = [];
    for (const p of parsed) {
      const e = plainClone(p);
      if (existing.has(e.id)) {
        e.id = newId();
        e.name = `${e.name} (imported)`;
      }
      experiments.value.unshift(e);
      imported.push(e);
      await persist(e);
    }
    if (imported[0]) await switchTo(imported[0].id);
    return { imported, errors: [] };
  }

  return {
    experiments,
    currentId,
    current,
    ready,
    persistent,
    loadWarnings,
    suspended,
    canUndo,
    canRedo,
    init,
    undo,
    redo,
    flushHistory,
    resetHistory,
    saveCurrent,
    switchTo,
    createExperiment,
    duplicate,
    branch,
    rename,
    setNotes,
    remove,
    takeSnapshot,
    restoreSnapshot,
    deleteSnapshot,
    resetLab,
    exportJson,
    importJson,
  };
});

/** Decodes a history entry (encodeJson text) back into a validated state. */
function parseStateText(s: string): { state: ExperimentState; errors: string[] } {
  return validateState(JSON.parse(s) as unknown);
}
