import type { Layout } from '../core/types.js'
import { defineLayout } from './defineLayout.js'

export interface HelixOptions {
  radius?: number
  height?: number
  /** Number of complete turns. Auto-calculated from item count by default. */
  turns?: number
  startAngle?: number
  clockwise?: boolean
  orientation?: 'camera' | 'surface'
  density?: number
}

export function helix(options: HelixOptions = {}): Layout {
  const radius = Math.max(0, options.radius ?? 4.6)
  const height = Math.max(0, options.height ?? 9)
  const startAngle = options.startAngle ?? 0
  const direction = options.clockwise ? -1 : 1
  const orientation = options.orientation ?? 'surface'

  return defineLayout({
    name: 'helix',
    orientation,
    calculateInto(count, _context, target): void {
      if (count <= 0) return
      const turns = Math.max(0.25, options.turns ?? Math.max(2, Math.sqrt(count) / 3))
      const totalAngle = turns * Math.PI * 2
      const pathLength = Math.hypot(totalAngle * radius, height)
      const itemSpacing = count > 1 ? pathLength / (count - 1) : 1
      const itemScale = Math.min(1, itemSpacing * Math.max(0, options.density ?? 0.8))

      for (let index = 0; index < count; index += 1) {
        const progress = count === 1 ? 0.5 : index / (count - 1)
        const angle = startAngle + direction * totalAngle * progress
        target.setValues(
          index,
          Math.sin(angle) * radius,
          height * (0.5 - progress),
          Math.cos(angle) * radius,
          itemScale,
          0,
          orientation === 'surface' ? angle : 0,
          0,
          1,
        )
      }
    },
  })
}
