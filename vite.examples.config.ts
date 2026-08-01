import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  root: 'examples',
  plugins: [vue()],
  build: {
    outDir: '../dist-examples',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        vanilla: new URL('./examples/vanilla/index.html', import.meta.url).pathname,
        'three-extension': new URL('./examples/three-extension/index.html', import.meta.url).pathname,
        'gsap-extension': new URL('./examples/gsap-extension/index.html', import.meta.url).pathname,
        'custom-card-effect': new URL('./examples/custom-card-effect/index.html', import.meta.url).pathname,
        'custom-renderer-layout': new URL('./examples/custom-renderer-layout/index.html', import.meta.url).pathname,
        'lottery-screen': new URL('./examples/lottery-screen/index.html', import.meta.url).pathname,
      },
    },
  },
})
