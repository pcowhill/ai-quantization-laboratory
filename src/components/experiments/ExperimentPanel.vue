<script setup lang="ts">
/**
 * Experiment management: the current experiment (name, notes, snapshots,
 * resets), the saved library (switch, duplicate, branch, delete, export,
 * import) and a side-by-side comparison of any two experiments or snapshots.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import ConfirmButton from '@/components/common/ConfirmButton.vue';
import Drawer from '@/components/common/Drawer.vue';
import Icon from '@/components/common/Icon.vue';
import Segmented from '@/components/common/Segmented.vue';
import { diffStates, summarizeResults, type ResultSummary } from '@/labs/compare';
import { LABS, type Experiment, type ExperimentState } from '@/state/schema';
import { useExperimentsStore } from '@/stores/experiments';
import { useLabStore } from '@/stores/lab';
import { useUiStore } from '@/stores/ui';
import { db, fmt, pct, plural } from '@/ui/format';

const ui = useUiStore();
const exps = useExperimentsStore();
const lab = useLabStore();

type Tab = 'current' | 'library' | 'compare';
const tab = ref<Tab>('current');
const tabs: { value: Tab; label: string }[] = [
  { value: 'current', label: 'Current' },
  { value: 'library', label: 'All experiments' },
  { value: 'compare', label: 'Compare' },
];
const locked = computed(() => exps.suspended);
/** True while an asynchronous action runs; blocks double submission. */
const busy = ref(false);
const blocked = computed(() => locked.value || busy.value);

function when(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}
function nameOf(id: string | null) {
  return id ? (exps.experiments.find((e) => e.id === id)?.name ?? 'a deleted experiment') : null;
}

/** Runs a store action and reports failures as a toast instead of an unhandled rejection. */
async function act(fn: () => unknown, success?: string) {
  if (busy.value) return;
  busy.value = true;
  try {
    await fn();
    if (success) ui.toast(success, 'success');
  } catch (e) {
    ui.toast((e as Error).message, 'error');
  } finally {
    busy.value = false;
  }
}

// ------------------------------------------------------------ current
const nameDraft = ref('');
const notesDraft = ref('');
const snapName = ref('');
watch(
  () => exps.currentId,
  () => {
    const e = exps.current;
    nameDraft.value = e?.name ?? '';
    notesDraft.value = e?.notes ?? '';
  },
  { immediate: true },
);
// Drafts are committed shortly after typing stops, on change/blur, when the panel
// closes and when the page is hidden or closed, so nothing typed is lost.
function commitName(final = true) {
  const e = exps.current;
  if (!e || exps.suspended) return;
  if (!nameDraft.value.trim()) {
    if (final) nameDraft.value = e.name;
  } else if (nameDraft.value.trim() !== e.name) void exps.rename(e.id, nameDraft.value);
}
function commitNotes() {
  const e = exps.current;
  if (e && !exps.suspended && notesDraft.value !== e.notes) void exps.setNotes(e.id, notesDraft.value);
}
let draftTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleDrafts() {
  if (draftTimer) clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    draftTimer = null;
    commitName(false);
    commitNotes();
  }, 500);
}
function flushDrafts() {
  if (draftTimer) clearTimeout(draftTimer);
  draftTimer = null;
  commitName(false);
  commitNotes();
}
function onHidden() {
  if (document.visibilityState === 'hidden') flushDrafts();
}
onMounted(() => {
  document.addEventListener('visibilitychange', onHidden);
  window.addEventListener('pagehide', flushDrafts);
});
onBeforeUnmount(() => {
  flushDrafts();
  document.removeEventListener('visibilitychange', onHidden);
  window.removeEventListener('pagehide', flushDrafts);
});
async function snapshot() {
  await act(async () => {
    const s = await exps.takeSnapshot(snapName.value);
    if (s) ui.toast(`Snapshot “${s.name}” saved`, 'success');
  });
  snapName.value = '';
}

