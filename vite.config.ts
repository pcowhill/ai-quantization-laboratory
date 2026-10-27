import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { serviceWorker } from './build/serviceWorker.ts';
import pkg from './package.json' with { type: 'json' };

// GitHub Pages serves this repository at /<repo>/; override with BASE_PATH for other hosts.
const base = process.env.BASE_PATH ?? '/ai-quantization-laboratory/';

export default defineConfig({
  base,
  plugins: [vue(), serviceWorker()],
  define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version) },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 800,
    rolldownOptions: {
      output: {
        // Long-lived vendor chunks: the chart library is only needed once a chart is shown.
        codeSplitting: {
          groups: [
            { name: 'echarts', test: /node_modules[\\/](echarts|zrender)[\\/]/, priority: 2 },
            { name: 'vue', test: /node_modules[\\/](@vue|vue|pinia)[\\/]/, priority: 1 },
          ],
        },
      },
    },
  },
});
