import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import QuantConfigEditor from '@/components/workbench/QuantConfigEditor.vue';
import MetricsTable from '@/components/workbench/MetricsTable.vue';
import DataSourcePanel from '@/components/workbench/DataSourcePanel.vue';
import { makeQuantConfig } from '@/engine/quant/types';
import { evaluateVariants } from '@/labs/workbench';
import { generate } from '@/engine/random/distributions';
import type { DataSource } from '@/state/schema';

describe('QuantConfigEditor', () => {
  it('shows only relevant controls and explains unsupported options', async () => {
    const w = mount(QuantConfigEditor, { props: { modelValue: makeQuantConfig({ format: 'fp8_e4m3' }), 'onUpdate:modelValue': () => {} } });
    const asym = w.findAll('button').find((b) => b.text() === 'Asymmetric')!;
    expect(asym.attributes('disabled')).toBeDefined();
    expect(asym.attributes('title')).toMatch(/no zero-point/);
    expect(w.find('[data-testid="q-group-size"]').exists()).toBe(false);
  });
  it('group size appears for per-group granularity; invalid manual scale is reported', async () => {
    const w = mount(QuantConfigEditor, {
      props: { modelValue: makeQuantConfig({ granularity: 'group', calibration: 'manual', manualScale: 0 }), shape: [4, 64] as [number, number] },
    });
    expect(w.find('[data-testid="q-group-size"]').exists()).toBe(true);
    expect(w.text()).toContain('Scale must be a finite positive number');
  });
  it('emits a new config when the format changes', async () => {
    const w = mount(QuantConfigEditor, { props: { modelValue: makeQuantConfig() } });
    await w.get('[data-testid="q-format"]').setValue('int4');
    const emitted = w.emitted('update:modelValue')!;
    expect((emitted.at(-1)![0] as { format: string }).format).toBe('int4');
  });
});

describe('MetricsTable', () => {
  it('renders the engine metrics and marks the best variant', () => {
    const x = generate({ kind: 'normal', params: {}, rows: 4, cols: 32, seed: 1 });
    const variants = [
      { id: 'v1', name: 'INT8', enabled: true, config: makeQuantConfig({ format: 'int8' }) },
      { id: 'v2', name: 'INT4', enabled: true, config: makeQuantConfig({ format: 'int4' }) },
    ];
    const evals = evaluateVariants(x, [4, 32], variants);
    const w = mount(MetricsTable, { props: { variants, evaluations: evals, active: 'v1' } });
    const mse = w.findAll('td[data-metric="mse"]');
    expect(mse).toHaveLength(2);
    expect(mse[0]!.classes()).toContain('best');
    expect(Number(mse[0]!.text())).toBeCloseTo(evals[0]!.metrics!.mse, 6);
  });
});

describe('DataSourcePanel', () => {
  it('manual entry reports malformed cells with their location', async () => {
    let src: DataSource = { kind: 'generator', distribution: 'normal', params: {}, rows: 2, cols: 2, seed: 1 };
    const w = mount(DataSourcePanel, { props: { modelValue: src, 'onUpdate:modelValue': (v: DataSource) => (src = v) } });
    await w.findAll('button').find((b) => b.text() === 'Manual')!.trigger('click');
    await w.get('[data-testid="manual-data"]').setValue('1, 2\n3, x');
    await w.get('[data-testid="manual-apply"]').trigger('click');
    expect(w.text()).toContain('Line 2, column 2: "x" is not a number.');
    await w.get('[data-testid="manual-data"]').setValue('1, 2\n3, 4');
    await w.get('[data-testid="manual-apply"]').trigger('click');
    expect(src).toEqual({ kind: 'manual', rows: 2, cols: 2, values: [1, 2, 3, 4] });
  });
});

import VariantList from '@/components/workbench/VariantList.vue';

describe('VariantList (regression)', () => {
  it('removing the active first variant selects a remaining one', async () => {
    const variants = [
      { id: 'v1', name: 'a', enabled: true, config: makeQuantConfig() },
      { id: 'v2', name: 'b', enabled: true, config: makeQuantConfig() },
    ];
    const w = mount(VariantList, { props: { modelValue: variants, active: 'v1' } });
    await w.get('button[aria-label="Remove a"]').trigger('click');
    expect((w.emitted('update:active')!.at(-1) as string[])[0]).toBe('v2');
  });
});
