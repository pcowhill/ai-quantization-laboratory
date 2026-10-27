<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { characteristics, getFormat, PRIMARY_FORMAT_IDS, VARIANT_FORMAT_IDS } from '@/engine/formats/registry';
import type { FormatId } from '@/engine/formats/types';
import { exactDecimal } from '@/engine/float/rational';
import { bitsToHex, encode } from '@/engine/float/codec';
import { encodeInt } from '@/engine/int/codec';
import { inspect, toggleBit, type InspectedValue } from '@/labs/inspector';
import { INSPECTOR_PRESETS } from '@/labs/inspectorPresets';
import { useLabStore } from '@/stores/lab';
import { fmt } from '@/ui/format';
import Section from '@/components/common/Section.vue';
import FormatSelect from '@/components/common/FormatSelect.vue';
import RoundingSelect from '@/components/common/RoundingSelect.vue';
import Segmented from '@/components/common/Segmented.vue';
import NumberField from '@/components/common/NumberField.vue';
import InfoTip from '@/components/common/InfoTip.vue';
import CopyButton from '@/components/common/CopyButton.vue';
import BitEditor from './BitEditor.vue';
import RangeDiagram from './RangeDiagram.vue';
import NumberLine from './NumberLine.vue';
import FormatFacts from './FormatFacts.vue';

const lab = useLabStore();
const s = computed(() => lab.state.inspector);
const result = computed(() => inspect(s.value));
const fmtDef = computed(() => getFormat(s.value.format));
const isFloat = computed(() => fmtDef.value.kind === 'float');
const base = ref<'binary' | 'hex' | 'decimal'>('binary');

// Text input: edits typed by the user are committed after a short pause and
// clear any bit override. Programmatic updates of the input (e.g. after a bit
// is toggled) are mirrored into the field without clearing the override.
const text = ref(s.value.input);
let timer: ReturnType<typeof setTimeout> | null = null;
let syncing = false;
watch(text, (v) => {
  if (syncing) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    if (v !== s.value.input) {
      s.value.input = v;
      s.value.bitsOverride = null;
    }
  }, 180);
});
watch(
  () => s.value.input,
  (v) => {
    if (v === text.value) return;
    if (timer) clearTimeout(timer);
    syncing = true;
    text.value = v;
    void nextTick(() => (syncing = false));
  },
);

function valueToInput(v: number): string {
  if (Number.isNaN(v)) return 'nan';
  if (v === Infinity) return 'inf';
  if (v === -Infinity) return '-inf';
  return exactDecimal(v);
}

function setBits(hex: string) {
  const p = result.value.primary;
  if (!p) return;
  s.value.bitsOverride = hex;
  const after = inspect(s.value).primary;
  if (after) s.value.input = valueToInput(after.value);
}

function onToggle(index: number) {
  const p = result.value.primary;
  if (!p) return;
  setBits(toggleBit(p.hex, p.width, index));
}

function step(dir: 1 | -1) {
  const n = result.value.neighbours.find((x) => x.offset === dir);
  if (n && n.bitsHex) setBits(n.bitsHex);
}

function setSpecial(kind: 'max' | 'minNormal' | 'minSub' | 'zero' | 'inf' | 'nan') {
  const f = fmtDef.value;
  if (f.kind === 'int') {
    const q = kind === 'max' ? f.max : kind === 'minSub' ? 1 : 0;
    setBits(bitsToHex(encodeInt(f, q), f.totalBits));
    return;
  }
  const c = characteristics(f);
  const v = { max: c.maxFinite, minNormal: c.minNormal, minSub: c.minSubnormal, zero: 0, inf: Infinity, nan: NaN }[kind];
  setBits(bitsToHex(encode(f, v), f.totalBits));
}

function changeFormat(id: FormatId) {
  // Carry the current value into the new format (edited bit patterns belong to the old format).
  const p = result.value.primary;
  if (s.value.bitsOverride !== null && p) s.value.input = valueToInput(p.value);
  s.value.bitsOverride = null;
  s.value.format = id;
}
const formatModel = computed({ get: () => s.value.format, set: changeFormat });

