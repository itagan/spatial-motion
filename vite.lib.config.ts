import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    copyPublicDir: false,
    sourcemap: 'hidden',
    minify: 'terser',
    terserOptions: {
      compress: { passes: 2 },
      format: { comments: false },
    },
    lib: {
      entry: {
        index: new URL('./src/index.ts', import.meta.url).pathname,
        'core/index': new URL('./src/core/index.ts', import.meta.url).pathname,
        'layouts/index': new URL('./src/layouts/index.ts', import.meta.url).pathname,
        'effects/index': new URL('./src/effects/index.ts', import.meta.url).pathname,
        'performance/index': new URL('./src/performance/index.ts', import.meta.url).pathname,
        'card-template/index': new URL('./src/card-template/index.ts', import.meta.url).pathname,
        'renderers/cards/index': new URL('./src/renderers/cards/index.ts', import.meta.url).pathname,
        'renderers/points/index': new URL('./src/renderers/points/index.ts', import.meta.url).pathname,
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: ['three'],
      output: {
        preserveModules: true,
        preserveModulesRoot: 'src',
        entryFileNames: '[name].js',
      },
    },
  },
})
