import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5173,
    open: false,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    // maplibre-gl v6 ships its worker as an ES module that Vite's dep-optimizer
    // can't rewrite cleanly. Excluding it forces Vite to use the pre-built ESM
    // directly and preserves the worker URL.
    exclude: ['maplibre-gl'],
  },
});
