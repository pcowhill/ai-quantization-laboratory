<script setup lang="ts" generic="T extends string | number">
import InfoTip from './InfoTip.vue';

export interface SelectOption<V> {
  value: V;
  label: string;
  disabled?: boolean;
  group?: string;
  title?: string;
}
const props = defineProps<{ label: string; options: SelectOption<T>[]; hint?: string; info?: string; disabled?: boolean; testId?: string }>();
const model = defineModel<T>({ required: true });
const id = `sel-${Math.random().toString(36).slice(2, 9)}`;

function groups() {
  const out: { group: string; options: SelectOption<T>[] }[] = [];
  for (const o of props.options) {
    const g = o.group ?? '';
    let entry = out.find((x) => x.group === g);
    if (!entry) out.push((entry = { group: g, options: [] }));
    entry.options.push(o);
  }
  return out;
}
function onChange(e: Event) {
  const raw = (e.target as HTMLSelectElement).value;
  const opt = props.options.find((o) => String(o.value) === raw);
  if (opt) model.value = opt.value;
}
</script>

<template>
  <div class="field">
    <label :for="id">{{ label }} <InfoTip v-if="info" :text="info" :label="`About ${label}`" /></label>
    <select :id="id" class="select" :value="String(model)" :disabled="disabled" :data-testid="testId" @change="onChange">
      <template v-for="g in groups()" :key="g.group">
        <optgroup v-if="g.group" :label="g.group">
          <option v-for="o in g.options" :key="String(o.value)" :value="String(o.value)" :disabled="o.disabled" :title="o.title">{{ o.label }}</option>
        </optgroup>
        <template v-else>
          <option v-for="o in g.options" :key="String(o.value)" :value="String(o.value)" :disabled="o.disabled" :title="o.title">{{ o.label }}</option>
        </template>
      </template>
    </select>
    <span v-if="hint" class="field-hint">{{ hint }}</span>
  </div>
</template>
