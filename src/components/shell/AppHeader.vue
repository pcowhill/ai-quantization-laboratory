<script setup lang="ts">
import { computed } from 'vue';
import { LABS, type LabId } from '@/state/schema';
import { useExperimentsStore } from '@/stores/experiments';
import { useLabStore } from '@/stores/lab';
import { useUiStore } from '@/stores/ui';
import { useLessonsStore } from '@/stores/lessons';
import Icon from '@/components/common/Icon.vue';

const lab = useLabStore();
const exps = useExperimentsStore();
const ui = useUiStore();
const lessons = useLessonsStore();

const themeLabel = computed(() => ({ system: 'Theme: system', light: 'Theme: light', dark: 'Theme: dark' })[ui.themePref]);
const themeIcon = computed(() => (({ system: 'monitor', light: 'sun', dark: 'moon' }) as const)[ui.themePref]);

function selectLab(id: LabId) {
  lab.setLab(id);
}

function onTabKey(e: KeyboardEvent, index: number) {
  const n = LABS.length;
  let next = -1;
  if (e.key === 'ArrowRight') next = (index + 1) % n;
  else if (e.key === 'ArrowLeft') next = (index - 1 + n) % n;
  else if (e.key === 'Home') next = 0;
  else if (e.key === 'End') next = n - 1;
  if (next >= 0) {
    e.preventDefault();
    selectLab(LABS[next]!.id);
    document.getElementById(`tab-${LABS[next]!.id}`)?.focus();
  }
}
</script>

<template>
  <header class="app-header">
    <div class="brand">
      <svg class="logo" viewBox="0 0 32 32" aria-hidden="true">
        <rect x="2" y="2" width="28" height="28" rx="7" fill="var(--accent)" />
        <path d="M8 22 V10 M12 22 V14 M16 22 V8 M20 22 V16 M24 22 V12" stroke="var(--text-on-accent)" stroke-width="2.4" stroke-linecap="round" />
      </svg>
      <div class="brand-text">
        <span class="brand-name">AI Quantization Laboratory</span>
        <span v-if="lessons.active" class="brand-sub">Guided lesson in progress</span>
      </div>
    </div>

    <nav class="tabs" role="tablist" aria-label="Laboratories">
      <button
        v-for="(l, i) in LABS"
        :id="`tab-${l.id}`"
        :key="l.id"
        role="tab"
        type="button"
        class="tab"
        :class="{ active: lab.state.lab === l.id }"
        :aria-selected="lab.state.lab === l.id"
        :aria-controls="`panel-${l.id}`"
        :tabindex="lab.state.lab === l.id ? 0 : -1"
        :title="`${l.name} — ${l.question} (Alt+${i + 1})`"
        @click="selectLab(l.id)"
        @keydown="onTabKey($event, i)"
      >
        <span class="tab-num" aria-hidden="true">{{ i + 1 }}</span>
        <span class="tab-full">{{ l.name }}</span>
        <span class="tab-short">{{ l.short }}</span>
      </button>
    </nav>

    <div class="actions">
      <button type="button" class="btn btn-ghost exp-btn" data-testid="open-experiments" :title="'Experiments: ' + (exps.current?.name ?? '')" @click="ui.experimentsOpen = true">
        <Icon name="folder" />
        <span class="exp-name">{{ exps.current?.name ?? 'Experiment' }}</span>
      </button>
      <button type="button" class="btn btn-ghost btn-icon" :disabled="!exps.canUndo" title="Undo (Ctrl+Z)" aria-label="Undo" data-testid="undo" @click="exps.undo()"><Icon name="undo" /></button>
      <button type="button" class="btn btn-ghost btn-icon" :disabled="!exps.canRedo" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" data-testid="redo" @click="exps.redo()"><Icon name="redo" /></button>
      <button type="button" class="btn" data-testid="open-lessons" aria-label="Guided lessons" title="Guided lessons" @click="ui.lessonsOpen = true">
        <Icon name="cap" /><span class="hide-sm">Lessons</span>
      </button>
      <button type="button" class="btn btn-ghost btn-icon" :title="themeLabel" :aria-label="themeLabel" data-testid="theme-toggle" @click="ui.cycleTheme()"><Icon :name="themeIcon" /></button>
      <button type="button" class="btn btn-ghost btn-icon" title="About & help" aria-label="About and help" @click="ui.helpOpen = true"><Icon name="help" /></button>
    </div>
  </header>
</template>

<style scoped>
.app-header {
  position: sticky;
  top: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  gap: 16px;
  height: var(--header-h);
  padding: 0 14px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
.brand {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
}
.logo {
  width: 28px;
  height: 28px;
  flex: none;
}
.brand-text {
  display: flex;
  flex-direction: column;
  line-height: 1.15;
}
.brand-name {
  font-weight: 650;
  font-size: 14.5px;
  white-space: nowrap;
}
.brand-sub {
  font-size: 11px;
  color: var(--accent);
  font-weight: 600;
}
.tabs {
  display: flex;
  gap: 2px;
  height: 100%;
  margin-left: 8px;
}
.tab {
  display: flex;
  align-items: center;
  gap: 7px;
  border: none;
  background: none;
  padding: 0 12px;
  font-size: 13.5px;
  font-weight: 500;
  color: var(--text-2);
  cursor: pointer;
  border-bottom: 2.5px solid transparent;
  border-top: 2.5px solid transparent;
  white-space: nowrap;
}
.tab:hover {
  color: var(--text);
  background: var(--surface-2);
}
.tab.active {
  color: var(--accent-strong);
  border-bottom-color: var(--accent);
  font-weight: 600;
}
.tab-num {
  display: inline-grid;
  place-items: center;
  width: 19px;
  height: 19px;
  border-radius: 5px;
  font-size: 11px;
  font-weight: 700;
  background: var(--surface-3);
  color: var(--text-2);
}
.tab.active .tab-num {
  background: var(--accent);
  color: var(--text-on-accent);
}
.tab-short {
  display: none;
}
.actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 4px;
}
.exp-btn {
  max-width: 220px;
}
.exp-name {
  overflow: hidden;
  text-overflow: ellipsis;
}
@media (max-width: 1480px) {
  .tab-full {
    display: none;
  }
  .tab-short {
    display: inline;
  }
}
@media (max-width: 900px) {
  .brand-name {
    display: none;
  }
  .exp-btn {
    max-width: 120px;
  }
  .hide-sm {
    display: none;
  }
  .tabs {
    margin-left: 0;
  }
  .app-header {
    gap: 8px;
  }
}
@media (max-width: 640px) {
  .app-header {
    height: auto;
    flex-wrap: wrap;
    padding: 6px 10px;
  }
  .tabs {
    order: 3;
    width: 100%;
    height: 40px;
    overflow-x: auto;
  }
}
</style>
