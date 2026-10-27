import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

// GitHub Pages serves this repository at /<repo>/; override with BASE_PATH for other hosts.
const base = process.env.BASE_PATH ?? '/ai-quantization-laboratory/';

export default defineConfig({
  base,
  plugins: [vue()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1200,
  },
});
