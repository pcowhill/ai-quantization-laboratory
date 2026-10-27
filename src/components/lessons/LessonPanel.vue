<script setup lang="ts">
/** Docked lesson guide shown next to the laboratories during a lesson. */
import { computed, ref, watch } from 'vue';
import { useLabStore } from '@/stores/lab';
import { useLessonsStore } from '@/stores/lessons';
import Icon from '@/components/common/Icon.vue';

const lessons = useLessonsStore();
const lab = useLabStore();
const showHint = ref(false);
watch(() => lessons.stepIndex, () => (showHint.value = false));

const lesson = computed(() => lessons.active!);
const step = computed(() => lessons.step!);
const solved = computed(() => {
  const t = step.value?.task;
  if (!t) return false;
  try {
    return t.check(lab.state);
  } catch {
    return false;
  }
});
function showMe() {
  step.value.task?.solve(lab.state);
}
</script>

<template>
  <aside v-if="lessons.active && step" class="lesson-panel" aria-label="Guided lesson" data-testid="lesson-panel">
    <header>
      <span class="eyebrow">Lesson · {{ lesson.level }}</span>
      <h2>{{ lesson.title }}</h2>
      <div class="progress" role="progressbar" :aria-valuenow="lessons.stepIndex + 1" aria-valuemin="1" :aria-valuemax="lesson.steps.length" :aria-label="`Step ${lessons.stepIndex + 1} of ${lesson.steps.length}`">
        <button v-for="(st, i) in lesson.steps" :key="i" type="button" class="dot" :class="{ on: i === lessons.stepIndex, past: i < lessons.stepIndex }" :aria-label="`Go to step ${i + 1}: ${st.title}`" @click="lessons.goTo(i)" />
      </div>
    </header>
    <div class="body" aria-live="polite">
      <h3>{{ lessons.stepIndex + 1 }}. {{ step.title }}</h3>
      <!-- eslint-disable-next-line vue/no-v-html -- lesson text is authored in this repository, never user input -->
      <div class="prose" v-html="step.body" />
      <div v-if="step.task" class="task" :class="{ solved }" data-testid="lesson-task">
        <div class="task-head"><Icon :name="solved ? 'check' : 'info'" :size="16" /> <strong>{{ solved ? 'Done!' : 'Try it' }}</strong></div>
        <p>{{ step.task.prompt }}</p>
        <p v-if="solved" class="success">{{ step.task.success }}</p>
        <div v-else class="row">
          <button v-if="step.hint" type="button" class="btn btn-ghost btn-sm" @click="showHint = !showHint">{{ showHint ? 'Hide hint' : 'Hint' }}</button>
          <button type="button" class="btn btn-ghost btn-sm" data-testid="lesson-show-me" @click="showMe">Show me</button>
        </div>
        <p v-if="showHint && step.hint && !solved" class="hint">{{ step.hint }}</p>
      </div>
    </div>
    <footer>
      <div class="row nav">
        <button type="button" class="btn btn-sm" :disabled="lessons.stepIndex === 0" @click="lessons.prev()"><Icon name="chevronLeft" :size="14" /> Back</button>
        <span class="spacer" />
        <button type="button" class="btn btn-primary btn-sm" data-testid="lesson-next" @click="lessons.next()">{{ lessons.isLast ? 'Finish' : 'Next' }} <Icon v-if="!lessons.isLast" name="chevronRight" :size="14" /></button>
      </div>
      <div class="row exits">
        <button type="button" class="btn btn-ghost btn-sm" data-testid="lesson-exit" title="Leave the lesson and restore your experiment exactly as it was" @click="lessons.exit()"><Icon name="x" :size="14" /> Exit lesson</button>
        <button type="button" class="btn btn-ghost btn-sm" title="Save the lesson's current laboratory state as a new experiment" @click="lessons.keepAsExperiment()"><Icon name="file" :size="14" /> Keep as experiment</button>
      </div>
    </footer>
  </aside>
</template>

<style scoped>
.lesson-panel {
  width: 360px;
  flex: none;
  position: sticky;
  top: var(--header-h);
  height: calc(100vh - var(--header-h));
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border-left: 1px solid var(--border);
  box-shadow: -4px 0 16px rgba(0, 0, 0, 0.04);
}
header {
  padding: 14px 16px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--accent-softer);
}
.eyebrow {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--accent);
}
header h2 {
  font-size: 15px;
  margin: 2px 0 8px;
}
.progress {
  display: flex;
  gap: 5px;
}
.dot {
  width: 22px;
  height: 6px;
  border-radius: 3px;
  border: none;
  background: var(--border-strong);
  cursor: pointer;
  padding: 0;
}
.dot.past {
  background: color-mix(in srgb, var(--accent) 45%, var(--surface));
}
.dot.on {
  background: var(--accent);
}
.body {
  flex: 1;
  overflow-y: auto;
  padding: 14px 16px;
}
.body h3 {
  margin-bottom: 8px;
}
.task {
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: var(--radius);
  border: 1px solid var(--border-strong);
  background: var(--surface-2);
  font-size: 13px;
}
.task.solved {
  border-color: var(--good);
  background: color-mix(in srgb, var(--good) 8%, var(--surface));
}
.task-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}
.task.solved .task-head {
  color: var(--good);
}
.task p {
  margin: 4px 0;
}
.success {
  color: var(--text-2);
}
.hint {
  color: var(--text-2);
  font-style: italic;
}
footer {
  padding: 10px 16px 12px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.exits {
  justify-content: space-between;
}
@media (max-width: 1100px) {
  .lesson-panel {
    position: fixed;
    right: 0;
    bottom: 0;
    top: auto;
    height: 46vh;
    width: 100%;
    z-index: 40;
    border-left: none;
    border-top: 1px solid var(--border);
  }
}
</style>