function applyPreset(id: string) {
  const preset = INSPECTOR_PRESETS.find((p) => p.id === id);
  const v = preset?.value(s.value.format);
  if (v === null || v === undefined) return;
  s.value.bitsOverride = null;
  s.value.input = v;
  text.value = v;
}
const presetGroups = computed(() => {
  const groups = new Map<string, typeof INSPECTOR_PRESETS>();
  for (const p of INSPECTOR_PRESETS) {
    if (p.value(s.value.format) === null) continue;
    if (!groups.has(p.group)) groups.set(p.group, []);
    groups.get(p.group)!.push(p);
  }
  return [...groups.entries()];
});

const allFormats = [...PRIMARY_FORMAT_IDS, ...VARIANT_FORMAT_IDS];
function toggleCompare(id: FormatId) {
  const list = s.value.compareFormats;
  const i = list.indexOf(id);
  if (i >= 0) list.splice(i, 1);
  else s.value.compareFormats = allFormats.filter((f) => f === id || list.includes(f));
}

/** Exact stored value; long expansions are shortened to 20 significant digits and marked with "…". */
function storedDisplay(p: InspectedValue) {
  if (!Number.isFinite(p.value)) return fmt(p.value);
  const e = p.exactStored;
  const digits = e.replace(/^-/, '').replace('.', '').replace(/^0+/, '');
  if (digits.length <= 20) return e.replace(/^-/, '−');
  return `${fmt(p.value, 20)}…`;
}

function classLabel(p: InspectedValue) {
  return { zero: 'zero', subnormal: 'subnormal', normal: 'normal', infinity: 'infinity', nan: 'NaN', integer: 'integer' }[p.cls];
}

const showOverflow = computed(() => isFloat.value && characteristics(fmtDef.value as never).hasNaN !== false && fmtDef.value.id !== 'fp4_e2m1');
</script>

