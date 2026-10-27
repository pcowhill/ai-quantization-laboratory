<script setup lang="ts">
import { computed } from 'vue';
import { makeQuantConfig } from '@/engine/quant/types';
import { variantSlot } from '@/composables/useWorkbench';
import type { QuantVariant } from '@/state/schema';
import Icon from '@/components/common/Icon.vue';

const variants = defineModel<QuantVariant[]>({ required: true });
const active = defineModel<string>('active', { required: true });
const MAX = 8;

const nextId = computed(() => {
  const used = new Set(variants.value.map((v) => v.id));
  for (let k = 1; k <= 64; k++) if (!used.has(`v${k}`)) return `v${k}`;
  return `v${Date.now()}`;
});

function add() {
  if (variants.value.length >= MAX) return;
  const src = variants.value.find((v) => v.id === active.value);
  const id = nextId.value;
  variants.value = [...variants.value, { id, name: src ? `${src.name} (copy)` : 'New variant', enabled: true, config: src ? { ...src.config } : makeQuantConfig() }];
  active.value = id;
}
function remove(id: string) {
  if (variants.value.length <= 1) return;
  const next = variants.value.filter((v) => v.id !== id);
  variants.value = next;
  if (active.value === id) active.value = next[0]!.id;
}
function rename(v: QuantVariant, name: string) {
  const n = name.trim();
  if (n) v.name = n.slice(0, 80);
}
</script>

<template>
  <div class="variants">
    <ul class="vlist" aria-label="Quantization variants">
      <li
        v-for="v in variants"
        :key="v.id"
        class="vitem"
        :class="{ active: v.id === active, disabled: !v.enabled }"
        :data-testid="`variant-${v.id}`"
        @click="active = v.id"
      >
        <input type="radio" name="wb-active-variant" :checked="v.id === active" :aria-label="`Edit ${v.name}`" @change="active = v.id" @click.stop />
        <span class="swatch" :style="{ background: `var(--series-${variantSlot(v.id) + 1})` }" aria-hidden="true" />
        <input class="vname" :value="v.name" :aria-label="`Name of variant ${v.id}`" @change="rename(v, ($event.target as HTMLInputElement).value)" @click.stop />
        <label class="check" :title="v.enabled ? 'Included in comparison' : 'Excluded'" @click.stop>
          <input v-model="v.enabled" type="checkbox" :aria-label="`Include ${v.name}`" />
        </label>
        <button type="button" class="btn btn-ghost btn-sm" :disabled="variants.length <= 1" :aria-label="`Remove ${v.name}`" title="Remove" @click.stop="remove(v.id)"><Icon name="trash" :size="14" /></button>
      </li>
    </ul>
    <button type="button" class="btn btn-sm" :disabled="variants.length >= MAX" data-testid="add-variant" @click="add"><Icon name="plus" :size="14" /> Duplicate selected as new variant</button>
  </div>
</template>

<style scoped>
.variants {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.vlist {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.vitem {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 4px 3px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  cursor: pointer;
  background: var(--surface);
}
.vitem.active {
  border-color: var(--accent);
  background: var(--accent-softer);
  box-shadow: inset 3px 0 0 var(--accent);
}
.vitem.disabled .vname {
  color: var(--text-3);
  text-decoration: line-through;
}
.swatch {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  flex: none;
}
.vname {
  flex: 1;
  min-width: 0;
  border: 1px solid transparent;
  background: transparent;
  font-size: 12.5px;
  padding: 2px 4px;
  border-radius: 4px;
}
.vname:hover,
.vname:focus {
  border-color: var(--border-strong);
  background: var(--surface);
}
</style>
