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

describe('review fixes (M4)', () => {
  it('choosing per-channel activation scaling yields a valid axis', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const w = mount(NetworkLab, { global: { plugins: [pinia] } });
    await settle();
    // Earlier tests' components stay mounted and can switch the active Pinia, so stores are taken explicitly.
    const lab = useLabStore(pinia);
    await w.get('[data-testid="nn-act-quant"]').setValue(true);
    // The activation editor is the one containing the "nna-format" control.
    let editor = w.get('[data-testid="nna-format"]').element as HTMLElement;
    while (!editor.querySelector('[aria-label="Granularity"]')) editor = editor.parentElement!;
    const perChannel = [...editor.querySelectorAll<HTMLElement>('[aria-label="Granularity"] [role="radio"]')].find((b) => b.textContent!.trim() === 'Per-channel')!;
    perChannel.click();
    await flushPromises();
    const act = lab.state.network.variants.find((v) => v.id === lab.state.network.activeVariantId)!.layers[0]!.activation!;
    expect(act.granularity).toBe('channel');
    expect(act.axis).toBe(1);
    expect(w.text()).not.toContain('per-feature scaling uses axis 1');
    w.unmount();
  });

  it('lesson Back and step dots replay earlier setups', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const exps = useExperimentsStore(pinia);
    await exps.init();
    const lessons = useLessonsStore(pinia);
    const lab = useLabStore(pinia);
    lessons.start('networks');
    lessons.next();
    const atStep2 = JSON.stringify(lab.state);
    lessons.next();
    expect(JSON.stringify(lab.state)).not.toBe(atStep2);
    lessons.prev();
    expect(JSON.stringify(lab.state)).toBe(atStep2);
    lessons.goTo(0);
    lessons.goTo(1);
    expect(JSON.stringify(lab.state)).toBe(atStep2);
    lessons.exit();
  });

  it('an unreadable history entry is discarded without corrupting undo/redo', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const exps = useExperimentsStore(pinia);
    await exps.init();
    const lab = useLabStore(pinia);
    const initial = JSON.stringify(lab.state);
    const v = lab.state.network.variants[0]!;
    v.layers[0]!.activation = { ...v.layers[0]!.weight!, granularity: 'channel', axis: 0 }; // semantically invalid
    await flushPromises();
    exps.flushHistory();
    await new Promise((r) => setTimeout(r, 400));
    lab.state.network.variants[0]!.layers[0]!.activation = null;
    await new Promise((r) => setTimeout(r, 400));
    const before = JSON.stringify(lab.state);
    exps.undo(); // target is the invalid state: discarded, nothing changes
    expect(JSON.stringify(lab.state)).toBe(before);
    expect(() => exps.undo()).not.toThrow(); // the valid initial state is restored
    expect(JSON.stringify(lab.state)).toBe(initial);
    exps.redo();
    expect(JSON.stringify(lab.state)).toBe(before);
  });
});
