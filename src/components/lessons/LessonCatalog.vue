<script setup lang="ts">
import { computed } from 'vue';
import { LESSONS } from '@/lessons';
import { useLessonsStore } from '@/stores/lessons';
import { useUiStore } from '@/stores/ui';
import Drawer from '@/components/common/Drawer.vue';
import Icon from '@/components/common/Icon.vue';

const ui = useUiStore();
const lessons = useLessonsStore();
const levels = ['Foundations', 'Quantization', 'Arithmetic', 'Networks'] as const;
const grouped = computed(() => levels.map((lv) => ({ level: lv, items: LESSONS.filter((l) => l.level === lv) })));
function start(id: string) {
  lessons.start(id);
  ui.lessonsOpen = false;
}
</script>

<template>
  <Drawer title="Guided lessons" width="560px" test-id="lesson-catalog" @close="ui.lessonsOpen = false">
    <p class="intro">
      Each lesson sets up the real laboratories, explains what you see, and suggests something to try. Your current experiment is saved before a lesson starts and restored when you leave it.
    </p>
    <section v-for="g in grouped" :key="g.level" class="group">
      <h3>{{ g.level }}</h3>
      <ul>
        <li v-for="l in g.items" :key="l.id" class="lesson">
          <div class="lesson-main">
            <div class="lesson-title">
              <span v-if="lessons.completed.includes(l.id)" class="done" title="Completed"><Icon name="check" :size="14" /></span>
              {{ l.title }}
            </div>
            <p>{{ l.summary }}</p>
            <span class="muted small">{{ l.steps.length }} steps · about {{ l.minutes }} min</span>
          </div>
          <button type="button" class="btn btn-primary btn-sm" :data-testid="`start-lesson-${l.id}`" @click="start(l.id)"><Icon name="play" :size="12" /> Start</button>
        </li>
      </ul>
    </section>
  </Drawer>
</template>

<style scoped>
.intro {
  color: var(--text-2);
  font-size: 13px;
}
.group h3 {
  margin: 16px 0 6px;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-3);
}
ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.lesson {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
.lesson-main {
  flex: 1;
  min-width: 0;
}
.lesson-title {
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
}
.lesson p {
  margin: 2px 0;
  font-size: 12.5px;
  color: var(--text-2);
}
.done {
  color: var(--good);
}
</style>
