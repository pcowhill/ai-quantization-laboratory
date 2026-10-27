import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';

export type ThemePref = 'system' | 'light' | 'dark';

const THEME_KEY = 'aql.theme';

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* storage unavailable */
  }
  return 'system';
}

export const useUiStore = defineStore('ui', () => {
  const themePref = ref<ThemePref>(readPref());
  const systemDark = ref(typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches);
  if (typeof matchMedia === 'function') {
    matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', (e) => (systemDark.value = e.matches));
  }
  const resolvedTheme = computed<'light' | 'dark'>(() => (themePref.value === 'system' ? (systemDark.value ? 'dark' : 'light') : themePref.value));

  function applyTheme() {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    if (themePref.value === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', themePref.value);
  }
  watch(themePref, (v) => {
    try {
      localStorage.setItem(THEME_KEY, v);
    } catch {
      /* ignore */
    }
    applyTheme();
  });
  applyTheme();

  function cycleTheme() {
    themePref.value = themePref.value === 'system' ? 'light' : themePref.value === 'light' ? 'dark' : 'system';
  }

  const experimentsOpen = ref(false);
  const lessonsOpen = ref(false);
  const helpOpen = ref(false);
  const toasts = ref<{ id: number; text: string; kind: 'info' | 'error' | 'success' }[]>([]);
  let toastId = 0;
  function toast(text: string, kind: 'info' | 'error' | 'success' = 'info') {
    const id = ++toastId;
    toasts.value.push({ id, text, kind });
    setTimeout(() => (toasts.value = toasts.value.filter((t) => t.id !== id)), kind === 'error' ? 7000 : 3500);
  }

  return { themePref, resolvedTheme, cycleTheme, experimentsOpen, lessonsOpen, helpOpen, toasts, toast };
});
