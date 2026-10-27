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

/** Experiment and snapshot names are limited to 200 characters (schema limit). */
export function clampName(name: string): string {
  const t = name.trim();
  return t.length <= 200 ? t : `${t.slice(0, 199)}…`;
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
    lab.replace(state);
    lastSerialized = s;
    scheduleSave();
  }

  /**
   * Moves one step through the history. The stacks change only after the
   * target state has been restored, so an unreadable entry leaves them
   * consistent; such an entry is discarded (it could never be restored).
   */
  function step(from: typeof past, to: typeof future) {
    flushHistory();
    const target = from.value[from.value.length - 1];
    if (target === undefined) return;
    const cur = lastSerialized;
    try {
      restoreSerialized(target);
    } catch (e) {
      from.value.pop();
      console.error('Discarded an unreadable history entry', e);
      return;
    }
    from.value.pop();
    to.value.push(cur);
  }

  function undo() {
    step(past, future);
  }

  function redo() {
    // A pending (not yet recorded) edit supersedes the redo stack (flushHistory clears it).
    step(future, past);
  }

  watch(
    () => lab.state,
    () => {
      // No guard for undo/redo restores is needed: recordHistory() ignores a
      // state identical to the last recorded one, so only real edits are recorded.
      if (!ready.value) return;
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
    return { id: newId(), name: clampName(name), createdAt: t, updatedAt: t, parentId, notes: '', state: plainClone(state), snapshots: [] };
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

  /** Experiment management is unavailable while a lesson is running (its state is temporary). */
  function assertNotInLesson() {
    if (suspended.value) throw new Error('Exit the guided lesson first: its laboratory state is temporary.');
  }

  async function switchTo(id: string) {
    if (id === currentId.value) return;
    assertNotInLesson();
    flushHistory();
    await saveCurrent();
    const e = experiments.value.find((x) => x.id === id);
    if (!e) return;
    currentId.value = id;
    lab.replace(e.state);
    resetHistory();
    await storage.value?.setMeta('currentId', id);
  }

  async function createExperiment(name = 'Untitled experiment', state?: ExperimentState, parentId: string | null = null) {
    assertNotInLesson();
    await saveCurrent();
    const e = makeExperiment(name, state ?? defaultExperimentState(), parentId);
    experiments.value.unshift(e);
    await persist(e);
    await switchTo(e.id);
    return e;
  }

  async function duplicate(id: string) {
    assertNotInLesson();
    await saveCurrent();
    const src = experiments.value.find((e) => e.id === id);
    if (!src) return null;
    const e = makeExperiment(`${src.name} (copy)`, src.state, src.id);
    e.notes = src.notes;
    e.snapshots = plainClone(src.snapshots).map((s) => ({ ...s, id: newId('s') }));
    experiments.value.unshift(e);
    await persist(e);
    await switchTo(e.id);
    return e;
  }

  /** Branch: a new experiment whose parent is `id`, starting from its current state or one of its snapshots. */
  async function branch(id: string, snapshotId?: string, name?: string) {
    assertNotInLesson();
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
    assertNotInLesson();
    const e = experiments.value.find((x) => x.id === id);
    const trimmed = name.trim();
    if (!e || !trimmed) return;
    e.name = trimmed.slice(0, 200);
    e.updatedAt = now();
    await persist(e);
  }

  async function setNotes(id: string, notes: string) {
    assertNotInLesson();
    const e = experiments.value.find((x) => x.id === id);
    if (!e) return;
    e.notes = notes.slice(0, 20000);
    await persist(e);
  }

  /** Deletes one experiment (never more than one at a time). */
  async function remove(id: string) {
    assertNotInLesson();
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
    assertNotInLesson();
    const e = current.value;
    if (!e) return null;
    const snap = { id: newId('s'), name: clampName(name.trim() || `Snapshot ${e.snapshots.length + 1}`), createdAt: now(), state: lab.snapshot() };
    e.snapshots.push(snap);
    await saveCurrent();
    return snap;
  }

  /** Restores a snapshot into the current experiment (undoable). */
  function restoreSnapshot(snapshotId: string) {
    assertNotInLesson();
    const snap = current.value?.snapshots.find((s) => s.id === snapshotId);
    if (!snap) return;
    flushHistory();
    lab.replace(snap.state);
  }

  async function deleteSnapshot(snapshotId: string) {
    assertNotInLesson();
    const e = current.value;
    if (!e) return;
    e.snapshots = e.snapshots.filter((s) => s.id !== snapshotId);
    await saveCurrent();
  }

  /** Resets only the given laboratory of the current experiment (undoable). */
  function resetLab(labId: LabId) {
    assertNotInLesson();
    flushHistory();
    lab.resetLab(labId);
  }

  /** Resets every laboratory of the current experiment (undoable); other experiments are untouched. */
  function resetAllLabs() {
    assertNotInLesson();
    flushHistory();
    const keep = lab.state.lab;
    lab.replace({ ...defaultExperimentState(), lab: keep });
  }

  function exportJson(ids: string[]): string {
    assertNotInLesson();
    const list = experiments.value.filter((e) => ids.includes(e.id)).map((e) => (e.id === currentId.value ? { ...e, state: lab.snapshot() } : e));
    return encodeJson(makeExperimentFile(plainClone(list)), 2);
  }

  async function importJson(text: string): Promise<{ imported: Experiment[]; errors: string[] }> {
    assertNotInLesson();
    const { experiments: parsed, errors } = parseExperimentFile(text);
    if (errors.length) return { imported: [], errors };
    const existing = new Set(experiments.value.map((e) => e.id));
    const imported: Experiment[] = [];
    for (const p of parsed) {
      const e = plainClone(p);
      if (existing.has(e.id)) {
        e.id = newId();
        e.name = clampName(`${e.name} (imported)`);
      }
      existing.add(e.id);
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
    resetAllLabs,
    exportJson,
    importJson,
  };
});

/** Decodes a history entry (encodeJson text) back into a validated state. */
function parseStateText(s: string): { state: ExperimentState; errors: string[] } {
  return validateState(JSON.parse(s) as unknown);
}
