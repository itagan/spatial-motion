import { execFileSync } from 'node:child_process'
import { defineConfig } from 'vite'

const root = new URL('.', import.meta.url).pathname

export default defineConfig({
  root: 'demo',
  define: {
    __SPATIAL_MOTION_SOURCE_REVISION__: JSON.stringify(resolveRevision()),
  },
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

function resolveRevision(): string {
  try {
    const revision = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim()
    const status = execFileSync('git', ['status', '--porcelain'], {
      cwd: root,
      encoding: 'utf8',
    }).trim()
    const dirty = status.split('\n').filter(Boolean).some((entry) =>
      !statusPath(entry).startsWith('benchmarks/results/'))
    return dirty ? `${revision}-dirty` : revision
  } catch {
    return 'unknown'
  }
}

function statusPath(entry: string): string {
  const path = entry.slice(3)
  const renameSeparator = path.lastIndexOf(' -> ')
  return renameSeparator >= 0 ? path.slice(renameSeparator + 4) : path
}
