/**
 * Guided lessons run on the real laboratories. Starting a lesson saves the
 * current experiment state and suspends autosave; exiting restores it, so
 * the user's own work is never overwritten. A lesson's final state can be
 * kept as a new experiment.
 */
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { LESSONS } from '@/lessons';
import type { Lesson } from '@/lessons/types';
import { defaultExperimentState } from '@/state/defaults';
import type { ExperimentState } from '@/state/schema';
import { useExperimentsStore } from './experiments';
import { useLabStore } from './lab';

const DONE_KEY = 'aql.lessons.completed';

function readDone(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(DONE_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export const useLessonsStore = defineStore('lessons', () => {
  const lab = useLabStore();
  const exps = useExperimentsStore();
  const active = ref<Lesson | null>(null);
  const stepIndex = ref(0);
  const completed = ref<string[]>(readDone());
  let saved: ExperimentState | null = null;

  const step = computed(() => active.value?.steps[stepIndex.value] ?? null);
  const isLast = computed(() => !!active.value && stepIndex.value === active.value.steps.length - 1);

  function applyStep(i: number) {
    const lesson = active.value;
    if (!lesson) return;
    stepIndex.value = Math.max(0, Math.min(lesson.steps.length - 1, i));
    const s = lesson.steps[stepIndex.value]!;
    if (s.setup) {
      exps.flushHistory();
      s.setup(lab.state);
    }
  }

  function start(id: string) {
    const lesson = LESSONS.find((l) => l.id === id);
    if (!lesson) return;
    if (!active.value) {
      exps.flushHistory();
      void exps.saveCurrent();
      saved = lab.snapshot();
    }
    exps.suspended = true;
    active.value = lesson;
    lab.replace(defaultExperimentState());
    applyStep(0);
    exps.resetHistory();
  }

  function next() {
    if (!active.value) return;
    if (isLast.value) return finish();
    applyStep(stepIndex.value + 1);
  }

  function prev() {
    applyStep(stepIndex.value - 1);
  }

  function markDone(id: string) {
    if (!completed.value.includes(id)) completed.value.push(id);
    try {
      localStorage.setItem(DONE_KEY, JSON.stringify(completed.value));
    } catch {
      /* ignore */
    }
  }

  function finish() {
    if (active.value) markDone(active.value.id);
    exit();
  }

  /** Leaves the lesson and restores the user's experiment exactly as it was. */
  function exit() {
    if (!active.value) return;
    active.value = null;
    if (saved) lab.replace(saved);
    saved = null;
    exps.suspended = false;
    exps.resetHistory();
  }

  /** Keeps the lesson's current laboratory state as a new experiment. */
  async function keepAsExperiment() {
    const lesson = active.value;
    if (!lesson) return;
    const lessonState = lab.snapshot();
    markDone(lesson.id);
    exit();
    await exps.createExperiment(`Lesson: ${lesson.title}`, lessonState);
  }

  return { active, stepIndex, step, isLast, completed, start, next, prev, exit, finish, keepAsExperiment, goTo: applyStep };
});
