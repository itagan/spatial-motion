import type { Layout, Transform } from '../core/types.js'

export interface GridOptions {
  columns?: number
  gap?: number
}

export function grid(options: GridOptions = {}): Layout {
  const gap = options.gap ?? 1.3
  return {
    name: 'grid',
    calculate(count): Transform[] {
      const columns = Math.max(1, options.columns ?? Math.ceil(Math.sqrt(count)))
      const rows = Math.ceil(count / columns)
      return Array.from({ length: count }, (_, index) => ({
        x: (index % columns - (columns - 1) / 2) * gap,
        y: ((rows - 1) / 2 - Math.floor(index / columns)) * gap,
        z: 0,
        scale: Math.min(1, gap * 0.82),
        rotationX: 0,
        rotationY: 0,
        rotationZ: 0,
        opacity: 1,
      }))
    },
  }
}
