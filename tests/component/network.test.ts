import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { describe, expect, it } from 'vitest';
import NetworkLab from '@/components/network/NetworkLab.vue';
import LessonPanel from '@/components/lessons/LessonPanel.vue';
import { useLabStore } from '@/stores/lab';
import { useLessonsStore } from '@/stores/lessons';
import { useExperimentsStore } from '@/stores/experiments';
import { applyScenario } from '@/data/networkScenarios';

const settle = async () => {
  await new Promise((r) => setTimeout(r, 250));
  await flushPromises();
};

describe('Neural Network Laboratory', () => {
  it('summarises baseline and variants and reacts to scenario changes', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const w = mount(NetworkLab, { global: { plugins: [pinia] } });
    await settle();
    const rows = w.findAll('[data-testid="nn-summary"] tbody tr');
    expect(rows).toHaveLength(4); // baseline + 3 default variants
    const lab = useLabStore();
    lab.state.network = applyScenario('weights-vs-activations');
    await settle();
    const agreement = w.findAll('td[data-metric="agreement"]').map((td) => parseFloat(td.text()));
    expect(agreement[0]).toBeGreaterThan(98);
    expect(agreement[1]).toBeLessThan(80);
  });
  it('selecting a neuron shows original and quantized incoming weights', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const w = mount(NetworkLab, { global: { plugins: [pinia] } });
    await settle();
    useLabStore().state.network.selection = { layer: 0, unit: 3, input: null };
    await settle();
    const unit = w.get('[data-testid="nn-unit"]');
    expect(unit.text()).toContain('hidden layer 1, unit 3');
    expect(unit.findAll('tbody tr')).toHaveLength(2);
  });
  it('rejects malformed weight edits with an explanation', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const w = mount(NetworkLab, { global: { plugins: [pinia] } });
    await settle();
    await w.get('[data-testid="nn-weights"]').setValue('1, 2 | 3');
    await w.get('[data-testid="nn-apply-weights"]').trigger('click');
    expect(w.text()).toContain('Expected 16 rows');
  });
});

describe('Lessons', () => {
  it('start → solve → exit restores the user experiment exactly', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const exps = useExperimentsStore();
    await exps.init();
    const lab = useLabStore();
    lab.state.inspector.input = 'my own work';
    const before = JSON.stringify(lab.snapshot());
    const lessons = useLessonsStore();
    lessons.start('fp8-fp4');
    const w = mount(LessonPanel, { global: { plugins: [pinia] } });
    await flushPromises();
    expect(lab.state.inspector.input).toBe('300');
    await w.get('[data-testid="lesson-next"]').trigger('click');
    await flushPromises();
    expect(w.get('[data-testid="lesson-task"]').text()).toContain('Try it');
    await w.get('[data-testid="lesson-show-me"]').trigger('click');
    await flushPromises();
    expect(w.get('[data-testid="lesson-task"]').text()).toContain('Done!');
    lessons.exit();
    expect(JSON.stringify(lab.snapshot())).toBe(before);
    expect(exps.suspended).toBe(false);
  });
  it('keep as experiment creates a new experiment with the lesson state', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const exps = useExperimentsStore();
    await exps.init();
    const lessons = useLessonsStore();
    lessons.start('point-one');
    await lessons.keepAsExperiment();
    expect(exps.experiments).toHaveLength(2);
    expect(exps.current!.name).toBe('Lesson: Why 0.1 is not exact');
    expect(useLabStore().state.inspector.input).toBe('0.1');
    expect(lessons.completed).toContain('point-one');
  });
});
