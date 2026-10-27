import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import ExperimentPanel from '@/components/experiments/ExperimentPanel.vue';
import { useExperimentsStore } from '@/stores/experiments';
import { useLabStore } from '@/stores/lab';

const settle = async () => {
  await new Promise((r) => setTimeout(r, 60));
  await flushPromises();
};

async function setup() {
  const pinia = createPinia();
  setActivePinia(pinia);
  // Stores are bound to this test's Pinia explicitly: timers of earlier tests can switch the active one.
  const exps = useExperimentsStore(pinia);
  await exps.init();
  const w = mount(ExperimentPanel, { global: { plugins: [pinia] }, attachTo: document.body });
  await flushPromises();
  return { w, exps, lab: useLabStore(pinia) };
}
const tabTo = async (w: Awaited<ReturnType<typeof setup>>['w'], label: string) => {
  const b = w.findAll('[role="radio"]').find((x) => x.text() === label)!;
  await b.trigger('click');
};

describe('Experiment panel', () => {
  beforeEach(() => document.body.replaceChildren());

  it('renames the experiment and saves notes', async () => {
    const { w, exps } = await setup();
    await w.get('[data-testid="exp-name"]').setValue('FP8 study');
    await w.get('[data-testid="exp-name"]').trigger('change');
    await w.get('#exp-notes').setValue('Testing E4M3 vs E5M2');
    await w.get('#exp-notes').trigger('change');
    await flushPromises();
    expect(exps.current?.name).toBe('FP8 study');
    expect(exps.current?.notes).toBe('Testing E4M3 vs E5M2');
    w.unmount();
  });

  it('takes, restores and deletes snapshots with two-step confirmation', async () => {
    const { w, exps, lab } = await setup();
    lab.state.inspector.input = '0.1';
    await w.get('#snap-name').setValue('before');
    await w.get('form').trigger('submit');
    await flushPromises();
    expect(exps.current?.snapshots.map((s) => s.name)).toEqual(['before']);
    lab.state.inspector.input = '42';
    const id = exps.current!.snapshots[0]!.id;
    const restore = w.get(`[data-testid="restore-${id}"]`);
    await restore.trigger('click');
    expect(lab.state.inspector.input).toBe('42'); // first click only arms
    expect(restore.text()).toContain('Replace current state?');
    await restore.trigger('click');
    expect(lab.state.inspector.input).toBe('0.1');
    const del = w.get(`[data-testid="delete-snap-${id}"]`);
    await del.trigger('click');
    await del.trigger('click');
    await flushPromises();
    expect(exps.current?.snapshots).toHaveLength(0);
    w.unmount();
  });

  it('resets one laboratory without touching the others or other experiments', async () => {
    const { w, exps, lab } = await setup();
    lab.state.inspector.input = '3.14';
    lab.state.matrix.scalar = 7;
    const btn = w.get('[data-testid="reset-inspector"]');
    await btn.trigger('click');
    await btn.trigger('click');
    expect(lab.state.inspector.input).not.toBe('3.14');
    expect(lab.state.matrix.scalar).toBe(7);
    expect(exps.experiments).toHaveLength(1);
    w.unmount();
  });

  it('creates, branches, switches and deletes experiments in the library', async () => {
    const { w, exps } = await setup();
    const first = exps.currentId;
    await tabTo(w, 'All experiments');
    await w.get('[data-testid="exp-new"]').trigger('click');
    await settle();
    expect(exps.experiments).toHaveLength(2);
    expect(exps.currentId).not.toBe(first);
    await w.findAll('button[aria-label^="Branch"]')[0]!.trigger('click');
    await settle();
    expect(exps.experiments).toHaveLength(3);
    expect(exps.current?.parentId).not.toBeNull();
    expect(w.text()).toContain('from ');
    await w.get(`[data-testid="open-${first}"]`).trigger('click');
    await settle();
    expect(exps.currentId).toBe(first);
    const other = exps.experiments.find((e) => e.id !== first)!.id;
    const del = w.get(`[data-testid="delete-${other}"]`);
    await del.trigger('click');
    await del.trigger('click');
    await settle();
    expect(exps.experiments).toHaveLength(2);
    expect(exps.currentId).toBe(first);
    w.unmount();
  });

  it('compares the current state against a snapshot', async () => {
    const { w, exps, lab } = await setup();
    await exps.takeSnapshot('base');
    lab.state.inspector.input = '1e-7';
    await tabTo(w, 'Compare');
    const snapKey = `${exps.currentId}/${exps.current!.snapshots[0]!.id}`;
    await w.get('[data-testid="compare-b"]').setValue(snapKey);
    await w.get('[data-testid="compare-run"]').trigger('click');
    await settle();
    const diff = w.get('[data-testid="compare-diff"]');
    expect(diff.text()).toContain('inspector.input');
    expect(diff.text()).toContain('"1e-7"');
    expect(w.get('[data-testid="compare-result"]').text()).toContain('Network baseline accuracy');
    w.unmount();
  });

  it('reports invalid import files without changing anything', async () => {
    const { w, exps } = await setup();
    await tabTo(w, 'All experiments');
    const input = w.get('[data-testid="exp-import-file"]');
    const file = new File(['{"format":"something-else"}'], 'bad.json', { type: 'application/json' });
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true });
    await input.trigger('change');
    await settle();
    expect(w.get('[data-testid="import-errors"]').text().length).toBeGreaterThan(0);
    expect(exps.experiments).toHaveLength(1);
    w.unmount();
  });

  it('round-trips an export through import', async () => {
    const { w, exps, lab } = await setup();
    lab.state.inspector.input = '-0';
    await exps.rename(exps.currentId, 'Signed zero');
    const text = exps.exportJson([exps.currentId]);
    await tabTo(w, 'All experiments');
    const input = w.get('[data-testid="exp-import-file"]');
    Object.defineProperty(input.element, 'files', { value: [new File([text], 'x.json')], configurable: true });
    await input.trigger('change');
    await settle();
    expect(exps.experiments).toHaveLength(2);
    expect(exps.current?.name).toBe('Signed zero (imported)');
    expect(lab.state.inspector.input).toBe('-0');
    w.unmount();
  });

  it('warns when experiments are kept only in memory', async () => {
    const { w } = await setup();
    expect(w.find('[data-testid="memory-only"]').exists()).toBe(true); // jsdom has no IndexedDB
    w.unmount();
  });
});
