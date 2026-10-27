import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { describe, expect, it } from 'vitest';
import MatrixLab from '@/components/matrix/MatrixLab.vue';
import { useLabStore } from '@/stores/lab';

describe('Matrix Laboratory', () => {
  it('shows one result row per output entry and a step trace', () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const w = mount(MatrixLab, { global: { plugins: [pinia] } });
    expect(w.findAll('[data-testid="matrix-results"] tbody tr')).toHaveLength(6);
    expect(w.findAll('[data-testid="dot-trace"] tbody tr')).toHaveLength(4);
  });
  it('reports shape mismatches and offers an explicit reshape', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const w = mount(MatrixLab, { global: { plugins: [pinia] } });
    const lab = useLabStore();
    lab.state.matrix.op = 'dot';
    await flushPromises();
    expect(w.text()).toContain('A must be a row vector');
    await w.findAll('button').find((b) => b.text().startsWith('Reshape'))!.trigger('click');
    await flushPromises();
    expect(lab.state.matrix.A.rows).toBe(1);
    expect(lab.state.matrix.B.cols).toBe(1);
    expect(w.findAll('[data-testid="matrix-results"] tbody tr')).toHaveLength(1);
  });
  it('integer path explains when it is unavailable', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const w = mount(MatrixLab, { global: { plugins: [pinia] } });
    const lab = useLabStore();
    lab.state.matrix.integerPath = true;
    lab.state.matrix.quantB = null;
    await flushPromises();
    expect(w.text()).toContain('Integer path unavailable');
  });
});
