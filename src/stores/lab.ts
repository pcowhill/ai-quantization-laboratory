/**
 * The live experiment state shared by all laboratories. Everything a result
 * depends on lives here, so it can be snapshotted, undone, exported and
 * replayed exactly.
 */
import { defineStore } from 'pinia';
import { reactive } from 'vue';
import { plainClone } from '@/state/clone';
import { defaultExperimentState, defaultNetwork } from '@/state/defaults';
import { defaultInspector, defaultMatrix, defaultWorkbench, type ExperimentState, type LabId } from '@/state/schema';

export const useLabStore = defineStore('lab', () => {
  const state = reactive<ExperimentState>(defaultExperimentState());

  function setLab(lab: LabId) {
    state.lab = lab;
  }

  /** Replaces the whole state (used by undo/redo, snapshots, lessons, imports). */
  function replace(next: ExperimentState) {
    const copy = plainClone(next);
    state.schemaVersion = copy.schemaVersion;
    state.lab = copy.lab;
    state.inspector = copy.inspector;
    state.workbench = copy.workbench;
    state.matrix = copy.matrix;
    state.network = copy.network;
  }

  /** Deep, plain copy of the current state. */
  function snapshot(): ExperimentState {
    return plainClone(state) as ExperimentState;
  }

  function resetLab(lab: LabId) {
    switch (lab) {
      case 'inspector':
        state.inspector = defaultInspector();
        break;
      case 'workbench':
        state.workbench = defaultWorkbench();
        break;
      case 'matrix':
        state.matrix = defaultMatrix();
        break;
      case 'network':
        state.network = defaultNetwork();
        break;
    }
  }

  return { state, setLab, replace, snapshot, resetLab };
});