// ------------------------------------------------------------ library
const selected = ref<string[]>([]);
const allSelected = computed(() => exps.experiments.length > 0 && selected.value.length === exps.experiments.length);
function toggleAll() {
  selected.value = allSelected.value ? [] : exps.experiments.map((e) => e.id);
}
watch(
  () => exps.experiments.map((e) => e.id),
  (ids) => (selected.value = selected.value.filter((id) => ids.includes(id))),
);

function safeFileName(s: string) {
  return s.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'experiment';
}
function download(ids: string[], name: string) {
  void act(() => {
    const text = exps.exportJson(ids);
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeFileName(name)}.aql.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, `Exported ${plural(ids.length, 'experiment')}`);
}

const importErrors = ref<string[]>([]);
const fileInput = ref<HTMLInputElement | null>(null);
async function onImportFile(ev: Event) {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  importErrors.value = [];
  if (file.size > 64 * 1024 * 1024) {
    importErrors.value = ['The file is larger than 64 MB and was not read.'];
    return;
  }
  await act(async () => {
    const { imported, errors } = await exps.importJson(await file.text());
    importErrors.value = errors;
    if (imported.length) ui.toast(`Imported ${plural(imported.length, 'experiment')}; now showing “${imported[0]!.name}”`, 'success');
  });
}

// ------------------------------------------------------------ compare
interface Source {
  key: string;
  label: string;
  state: () => ExperimentState;
}
const sources = computed<Source[]>(() => {
  const out: Source[] = [];
  for (const e of exps.experiments) {
    const isCur = e.id === exps.currentId;
    out.push({ key: e.id, label: `${e.name}${isCur ? ' (current)' : ''}`, state: () => (isCur ? lab.snapshot() : e.state) });
    for (const s of e.snapshots) out.push({ key: `${e.id}/${s.id}`, label: `${e.name} › ${s.name}`, state: () => s.state });
  }
  return out;
});
const keyA = ref('');
const keyB = ref('');
watch(
  sources,
  (list) => {
    const has = (k: string) => list.some((s) => s.key === k);
    if (!has(keyA.value)) keyA.value = exps.currentId;
    if (!has(keyB.value) || keyB.value === keyA.value) keyB.value = list.find((s) => s.key !== keyA.value)?.key ?? keyA.value;
  },
  { immediate: true },
);

interface Comparison {
  labelA: string;
  labelB: string;
  diff: ReturnType<typeof diffStates>;
  a: ResultSummary;
  b: ResultSummary;
}
const comparison = ref<Comparison | null>(null);
const comparing = ref(false);
const compareError = ref('');
watch([keyA, keyB], () => (comparison.value = null));
function runCompare() {
  const A = sources.value.find((s) => s.key === keyA.value);
  const B = sources.value.find((s) => s.key === keyB.value);
  if (!A || !B) return;
  comparing.value = true;
  compareError.value = '';
  // Let the "Comparing…" state paint before the (synchronous) evaluation.
  setTimeout(() => {
    try {
      const sa = A.state();
      const sb = B.state();
      comparison.value = { labelA: A.label, labelB: B.label, diff: diffStates(sa, sb), a: summarizeResults(sa), b: summarizeResults(sb) };
    } catch (e) {
      compareError.value = (e as Error).message;
    } finally {
      comparing.value = false;
    }
  }, 20);
}

/** Pairs rows by name; repeated names are paired by occurrence (1st with 1st, 2nd with 2nd). */
function byName<T extends { name: string }>(a: T[], b: T[]) {
  const keyed = (list: T[]) => {
    const seen = new Map<string, number>();
    return list.map((x) => {
      const n = (seen.get(x.name) ?? 0) + 1;
      seen.set(x.name, n);
      return { key: `${x.name}\u0000${n}`, label: n > 1 ? `${x.name} (${n})` : x.name, x };
    });
  };
  const ka = keyed(a);
  const kb = keyed(b);
  const keys = [...new Set([...ka.map((k) => k.key), ...kb.map((k) => k.key)])];
  return keys.map((key) => {
    const ea = ka.find((k) => k.key === key);
    const eb = kb.find((k) => k.key === key);
    return { key, name: (ea ?? eb)!.label, a: ea?.x ?? null, b: eb?.x ?? null };
  });
}
const wbRows = computed(() => (comparison.value ? byName(comparison.value.a.workbench, comparison.value.b.workbench) : []));
const nnRows = computed(() => (comparison.value ? byName(comparison.value.a.network, comparison.value.b.network) : []));

