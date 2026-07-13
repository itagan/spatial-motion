import { defineConfig } from 'vite'

export default defineConfig({
  root: 'demo',
  resolve: {
    alias: {
      '@spatial-motion': new URL('./src', import.meta.url).pathname,
    },
  },
  build: {
    outDir: '../dist-demo',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        demo: new URL('./demo/index.html', import.meta.url).pathname,
        benchmark: new URL('./demo/benchmark.html', import.meta.url).pathname,
      },
    },
  },
})
