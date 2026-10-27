import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import App from '@/App.vue';

describe('App', () => {
  it('renders the application title', () => {
    const w = mount(App);
    expect(w.text()).toContain('AI Quantization Laboratory');
  });
});
