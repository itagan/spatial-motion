import type { Layout, Transform } from '../core/types.js'

export interface CylinderOptions {
  radius?: number
  spacing?: number
  columns?: number
}

export function cylinder(options: CylinderOptions = {}): Layout {
  const radius = options.radius ?? 5
  return {
    name: 'cylinder',
    calculate(count): Transform[] {
      // A cylinder with height close to its diameter needs roughly π times
      // as many columns as rows to keep cards visually square and evenly dense.
      const columns = Math.max(1, options.columns ?? Math.ceil(Math.sqrt(count * Math.PI)))
      const rows = Math.ceil(count / columns)
      const horizontalSpacing = (2 * Math.PI * radius) / columns
      const spacing = options.spacing ?? horizontalSpacing
      const itemScale = Math.min(1, horizontalSpacing, spacing) * 0.78
      return Array.from({ length: count }, (_, index) => {
        const row = Math.floor(index / columns)
        const column = index % columns
        const rowItems = Math.min(columns, count - row * columns)
        const angle = ((column + (row % 2 === 1 ? 0.5 : 0)) / rowItems) * Math.PI * 2
        return {
          x: Math.sin(angle) * radius,
          y: (rows / 2 - row - 0.5) * spacing,
          z: Math.cos(angle) * radius,
          scale: itemScale,
          rotationX: 0,
          rotationY: angle,
          rotationZ: 0,
          opacity: 1,
        }
      })
    },
  }
}
