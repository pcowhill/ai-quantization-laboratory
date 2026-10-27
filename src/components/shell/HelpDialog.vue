<script setup lang="ts">
import Drawer from '@/components/common/Drawer.vue';
import { PRIMARY_FORMAT_IDS, getFormat } from '@/engine/formats/registry';
import { useUiStore } from '@/stores/ui';

const ui = useUiStore();
const repo = 'https://github.com/pcowhill/ai-quantization-laboratory';
const version = import.meta.env.VITE_APP_VERSION ?? 'dev';
</script>

<template>
  <Drawer title="About the AI Quantization Laboratory" width="600px" test-id="help" @close="ui.helpOpen = false">
    <div class="prose help">
      <p>
        An interactive workbench for seeing how numbers are stored, what quantization does to them, and how the resulting errors flow through
        matrix arithmetic into the predictions of small neural networks. Every result comes from an exact, tested numerical engine that runs
        entirely in your browser.
      </p>
      <h3>The four laboratories</h3>
      <ol>
        <li><strong>Number Inspector</strong> — one value, bit by bit, in every format.</li>
        <li><strong>Quantization Workbench</strong> — whole tensors: scales, zero-points, granularity, calibration, error metrics.</li>
        <li><strong>Matrix Laboratory</strong> — storage precision versus arithmetic and accumulation precision.</li>
        <li><strong>Neural Network Laboratory</strong> — weight and activation quantization in small trained MLPs.</li>
      </ol>
      <h3>Experiments</h3>
      <p>
        Everything you change is part of the current <em>experiment</em>, saved automatically in this browser (IndexedDB). Use the experiment
        menu to create, duplicate, branch, snapshot, compare, export and import experiments as JSON. Nothing is uploaded anywhere.
      </p>
      <h3>Keyboard</h3>
      <ul>
        <li><span class="kbd">Alt</span> + <span class="kbd">1</span>…<span class="kbd">4</span> switch laboratory; arrow keys move between tabs.</li>
        <li><span class="kbd">Ctrl</span> + <span class="kbd">Z</span> undo, <span class="kbd">Ctrl</span> + <span class="kbd">Shift</span> + <span class="kbd">Z</span> redo (outside text fields).</li>
        <li><span class="kbd">Esc</span> closes panels.</li>
      </ul>
      <h3>Formats</h3>
      <table class="table">
        <tbody>
          <tr v-for="id in PRIMARY_FORMAT_IDS" :key="id">
            <th>{{ getFormat(id).name }}</th>
            <td>{{ getFormat(id).profile }}</td>
          </tr>
        </tbody>
      </table>
      <h3>Exact versus simulated</h3>
      <p>
        All formats are simulated exactly on top of 64-bit floating point: conversions, rounding modes and overflow rules follow the cited
        specifications and are verified against independent references. Arithmetic is simulated with explicit "round after every operation"
        rules; it does <em>not</em> reproduce the internal behaviour of specific GPU instructions, and storage sizes are estimates, not speed
        predictions. Displayed numbers are rounded for readability — the inspectors and table views show exact values.
      </p>
      <h3>Learn more</h3>
      <ul>
        <li><a :href="`${repo}/blob/main/docs/NUMERICS.md`" target="_blank" rel="noopener noreferrer">Numerical conventions and algorithms</a></li>
        <li><a :href="`${repo}/blob/main/README.md`" target="_blank" rel="noopener noreferrer">Project README</a></li>
        <li><a :href="repo" target="_blank" rel="noopener noreferrer">Source code</a></li>
      </ul>
      <p class="muted small">Version {{ version }}. Works offline after the first visit.</p>
    </div>
  </Drawer>
</template>

<style scoped>
.help h3 {
  margin: 16px 0 6px;
}
.help ol,
.help ul {
  padding-left: 20px;
}
.help li {
  margin-bottom: 4px;
}
.help th {
  white-space: nowrap;
  width: 1%;
}
</style>
