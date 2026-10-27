<script setup lang="ts">
/** Per-layer quantization settings for one network variant. */
import { computed, ref } from 'vue';
import { DEFAULT_ARITH_CONFIG } from '@/engine/arith/dot';
import { getFormat } from '@/engine/formats/registry';
import type { LayerQuant, NetworkDef } from '@/engine/nn/network';
import type { QuantConfig } from '@/engine/quant/types';
import { validateNetworkQuant } from '@/engine/nn/network';
import { activationConfig, weightConfig } from '@/state/defaults';
import type { NetworkVariant } from '@/state/schema';
import QuantConfigEditor from '@/components/workbench/QuantConfigEditor.vue';
import ArithConfigEditor from '@/components/matrix/ArithConfigEditor.vue';
import Segmented from '@/components/common/Segmented.vue';
import IssueList from '@/components/common/IssueList.vue';

const props = defineProps<{ net: NetworkDef }>();
const variant = defineModel<NetworkVariant>({ required: true });
const layer = ref(0);
const L = computed(() => props.net.layers.length);
const lq = computed<LayerQuant>(() => variant.value.layers[layer.value] ?? { weight: null, activation: null, arith: null });

function summary(c: QuantConfig | null): string {
  if (!c) return 'FP64';
  const f = getFormat(c.format).name;
  if (c.scaling === 'none') return `${f} cast`;
  const g = c.granularity === 'tensor' ? 'tensor' : c.granularity === 'channel' ? 'channel' : `g${c.groupSize}`;
  return `${f} ${c.scheme === 'asymmetric' ? 'asym ' : ''}${g}`;
}

function setLayer(patch: Partial<LayerQuant>) {
  const layers = variant.value.layers.map((x, i) => (i === layer.value ? { ...x, ...patch } : x));
  variant.value = { ...variant.value, layers };
}
const fanIn = computed(() => (layer.value === 0 ? props.net.inputSize : props.net.layers[layer.value - 1]!.units));
const units = computed(() => props.net.layers[layer.value]?.units ?? 1);

const wOn = computed({ get: () => lq.value.weight !== null, set: (v: boolean) => setLayer({ weight: v ? weightConfig({ format: 'int8' }) : null }) });
const aOn = computed({ get: () => lq.value.activation !== null, set: (v: boolean) => setLayer({ activation: v ? activationConfig({ format: 'int8' }) : null }) });
const arOn = computed({ get: () => lq.value.arith !== null, set: (v: boolean) => setLayer({ arith: v ? { ...DEFAULT_ARITH_CONFIG } : null }) });
const wCfg = computed({ get: () => lq.value.weight!, set: (c: QuantConfig) => setLayer({ weight: c }) });
// Activations are a [1, features] vector: per-feature scales run along axis 1 and
// feature groups along axis 0, so the axis follows the granularity.
const aCfg = computed({
  get: () => lq.value.activation!,
  set: (c: QuantConfig) => setLayer({ activation: { ...c, axis: c.granularity === 'channel' ? 1 : c.granularity === 'group' ? 0 : c.axis } }),
});
const arCfg = computed({ get: () => lq.value.arith!, set: (c) => setLayer({ arith: c }) });

function applyToAll() {
  const src = lq.value;
  variant.value = { ...variant.value, layers: variant.value.layers.map(() => JSON.parse(JSON.stringify(src)) as LayerQuant) };
}
const calibration = computed({ get: () => variant.value.activationCalibration, set: (v) => (variant.value = { ...variant.value, activationCalibration: v }) });
const issues = computed(() => validateNetworkQuant(props.net, { layers: variant.value.layers, activationCalibration: variant.value.activationCalibration }).map((i) => ({ severity: 'error' as const, message: i.message })));
</script>

<template>
  <div class="lqe">
    <div class="table-wrap">
      <table class="table layer-table" aria-label="Per-layer quantization settings">
        <thead><tr><th>Layer</th><th>Weights</th><th>Input activations</th><th>Arithmetic</th></tr></thead>
        <tbody>
          <tr v-for="(l, i) in variant.layers.slice(0, L)" :key="i" :class="{ selected: i === layer }" style="cursor: pointer" @click="layer = i">
            <th scope="row"><button type="button" class="row-select" :aria-pressed="i === layer" :aria-label="`Edit layer ${i + 1}`" @click.stop="layer = i">{{ i + 1 }}</button></th>
            <td>{{ summary(l.weight) }}</td>
            <td>{{ summary(l.activation) }}</td>
            <td>{{ l.arith ? `${getFormat(l.arith.productFormat).name}×/${getFormat(l.arith.accumulatorFormat).name}+` : 'FP64' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="field">
      <span class="field-label">Activation calibration</span>
      <Segmented v-model="calibration" label="Activation calibration" small :options="[{ value: 'dynamic', label: 'Dynamic (per input)' }, { value: 'static', label: 'Static (calibration set)' }]" />
      <span class="field-hint">{{ calibration === 'dynamic' ? 'Scales are computed from each input vector as it arrives.' : 'Scales are fixed once using all samples as a calibration set, then reused.' }}</span>
    </div>
    <h4>Layer {{ layer + 1 }} ({{ units }} units × {{ fanIn }} inputs)</h4>
    <label class="check"><input v-model="wOn" type="checkbox" data-testid="nn-weight-quant" /> Quantize weights</label>
    <QuantConfigEditor v-if="lq.weight" :key="`w${layer}`" v-model="wCfg" :shape="[units, fanIn]" :axis-labels="['output units', 'inputs']" id-prefix="nnw" />
    <label class="check"><input v-model="aOn" type="checkbox" data-testid="nn-act-quant" /> Quantize this layer's input activations</label>
    <QuantConfigEditor v-if="lq.activation" :key="`a${layer}`" v-model="aCfg" :shape="[1, fanIn]" :axis-labels="['vector', 'features']" id-prefix="nna" :show-presets="false" />
    <label class="check"><input v-model="arOn" type="checkbox" /> Reduced-precision arithmetic</label>
    <ArithConfigEditor v-if="lq.arith" :key="`r${layer}`" v-model="arCfg" id-prefix="nnr" />
    <button type="button" class="btn btn-sm" @click="applyToAll">Apply layer {{ layer + 1 }} settings to all layers</button>
    <IssueList :issues="issues" />
  </div>
</template>

<style scoped>
.lqe {
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.layer-table td {
  font-size: 11.5px;
}
</style>