function matrixText(m: ResultSummary['matrix']) {
  if (m.error) return m.error;
  const base = m.finite > 0 ? `max |error| ${fmt(m.maxError, 4)} · RMSE ${fmt(m.rmse, 4)} over ${m.finite} finite outputs` : 'no finite outputs';
  return m.nonFinite > 0 ? `${base}; ${plural(m.nonFinite, 'output')} non-finite (overflow or NaN)` : base;
}

function parentLabel(e: Experiment) {
  const p = nameOf(e.parentId);
  return p ? `from ${p}` : '';
}
</script>

<template>
  <Drawer title="Experiments" width="680px" test-id="experiments" @close="ui.experimentsOpen = false">
    <div class="stack">
      <Segmented v-model="tab" :options="tabs" label="Experiment panel section" />

      <div v-if="locked" class="callout callout-warning" role="status">
        A guided lesson is running. Its laboratory state is temporary, so experiments cannot be changed or compared until you exit the lesson (your experiment is restored then).
      </div>
      <div v-if="!exps.persistent" class="callout callout-warning" role="status" data-testid="memory-only">
        This browser does not allow local storage for this page (for example in a private window), so experiments last only until the page is closed. Export them to keep them.
      </div>
      <div v-for="(w, i) in exps.loadWarnings" :key="i" class="callout callout-critical" role="alert">{{ w }}</div>

      <!-- ===================================================== current -->
      <template v-if="tab === 'current' && exps.current">
        <section class="card">
          <div class="card-body stack">
            <div class="field">
              <label for="exp-name">Name</label>
              <input id="exp-name" v-model="nameDraft" class="input" maxlength="200" data-testid="exp-name" :disabled="blocked" @input="scheduleDrafts" @change="commitName()" @keydown.enter="commitName()" />
            </div>
            <div class="muted small">
              Created {{ when(exps.current.createdAt) }} · last saved {{ when(exps.current.updatedAt) }}
              <template v-if="exps.current.parentId"> · branched {{ parentLabel(exps.current) }}</template>
            </div>
            <div class="field">
              <label for="exp-notes">Notes</label>
              <textarea id="exp-notes" v-model="notesDraft" class="input notes" rows="4" maxlength="20000" placeholder="What are you testing? What did you observe?" :disabled="blocked" @input="scheduleDrafts" @change="commitNotes" @blur="commitNotes" />
            </div>
            <div class="row">
              <button type="button" class="btn btn-sm" :disabled="blocked" data-testid="exp-duplicate" @click="act(() => exps.duplicate(exps.currentId), 'Duplicated; now editing the copy')"><Icon name="copy" :size="13" /> Duplicate</button>
              <button type="button" class="btn btn-sm" :disabled="blocked" data-testid="exp-branch" @click="act(() => exps.branch(exps.currentId), 'Branched; now editing the branch')"><Icon name="branch" :size="13" /> Branch</button>
              <button type="button" class="btn btn-sm" :disabled="blocked" @click="download([exps.currentId], exps.current.name)"><Icon name="download" :size="13" /> Export JSON</button>
            </div>
          </div>
        </section>

        <section class="card">
          <header class="card-header"><h3>Snapshots</h3><span class="muted small">Named, read-only copies of all four laboratories</span></header>
          <div class="card-body stack">
            <form class="row" @submit.prevent="snapshot">
              <label class="visually-hidden" for="snap-name">Snapshot name</label>
              <input id="snap-name" v-model="snapName" class="input grow" maxlength="200" :placeholder="`Snapshot ${exps.current.snapshots.length + 1}`" :disabled="blocked" />
              <button type="submit" class="btn btn-primary btn-sm" :disabled="blocked" data-testid="take-snapshot"><Icon name="camera" :size="13" /> Take snapshot</button>
            </form>
            <p v-if="!exps.current.snapshots.length" class="muted small">No snapshots yet. Take one before trying something risky — you can restore it, branch from it or compare against it.</p>
            <ul v-else class="list" data-testid="snapshot-list">
              <li v-for="s in [...exps.current.snapshots].reverse()" :key="s.id" class="item">
                <div class="item-main">
                  <div class="item-title">{{ s.name }}</div>
                  <div class="muted small">{{ when(s.createdAt) }} · {{ LABS.find((l) => l.id === s.state.lab)?.name }}</div>
                </div>
                <ConfirmButton small :disabled="blocked" label="Restore" confirm-label="Replace current state?" title="Replace the current laboratories with this snapshot (undoable)" :test-id="`restore-${s.id}`" @confirm="act(() => exps.restoreSnapshot(s.id), `Restored “${s.name}” (Ctrl+Z undoes)`)"
                  ><Icon name="restore" :size="13"
                /></ConfirmButton>
                <button type="button" class="btn btn-sm" :disabled="blocked" title="New experiment starting from this snapshot" @click="act(() => exps.branch(exps.currentId, s.id), 'Branched from snapshot')"><Icon name="branch" :size="13" /> Branch</button>
                <ConfirmButton small :disabled="blocked" label="Delete" confirm-label="Delete snapshot?" :test-id="`delete-snap-${s.id}`" @confirm="act(() => exps.deleteSnapshot(s.id))"><Icon name="trash" :size="13" /></ConfirmButton>
              </li>
            </ul>
          </div>
        </section>

        <section class="card">
          <header class="card-header"><h3>Reset</h3><span class="muted small">Only this experiment; Ctrl+Z undoes a reset</span></header>
          <div class="card-body row">
            <ConfirmButton v-for="l in LABS" :key="l.id" small :disabled="blocked" :label="l.short" :confirm-label="`Reset ${l.short}?`" :title="`Reset the ${l.name} to its defaults`" :test-id="`reset-${l.id}`" @confirm="act(() => exps.resetLab(l.id), `${l.name} reset`)"
              ><Icon name="reset" :size="13"
            /></ConfirmButton>
            <span class="spacer" />
            <ConfirmButton small :disabled="blocked" label="All laboratories" confirm-label="Reset all four?" test-id="reset-all" @confirm="act(() => exps.resetAllLabs(), 'All laboratories reset')"><Icon name="reset" :size="13" /></ConfirmButton>
          </div>
        </section>
      </template>

      <!-- ===================================================== library -->
      <template v-else-if="tab === 'library'">
        <div class="row">
          <button type="button" class="btn btn-primary btn-sm" :disabled="blocked" data-testid="exp-new" @click="act(() => exps.createExperiment(), 'New experiment created')"><Icon name="plus" :size="13" /> New experiment</button>
          <button type="button" class="btn btn-sm" :disabled="blocked" data-testid="exp-import" @click="fileInput?.click()"><Icon name="upload" :size="13" /> Import JSON…</button>
          <input ref="fileInput" type="file" accept=".json,application/json" class="visually-hidden" tabindex="-1" aria-hidden="true" data-testid="exp-import-file" @change="onImportFile" />
          <span class="spacer" />
          <button type="button" class="btn btn-sm" :disabled="blocked || !selected.length" data-testid="exp-export-selected" @click="download(selected, selected.length === 1 ? (nameOf(selected[0]!) ?? 'experiment') : 'experiments')">
            <Icon name="download" :size="13" /> Export selected ({{ selected.length }})
          </button>
        </div>
        <div v-if="importErrors.length" class="callout callout-critical" role="alert" data-testid="import-errors">
          <div>
            The file was not imported:
            <ul class="errors">
              <li v-for="(e, i) in importErrors.slice(0, 12)" :key="i">{{ e }}</li>
              <li v-if="importErrors.length > 12">… and {{ importErrors.length - 12 }} more problems</li>
            </ul>
          </div>
        </div>
        <p class="muted small">Experiments are stored only in this browser. Nothing is uploaded; export a JSON file to back up or share one.</p>
        <div class="row small">
          <label class="check"><input type="checkbox" :checked="allSelected" @change="toggleAll" /> Select all</label>
          <span class="muted">{{ plural(exps.experiments.length, 'experiment') }}</span>
        </div>
        <ul class="list" data-testid="experiment-list">
          <li v-for="e in exps.experiments" :key="e.id" class="item" :class="{ current: e.id === exps.currentId }">
            <input v-model="selected" type="checkbox" :value="e.id" :aria-label="`Select ${e.name}`" />
            <div class="item-main">
              <div class="item-title">
                {{ e.name }}
                <span v-if="e.id === exps.currentId" class="badge badge-accent">current</span>
              </div>
              <div class="muted small">
                {{ when(e.updatedAt) }} · {{ plural(e.snapshots.length, 'snapshot') }}<template v-if="e.parentId"> · {{ parentLabel(e) }}</template>
              </div>
              <div v-if="e.notes" class="note small">{{ e.notes.length > 140 ? `${e.notes.slice(0, 140)}…` : e.notes }}</div>
            </div>
            <button v-if="e.id !== exps.currentId" type="button" class="btn btn-sm" :disabled="blocked" :data-testid="`open-${e.id}`" @click="act(() => exps.switchTo(e.id))">Open</button>
            <button type="button" class="btn btn-sm btn-icon" :disabled="blocked" title="Duplicate" :aria-label="`Duplicate ${e.name}`" @click="act(() => exps.duplicate(e.id), 'Duplicated')"><Icon name="copy" :size="13" /></button>
            <button type="button" class="btn btn-sm btn-icon" :disabled="blocked" title="Branch" :aria-label="`Branch ${e.name}`" @click="act(() => exps.branch(e.id), 'Branched')"><Icon name="branch" :size="13" /></button>
            <ConfirmButton small :disabled="blocked" label="" confirm-label="Delete?" :title="`Delete ${e.name}`" :test-id="`delete-${e.id}`" @confirm="act(() => exps.remove(e.id), `Deleted “${e.name}”`)"><Icon name="trash" :size="13" /></ConfirmButton>
          </li>
        </ul>
      </template>

      <!-- ===================================================== compare -->
      <template v-else-if="tab === 'compare'">
        <p class="muted small">Compare the settings and key results of any two experiments or snapshots. The current experiment is compared with its live (unsaved) state.</p>
        <p v-if="sources.length < 2" class="callout" data-testid="compare-hint">There is only one state to compare. Take a snapshot or create another experiment first; until then A and B are the same.</p>
        <div class="compare-pick">
          <div class="field">
            <label for="cmp-a">A</label>
            <select id="cmp-a" v-model="keyA" class="select" data-testid="compare-a">
              <option v-for="s in sources" :key="s.key" :value="s.key">{{ s.label }}</option>
            </select>
          </div>
          <div class="field">
            <label for="cmp-b">B</label>
            <select id="cmp-b" v-model="keyB" class="select" data-testid="compare-b">
              <option v-for="s in sources" :key="s.key" :value="s.key">{{ s.label }}</option>
            </select>
          </div>
          <button type="button" class="btn btn-primary" :disabled="locked || comparing || !keyA || !keyB" data-testid="compare-run" @click="runCompare"><Icon name="compare" :size="14" /> {{ comparing ? 'Comparing…' : 'Compare' }}</button>
        </div>
        <div v-if="compareError" class="callout callout-critical" role="alert">{{ compareError }}</div>
        <div v-if="comparison" class="stack" data-testid="compare-result">
          <section>
            <h3>Key results</h3>
            <div class="table-wrap">
              <table class="table">
                <thead>
                  <tr><th>Laboratory</th><th>A · {{ comparison.labelA }}</th><th>B · {{ comparison.labelB }}</th></tr>
                </thead>
                <tbody>
                  <tr><th>Number Inspector</th><td class="mono wrap">{{ comparison.a.inspector }}</td><td class="mono wrap">{{ comparison.b.inspector }}</td></tr>
                  <tr><th>Workbench data</th><td>{{ comparison.a.workbenchData }}</td><td>{{ comparison.b.workbenchData }}</td></tr>
                  <tr v-for="r in wbRows" :key="`wb-${r.key}`">
                    <th>Variant “{{ r.name }}”</th>
                    <td class="nums">{{ r.a ? `MSE ${fmt(r.a.mse, 4)} · SNR ${db(r.a.snr)} · ${fmt(r.a.bits, 4)} bits/elem` : '—' }}</td>
                    <td class="nums">{{ r.b ? `MSE ${fmt(r.b.mse, 4)} · SNR ${db(r.b.snr)} · ${fmt(r.b.bits, 4)} bits/elem` : '—' }}</td>
                  </tr>
                  <tr>
                    <th>Matrix result</th>
                    <td class="nums">{{ matrixText(comparison.a.matrix) }}</td>
                    <td class="nums">{{ matrixText(comparison.b.matrix) }}</td>
                  </tr>
                  <tr>
                    <th>Network baseline accuracy</th>
                    <td class="num">{{ pct(comparison.a.networkBaselineAccuracy) }}</td>
                    <td class="num">{{ pct(comparison.b.networkBaselineAccuracy) }}</td>
                  </tr>
                  <tr v-for="r in nnRows" :key="`nn-${r.key}`">
                    <th>Network “{{ r.name }}”</th>
                    <td class="nums">{{ r.a ? `agreement ${pct(r.a.agreement)} · accuracy ${pct(r.a.accuracy)}` : '—' }}</td>
                    <td class="nums">{{ r.b ? `agreement ${pct(r.b.agreement)} · accuracy ${pct(r.b.accuracy)}` : '—' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
          <section>
            <h3>Settings that differ ({{ comparison.diff.entries.length }}{{ comparison.diff.truncated ? '+' : '' }})</h3>
            <p v-if="!comparison.diff.entries.length" class="muted small" data-testid="compare-identical">The two states are identical.</p>
            <div v-else class="table-wrap diff" tabindex="0" role="region" aria-label="Settings that differ">
              <table class="table" data-testid="compare-diff">
                <thead>
                  <tr><th>Setting</th><th>A</th><th>B</th></tr>
                </thead>
                <tbody>
                  <tr v-for="d in comparison.diff.entries" :key="d.path">
                    <td class="mono">{{ d.path }}</td>
                    <td class="mono wrap">{{ d.a }}</td>
                    <td class="mono wrap">{{ d.b }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-if="comparison.diff.truncated" class="muted small">Only the first {{ comparison.diff.entries.length }} differences are listed.</p>
          </section>
        </div>
      </template>
    </div>
  </Drawer>
</template>

<style scoped>
h3 {
  margin: 0 0 6px;
  font-size: 13px;
}
.card-header h3 {
  margin: 0;
}
.notes {
  resize: vertical;
  min-height: 70px;
  font-family: inherit;
}
.grow {
  flex: 1;
  min-width: 140px;
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
.item.current {
  border-color: var(--accent);
  background: var(--accent-softer);
}
.item-main {
  flex: 1;
  min-width: 0;
}
.item-title {
  font-weight: 600;
  overflow-wrap: anywhere;
  display: flex;
  align-items: center;
  gap: 6px;
}
.note {
  color: var(--text-2);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  margin-top: 2px;
}
.errors {
  margin: 4px 0 0;
  padding-left: 20px;
}
.compare-pick {
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  gap: 8px;
  align-items: end;
}
.compare-pick .select {
  width: 100%;
}
.nums {
  font-variant-numeric: tabular-nums;
}
.wrap {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.diff {
  max-height: 360px;
  overflow: auto;
}
.diff td:first-child {
  max-width: 240px;
  overflow-wrap: anywhere;
}
@media (max-width: 560px) {
  .compare-pick {
    grid-template-columns: 1fr;
  }
  .item {
    flex-wrap: wrap;
  }
}
</style>
