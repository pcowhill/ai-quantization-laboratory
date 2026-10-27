<script setup lang="ts">
import { defineAsyncComponent, h, onBeforeUnmount, onMounted, type Component } from 'vue';
import AsyncState from '@/components/common/AsyncState.vue';
import AppHeader from '@/components/shell/AppHeader.vue';
import { LABS } from '@/state/schema';
import { useExperimentsStore } from '@/stores/experiments';
import { useLabStore } from '@/stores/lab';
import { useLessonsStore } from '@/stores/lessons';
import { useUiStore } from '@/stores/ui';
import { applyUpdate, dismissUpdate, setBeforeReload, updateReady } from '@/pwa/register';

/** Lazily loaded component with a loading placeholder and a visible load error. */
function lazy(loader: () => Promise<{ default: Component }>) {
  return defineAsyncComponent({ loader, delay: 150, loadingComponent: AsyncState, errorComponent: () => h(AsyncState, { failed: true }) });
}

const NumberInspector = lazy(() => import('@/components/inspector/NumberInspector.vue'));
const QuantWorkbench = lazy(() => import('@/components/workbench/QuantWorkbench.vue'));
const MatrixLab = lazy(() => import('@/components/matrix/MatrixLab.vue'));
const NetworkLab = lazy(() => import('@/components/network/NetworkLab.vue'));
const ExperimentPanel = lazy(() => import('@/components/experiments/ExperimentPanel.vue'));
const LessonPanel = lazy(() => import('@/components/lessons/LessonPanel.vue'));
const LessonCatalog = lazy(() => import('@/components/lessons/LessonCatalog.vue'));
const HelpDialog = lazy(() => import('@/components/shell/HelpDialog.vue'));

const lab = useLabStore();
const exps = useExperimentsStore();
const ui = useUiStore();
const lessons = useLessonsStore();

function isEditable(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

function onKey(e: KeyboardEvent) {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && !isEditable(e.target)) {
    if (e.key.toLowerCase() === 'z' && !e.shiftKey) {
      e.preventDefault();
      exps.undo();
    } else if ((e.key.toLowerCase() === 'z' && e.shiftKey) || e.key.toLowerCase() === 'y') {
      e.preventDefault();
      exps.redo();
    }
  }
  if (e.altKey && !mod && /^[1-4]$/.test(e.key)) {
    e.preventDefault();
    lab.setLab(LABS[Number(e.key) - 1]!.id);
  }
  if (e.key === 'Escape') {
    ui.experimentsOpen = false;
    ui.lessonsOpen = false;
    ui.helpOpen = false;
  }
}

/** Saves pending edits; used before a version-change reload and when the page is hidden or closed. */
async function savePending() {
  if (!exps.ready) return;
  exps.flushHistory();
  await exps.saveCurrent();
}
setBeforeReload(savePending);

function reloadForUpdate() {
  void applyUpdate();
}

function onVisibility() {
  if (document.visibilityState === 'hidden') void savePending();
}

onMounted(() => {
  void exps.init();
  window.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', savePending);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
  document.removeEventListener('visibilitychange', onVisibility);
  window.removeEventListener('pagehide', savePending);
});
</script>

<template>
  <div class="app" :class="{ 'with-lesson': !!lessons.active }">
    <a class="skip-link" href="#main">Skip to laboratory</a>
    <AppHeader />
    <div class="app-body">
      <main id="main" class="lab-main" tabindex="-1">
        <div v-if="!exps.ready" class="loading" role="status">Loading experiments…</div>
        <template v-else>
          <div v-for="l in LABS" v-show="lab.state.lab === l.id" :id="`panel-${l.id}`" :key="l.id" role="tabpanel" :aria-labelledby="`tab-${l.id}`" class="lab-panel">
            <NumberInspector v-if="l.id === 'inspector' && lab.state.lab === 'inspector'" />
            <QuantWorkbench v-if="l.id === 'workbench' && lab.state.lab === 'workbench'" />
            <MatrixLab v-if="l.id === 'matrix' && lab.state.lab === 'matrix'" />
            <NetworkLab v-if="l.id === 'network' && lab.state.lab === 'network'" />
          </div>
        </template>
      </main>
      <LessonPanel v-if="lessons.active" />
    </div>
    <ExperimentPanel v-if="ui.experimentsOpen" />
    <LessonCatalog v-if="ui.lessonsOpen" />
    <HelpDialog v-if="ui.helpOpen" />
    <div v-if="updateReady" class="update-bar" role="status" data-testid="update-ready">
      A new version of the laboratory is available. Your experiments are kept.
      <button type="button" class="btn btn-sm btn-primary" @click="reloadForUpdate">Reload now</button>
      <button type="button" class="btn btn-sm btn-ghost" @click="dismissUpdate">Later</button>
    </div>
    <div class="toasts" aria-live="polite">
      <div v-for="t in ui.toasts" :key="t.id" class="toast" :class="t.kind" role="status">{{ t.text }}</div>
    </div>
  </div>
</template>

<style scoped>
.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
.app-body {
  flex: 1;
  display: flex;
  min-height: 0;
}
.lab-main {
  flex: 1;
  min-width: 0;
  outline: none;
}
.lab-panel {
  height: 100%;
}
.loading {
  padding: 40px;
  color: var(--text-3);
}
.skip-link {
  position: absolute;
  left: -999px;
  top: 4px;
  z-index: 100;
  background: var(--surface);
  padding: 6px 10px;
  border-radius: var(--radius);
}
.skip-link:focus {
  left: 8px;
}
.update-bar {
  position: fixed;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  z-index: 210;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  max-width: calc(100vw - 32px);
  padding: 8px 10px 8px 14px;
  border-radius: var(--radius);
  background: var(--surface);
  border: 1px solid var(--accent);
  box-shadow: var(--shadow-2);
  font-size: 13px;
}
.toasts {
  position: fixed;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  gap: 6px;
  z-index: 200;
}
.toast {
  padding: 8px 14px;
  border-radius: var(--radius);
  background: var(--text);
  color: var(--surface);
  font-size: 13px;
  box-shadow: var(--shadow-2);
  max-width: 560px;
}
.toast.error {
  background: var(--critical);
  color: var(--text-on-critical);
}
.toast.success {
  background: var(--accent);
  color: var(--text-on-accent);
}
</style>
