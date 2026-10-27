import { nextTick, ref, watch } from 'vue';
import { useUiStore } from '@/stores/ui';
import { readPalette, type ChartPalette } from './chartTheme';

/** Reactive chart palette that refreshes after the theme attribute changes. */
export function usePalette() {
  const ui = useUiStore();
  const palette = ref<ChartPalette>(readPalette());
  watch(
    () => ui.resolvedTheme,
    () => nextTick(() => (palette.value = readPalette())),
  );
  return palette;
}
