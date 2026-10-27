import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import NumberInspector from '@/components/inspector/NumberInspector.vue';
import { useLabStore } from '@/stores/lab';

const wait = (ms = 250) => new Promise((r) => setTimeout(r, ms));

describe('Number Inspector', () => {
  let pinia: ReturnType<typeof createPinia>;
  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
  });
  const mountIt = () => mount(NumberInspector, { global: { plugins: [pinia] } });

  it('shows the exact stored FP16 value and bit pattern of 0.1', () => {
    const w = mountIt();
    expect(w.get('[data-testid="inspector-stored"]').text()).toBe('0.0999755859375');
    expect(w.get('[data-testid="inspector-hex"]').text()).toBe('0x2E66');
    expect(w.get('[data-testid="inspector-formula"]').text()).toContain('2^(11−15)');
  });

  it('typing a value updates every view', async () => {
    const w = mountIt();
    await w.get('[data-testid="inspector-input"]').setValue('1/3');
    await wait();
    await flushPromises();
    expect(w.get('[data-testid="inspector-stored"]').text()).toBe('0.333251953125');
    expect(w.get('[data-testid="inspector-exact-input"]').text()).toContain('1/3');
  });

  it('flipping the sign bit negates the value and records the bit pattern', async () => {
    const w = mountIt();
    await w.get('[data-testid="bit-0"]').trigger('click');
    expect(w.get('[data-testid="inspector-stored"]').text()).toBe('−0.0999755859375');
    expect(useLabStore().state.inspector.bitsOverride).toBe('AE66');
  });

  it('switching format re-rounds the same input; comparison table lists all formats', async () => {
    const w = mountIt();
    const lab = useLabStore();
    lab.state.inspector.format = 'fp8_e4m3';
    await flushPromises();
    expect(w.get('[data-testid="inspector-stored"]').text()).toBe('0.1015625');
    expect(w.findAll('[data-testid="compare-table"] tbody tr')).toHaveLength(9);
  });

  it('reports invalid input instead of guessing', async () => {
    const w = mountIt();
    await w.get('[data-testid="inspector-input"]').setValue('12abc');
    await wait();
    await flushPromises();
    expect(w.text()).toContain('not a valid decimal number');
  });

  it('presets set format-specific values (FP16 max)', async () => {
    const w = mountIt();
    await w.get('[data-testid="preset-max"]').trigger('click');
    await flushPromises();
    expect(w.get('[data-testid="inspector-stored"]').text()).toBe('65504');
  });

  it('next/previous step through representable values', async () => {
    const w = mountIt();
    await w.get('[data-testid="step-up"]').trigger('click');
    await flushPromises();
    expect(w.get('[data-testid="inspector-hex"]').text()).toBe('0x2E67');
  });
});
