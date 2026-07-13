import type { Layout, Transform } from '../core/types.js'
import { distributeWeighted } from './distribution.js'

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
}

export function ring(options: RingOptions = {}): Layout {
  const innerRadius = Math.max(0, options.innerRadius ?? 0.8)
  const spacing = Math.max(0.01, options.spacing ?? 0.42)
  const startAngle = options.startAngle ?? -Math.PI / 2
  const orientation = options.orientation ?? 'camera'

  return {
    name: 'ring',
    orientation: orientation === 'camera' ? 'camera' : 'surface',
    calculate(count): Transform[] {
      if (count <= 0) return []
      const ringCount = Math.max(
        1,
        Math.min(count, Math.floor(options.rings ?? Math.ceil(Math.sqrt(count / Math.PI)))),
      )
      const distribution = calculateOrbitalRingDistribution(count, ringCount, innerRadius, spacing)
      const density = Math.max(0, options.density ?? 0.78)
      const transforms: Transform[] = []

      for (let ringIndex = 0; ringIndex < ringCount; ringIndex += 1) {
        const radius = innerRadius + ringIndex * spacing
        const itemsInRing = distribution[ringIndex]
        const angularSpacing = itemsInRing > 1 ? (2 * Math.PI * radius) / itemsInRing : spacing
        const itemScale = Math.min(1, spacing, angularSpacing) * density
        const offset = ringIndex % 2 === 1 ? Math.PI / Math.max(1, itemsInRing) : 0

        for (let index = 0; index < itemsInRing; index += 1) {
          const angle = startAngle + offset + (2 * Math.PI * index) / itemsInRing
          transforms.push({
            x: Math.cos(angle) * radius,
            y: Math.sin(angle) * radius,
            z: 0,
            scale: itemScale,
            rotationX: 0,
            rotationY: 0,
            rotationZ: orientation === 'tangent' ? angle + Math.PI / 2 : 0,
            opacity: 1,
          })
        }
      }

      return transforms
    },
  }
}

export function calculateOrbitalRingDistribution(
  count: number,
  rings: number,
  innerRadius: number,
  spacing: number,
): number[] {
  const ringCount = Math.max(1, Math.min(Math.max(0, count), Math.floor(rings)))
  if (count <= 0) return []
  const weights = Array.from(
    { length: ringCount },
    (_, index) => Math.max(0.01, innerRadius + index * spacing),
  )
  return distributeWeighted(count, weights)
}
