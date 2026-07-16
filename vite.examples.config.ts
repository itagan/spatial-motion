import { defineConfig } from 'vite'

export default defineConfig({
  root: 'examples',
  build: {
    outDir: '../dist-examples',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        vanilla: new URL('./examples/vanilla/index.html', import.meta.url).pathname,
        'three-extension': new URL('./examples/three-extension/index.html', import.meta.url).pathname,
        'gsap-extension': new URL('./examples/gsap-extension/index.html', import.meta.url).pathname,
      },
    },
  },
})
