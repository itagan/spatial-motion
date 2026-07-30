import type { Layout } from '../core/types.js'
import { distributeWeighted } from './distribution.js'
import { defineLayout } from './defineLayout.js'

export interface RingOptions {
  /** Radius of the innermost orbit. */
  innerRadius?: number
  /** Distance between adjacent orbits. */
  spacing?: number
  /** Number of concentric orbits. Auto-calculated by default. */
  rings?: number
  /** Angular offset in radians. */
  startAngle?: number
  /** Keep cards upright toward the camera, or rotate them along each orbit. */
  orientation?: 'camera' | 'tangent'
  /** Card size relative to the local radial and angular spacing. */
  density?: number
  /** Allocate each orbit equally, or proportional to its annular area. */
  distribution?: 'area' | 'equal'
  /** Offset alternating orbits by half a card. */
  stagger?: boolean
  /** Reverse angular ordering without changing orbit geometry. */
  clockwise?: boolean
}

export function ring(options: RingOptions = {}): Layout {
  const innerRadius = Math.max(0, finite(options.innerRadius, 0.8))
  const spacing = Math.max(0.01, finite(options.spacing, 0.42))
  const startAngle = finite(options.startAngle, -Math.PI / 2)
  const orientation = options.orientation ?? 'camera'
  const distributionMode = options.distribution ?? 'area'
  const stagger = options.stagger ?? true
  const direction = options.clockwise ? -1 : 1

  return defineLayout({
    name: 'ring',
    orientation: orientation === 'camera' ? 'camera' : 'surface',
    calculateInto(count, _context, target): void {
      if (count <= 0) return
      const ringCount = Math.max(
        1,
        Math.min(count, positiveInteger(options.rings) ?? Math.ceil(Math.sqrt(count / Math.PI))),
      )
      const distribution = calculateOrbitalRingDistribution(
        count,
        ringCount,
        innerRadius,
        spacing,
        distributionMode,
      )
      const density = Math.max(0, finite(options.density, 0.78))
      let targetIndex = 0

      for (let ringIndex = 0; ringIndex < ringCount; ringIndex += 1) {
        const radius = innerRadius + ringIndex * spacing
        const itemsInRing = distribution[ringIndex]
        const angularSpacing = itemsInRing > 1 ? (2 * Math.PI * radius) / itemsInRing : spacing
        const itemScale = Math.min(1, spacing, angularSpacing) * density
        const offset = stagger && ringIndex % 2 === 1 ? Math.PI / Math.max(1, itemsInRing) : 0

        for (let index = 0; index < itemsInRing; index += 1) {
          const angle = startAngle + direction * (offset + (2 * Math.PI * index) / itemsInRing)
          target.setValues(
            targetIndex,
            Math.cos(angle) * radius,
            Math.sin(angle) * radius,
            0,
            itemScale,
            0,
            0,
            orientation === 'tangent' ? angle + Math.PI / 2 : 0,
            1,
          )
          targetIndex += 1
        }
      }
    },
  })
}

function finite(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? value as number : fallback
}

function positiveInteger(value: number | undefined): number | undefined {
  return Number.isInteger(value) && (value ?? 0) > 0 ? value : undefined
}

export function calculateOrbitalRingDistribution(
  count: number,
  rings: number,
  innerRadius: number,
  spacing: number,
  mode: 'area' | 'equal' = 'area',
): number[] {
  const ringCount = Math.max(1, Math.min(Math.max(0, count), Math.floor(rings)))
  if (count <= 0) return []
  const weights = mode === 'equal'
    ? new Array<number>(ringCount).fill(1)
    : Array.from(
      { length: ringCount },
      (_, index) => Math.max(0.01, innerRadius + index * spacing),
    )
  return distributeWeighted(count, weights)
}