<template>
  <div class="lab-layout">
    <aside class="lab-side" aria-label="Number Inspector controls">
      <div class="lab-side-head">
        <h1>Number Inspector</h1>
        <p>How is this number represented?</p>
      </div>
      <Section title="Value">
        <div class="field">
          <label for="insp-input">Number <InfoTip text="Decimal (1.25e-3), fraction (1/3), hexadecimal float (0x1.8p+1), inf, -inf or nan. The value is kept exactly and rounded once, directly into the selected format." /></label>
          <input id="insp-input" v-model="text" class="input num" :class="{ invalid: !!result.error }" spellcheck="false" autocomplete="off" data-testid="inspector-input" />
          <span v-if="result.error" class="field-hint" style="color: var(--critical)" role="alert">{{ result.error }}</span>
          <span v-else-if="s.bitsOverride !== null" class="field-hint">Value set by editing bits (pattern 0x{{ s.bitsOverride.toUpperCase() }}).</span>
        </div>
        <div v-for="[group, presets] in presetGroups" :key="group" class="preset-group">
          <span class="field-label">{{ group }}</span>
          <div class="chips">
            <button v-for="p in presets" :key="p.id" type="button" class="chip" :title="p.description" :data-testid="`preset-${p.id}`" @click="applyPreset(p.id)">{{ p.label }}</button>
          </div>
        </div>
      </Section>
      <Section title="Format & rounding">
        <FormatSelect v-model="formatModel" label="Format" test-id="inspector-format" />
        <RoundingSelect v-model="s.rounding" test-id="inspector-rounding" />
        <NumberField v-if="s.rounding === 'stochastic'" v-model="s.seed" label="Random seed" :min="0" :max="4294967295" integer info="Stochastic rounding uses a seeded generator, so the same seed always gives the same result." />
        <div v-if="showOverflow" class="field">
          <span class="field-label">Overflow <InfoTip text="Saturating: values beyond the largest finite value become ±max. Non-saturating: IEEE formats follow IEEE 754 §7.4 (±∞ for round-to-nearest); OCP E5M2 gives ±∞; OCP E4M3 gives NaN." /></span>
          <Segmented v-model="s.overflow" label="Overflow mode" :options="[{ value: 'nonsaturate', label: 'Non-saturating' }, { value: 'saturate', label: 'Saturating' }]" small />
        </div>
        <label v-if="isFloat" class="check"><input v-model="s.ftz" type="checkbox" /> Flush subnormal results to zero</label>
        <NumberField v-if="!isFloat" v-model="s.intScale" label="Integer scale" :min="0" info="Integer formats store q = round(x / scale) clamped to the range; the represented value is q × scale. Scale 1 shows the raw integer." />
      </Section>
      <Section title="About this format">
        <FormatFacts :id="s.format" />
      </Section>
    </aside>

    <div class="lab-content">
      <div v-if="result.primary" class="card hero" data-testid="inspector-result">
        <div class="hero-main">
          <div class="hero-col">
            <span class="hero-label">Exact input</span>
            <span class="hero-value num" data-testid="inspector-exact-input">{{ result.inputExact ?? '(edited bits)' }}</span>
          </div>
          <span class="arrow" aria-hidden="true">→</span>
          <div class="hero-col">
            <span class="hero-label">Stored in {{ result.primary.formatName }}</span>
            <span class="hero-value num stored" data-testid="inspector-stored">{{ storedDisplay(result.primary) }}</span>
            <span class="hero-sub muted">shortest decimal that rounds back to it: <span class="num">{{ result.primary.shortest }}</span></span>
          </div>
          <div class="hero-badges">
            <span class="badge badge-accent">{{ classLabel(result.primary) }}</span>
            <span v-for="f in result.primary.flagLabels" :key="f" class="badge" :class="/overflow|NaN|invalid|∞|saturated/.test(f) ? 'badge-critical' : /underflow|zero/.test(f) ? 'badge-warning' : ''">{{ f }}</span>
          </div>
        </div>
        <div class="hero-rows">
          <div><span class="k">Hex</span> <code class="num" data-testid="inspector-hex">0x{{ result.primary.hex }}</code> <CopyButton :text="'0x' + result.primary.hex" label="Copy hex" /></div>
          <div><span class="k">Binary</span> <code class="num">{{ result.primary.binary }}</code> <CopyButton :text="result.primary.binary" label="Copy binary" /></div>
          <div class="exact-row"><span class="k">Exact stored value</span> <code class="num exact">{{ result.primary.exactStored }}</code> <CopyButton :text="result.primary.exactStored" label="Copy exact value" /></div>
          <div v-if="result.primary.code !== null"><span class="k">Integer code</span> <code class="num">{{ result.primary.code }}</code></div>
        </div>
        <ul v-if="result.primary.notes.length" class="notes">
          <li v-for="n in result.primary.notes" :key="n" class="callout callout-warning">{{ n }}</li>
        </ul>
      </div>

      <div v-if="result.primary" class="card">
        <div class="card-header">
          <h2>Bit pattern <span class="muted small">— click any bit to flip it</span></h2>
          <div class="row">
            <Segmented v-model="base" label="Field display base" small :options="[{ value: 'binary', label: 'Binary' }, { value: 'hex', label: 'Hex' }, { value: 'decimal', label: 'Decimal' }]" />
          </div>
        </div>
        <div class="card-body stack">
          <BitEditor :value="result.primary" :base="base" @toggle="onToggle" />
          <div class="formula num" data-testid="inspector-formula">{{ result.primary.formula }}</div>
          <div class="row">
            <button type="button" class="btn btn-sm" data-testid="step-down" @click="step(-1)">◀ Previous value</button>
            <button type="button" class="btn btn-sm" data-testid="step-up" @click="step(1)">Next value ▶</button>
            <span class="spacer" />
            <button type="button" class="btn btn-sm btn-ghost" @click="setSpecial('zero')">+0</button>
            <button type="button" class="btn btn-sm btn-ghost" @click="setSpecial('minSub')">{{ isFloat ? 'Min subnormal' : '1' }}</button>
            <button v-if="isFloat" type="button" class="btn btn-sm btn-ghost" @click="setSpecial('minNormal')">Min normal</button>
            <button type="button" class="btn btn-sm btn-ghost" @click="setSpecial('max')">Max</button>
            <button v-if="isFloat && characteristics(fmtDef as never).hasInfinity" type="button" class="btn btn-sm btn-ghost" @click="setSpecial('inf')">+∞</button>
            <button v-if="isFloat && characteristics(fmtDef as never).hasNaN" type="button" class="btn btn-sm btn-ghost" @click="setSpecial('nan')">NaN</button>
          </div>
        </div>
      </div>

      <div v-if="result.primary" class="grid-2">
        <div class="card">
          <div class="card-header"><h2>Representation error</h2></div>
          <div class="card-body">
            <div class="stat-grid">
              <div class="stat">
                <div class="stat-label">Absolute error <InfoTip text="|stored − exact input|, computed exactly with rational arithmetic and then rounded to FP64 for display." /></div>
                <div class="stat-value" data-testid="inspector-abs-error">{{ fmt(result.primary.absError, 6) }}</div>
              </div>
              <div class="stat">
                <div class="stat-label">Relative error <InfoTip text="|stored − exact| / |exact|. Undefined (—) when the exact input is 0 and the stored value differs." /></div>
                <div class="stat-value">{{ fmt(result.primary.relError, 6) }}</div>
              </div>
              <div class="stat">
                <div class="stat-label">Error in spacings <InfoTip text="Absolute error divided by the gap between adjacent representable values at the stored value (1 ulp). Round-to-nearest keeps this ≤ 0.5 for in-range values." /></div>
                <div class="stat-value">{{ fmt(result.primary.ulpError, 4) }}</div>
              </div>
              <div class="stat">
                <div class="stat-label">Spacing here (ulp)</div>
                <div class="stat-value">{{ fmt(result.primary.spacing, 6) }}</div>
              </div>
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><h2>Neighbouring values</h2></div>
          <div class="card-body">
            <NumberLine :neighbours="result.neighbours" :input="result.primary.input && result.primary.input.kind === 'finite' ? (result.primary.input.negative ? -1 : 1) * Number(result.primary.input.num) / Number(result.primary.input.den) : null" :stored="result.primary.value" />
            <div class="table-wrap neighbour-table">
              <table class="table">
                <thead><tr><th>Offset</th><th class="num">Value</th><th>Bits</th><th class="num">Gap to next</th></tr></thead>
                <tbody>
                  <tr v-for="(n, i) in result.neighbours" :key="n.offset" :class="{ selected: n.offset === 0 }">
                    <td>{{ n.offset === 0 ? 'stored' : (n.offset > 0 ? '+' : '') + n.offset }}</td>
                    <td class="num">{{ fmt(n.value, 10) }}</td>
                    <td class="num">0x{{ n.bitsHex }}</td>
                    <td class="num">{{ i + 1 < result.neighbours.length ? fmt(result.neighbours[i + 1]!.value - n.value, 4) : '' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <div v-if="result.primary" class="card">
        <div class="card-header">
          <h2>Same input in every format</h2>
          <span class="muted small">Click a row to inspect that format. Integer formats use scale {{ s.intScale }}.</span>
        </div>
        <div class="card-body">
          <div class="chips compare-toggle" role="group" aria-label="Formats in comparison">
            <button v-for="id in allFormats" :key="id" type="button" class="chip" :class="{ on: s.compareFormats.includes(id) }" :aria-pressed="s.compareFormats.includes(id)" @click="toggleCompare(id)">{{ getFormat(id).name }}</button>
          </div>
          <div class="table-wrap">
            <table class="table" data-testid="compare-table">
              <thead>
                <tr><th>Format</th><th class="num">Stored value (exact, up to 20 digits)</th><th>Bits</th><th>Class</th><th class="num">Abs. error</th><th class="num">Rel. error</th><th>Flags</th></tr>
              </thead>
              <tbody>
                <tr v-for="c in result.comparison" :key="c.formatId" :class="{ selected: c.formatId === s.format }" style="cursor: pointer" @click="changeFormat(c.formatId)">
                  <th scope="row"><button type="button" class="row-select" :aria-pressed="c.formatId === s.format" :title="`Inspect in ${c.formatName}`" @click.stop="changeFormat(c.formatId)">{{ c.formatName }}</button></th>
                  <td class="num" :title="`Exact: ${c.exactStored}`">{{ storedDisplay(c) }}</td>
                  <td class="num">0x{{ c.hex }}</td>
                  <td>{{ classLabel(c) }}</td>
                  <td class="num">{{ fmt(c.absError, 4) }}</td>
                  <td class="num">{{ fmt(c.relError, 4) }}</td>
                  <td class="flags">{{ c.flagLabels.join(', ') }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h2>Dynamic range of floating-point formats</h2></div>
        <div class="card-body">
          <RangeDiagram :formats="allFormats" :selected="s.format" :value="result.primary?.value ?? null" @select="changeFormat" />
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h2>Why FP16 and BF16 behave so differently</h2></div>
        <div class="card-body prose grid-2">
          <div>
            <p>Both use 16 bits, but they split them differently. <strong>FP16</strong> has 5 exponent bits and 10 fraction bits; <strong>BF16</strong> keeps FP32's 8 exponent bits and only 7 fraction bits.</p>
            <p>That makes FP16 about <em>8× more precise</em> near 1 (spacing 2⁻¹⁰ ≈ 0.00098 versus 2⁻⁷ ≈ 0.0078), while BF16 has <em>the same range as FP32</em>: up to ≈3.4 × 10³⁸ instead of 65 504.</p>
            <p>Try <code>70000</code>: FP16 overflows, BF16 stores 70144. Try <code>1.001</code>: FP16 stores 1.0009765625, BF16 rounds to 1.</p>
          </div>
          <table class="table">
            <thead><tr><th></th><th class="num">FP16</th><th class="num">BF16</th><th class="num">FP32</th></tr></thead>
            <tbody>
              <tr><th>Exponent / fraction bits</th><td class="num">5 / 10</td><td class="num">8 / 7</td><td class="num">8 / 23</td></tr>
              <tr><th>Max finite</th><td class="num">65504</td><td class="num">≈3.39e38</td><td class="num">≈3.40e38</td></tr>
              <tr><th>Min normal</th><td class="num">≈6.10e−5</td><td class="num">≈1.18e−38</td><td class="num">≈1.18e−38</td></tr>
              <tr><th>Spacing at 1 (ε)</th><td class="num">2⁻¹⁰</td><td class="num">2⁻⁷</td><td class="num">2⁻²³</td></tr>
              <tr><th>Decimal digits ≈</th><td class="num">3.3</td><td class="num">2.4</td><td class="num">7.2</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.preset-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.chip {
  border: 1px solid var(--border-strong);
  background: var(--surface);
  border-radius: 999px;
  padding: 2px 9px;
  font-size: 12px;
  cursor: pointer;
  color: var(--text-2);
}
.chip:hover {
  background: var(--accent-softer);
  border-color: var(--accent);
}
.chip.on {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent-strong);
  font-weight: 600;
}
.compare-toggle {
  margin-bottom: 8px;
}
.hero {
  padding: 14px 16px;
}
.hero-main {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px 18px;
}
.hero-col {
  display: flex;
  flex-direction: column;
  min-width: 0;
  max-width: 100%;
}
.hero-label {
  font-size: 11.5px;
  color: var(--text-3);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.hero-value {
  font-size: 22px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.hero-sub {
  font-size: 11.5px;
}
.hero-value.stored {
  color: var(--accent-strong);
}
.arrow {
  font-size: 22px;
  color: var(--text-3);
}
.hero-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-left: auto;
}
.hero-rows {
  margin-top: 10px;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 4px 18px;
  font-size: 12.5px;
}
.hero-rows .k {
  color: var(--text-3);
  margin-right: 4px;
}
.exact-row {
  grid-column: 1 / -1;
}
.exact {
  overflow-wrap: anywhere;
}
.notes {
  list-style: none;
  padding: 0;
  margin: 8px 0 0;
}
.formula {
  padding: 8px 10px;
  background: var(--surface-2);
  border-radius: var(--radius);
  font-size: 13px;
  overflow-wrap: anywhere;
}
.neighbour-table {
  max-height: 260px;
  margin-top: 6px;
}
.flags {
  font-size: 11.5px;
  color: var(--text-2);
}
</style>
