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
  },
})
