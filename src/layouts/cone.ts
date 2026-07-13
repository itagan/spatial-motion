import type { Layout, Transform } from '../core/types.js'
import { distributeWeighted } from './distribution.js'

export interface ConeOptions {
  radius?: number
  height?: number
  /** Number of horizontal rings including the apex. Auto-calculated by default. */
  rings?: number
  startAngle?: number
  stagger?: boolean
  orientation?: 'camera' | 'surface' | 'upright-surface'
  density?: number
}

export function cone(options: ConeOptions = {}): Layout {
  const radius = Math.max(0.01, options.radius ?? 5)
  const height = Math.max(0.01, options.height ?? 9)
  const startAngle = options.startAngle ?? 0
  const orientation = options.orientation ?? 'upright-surface'

  return {
    name: 'cone',
    orientation: orientation === 'camera' ? 'camera' : 'surface',
    calculate(count): Transform[] {
      if (count <= 0) return []
      if (count === 1) return [createConeTransform(0, height / 2, 0, 1, 0, orientation, radius, height)]

      const slantHeight = Math.hypot(radius, height)
      const autoRings = Math.round(Math.sqrt((count * slantHeight) / (Math.PI * radius)))
      const ringCount = Math.max(2, Math.min(count, Math.floor(options.rings ?? autoRings)))
      const distribution = calculateConeRingDistribution(count, ringCount)
      const slantSpacing = slantHeight / (ringCount - 1)
      const density = Math.max(0, options.density ?? 0.82)
      const transforms: Transform[] = []

      for (let ringIndex = 0; ringIndex < ringCount; ringIndex += 1) {
        const progress = ringIndex / (ringCount - 1)
        const ringRadius = radius * progress
        const y = height * (0.5 - progress)
        const itemsInRing = distribution[ringIndex]
        const angularSpacing = itemsInRing > 1 ? (2 * Math.PI * ringRadius) / itemsInRing : slantSpacing
        const itemScale = Math.min(1, slantSpacing, angularSpacing) * density
        const offset = options.stagger && ringIndex % 2 === 1 ? Math.PI / itemsInRing : 0

        for (let index = 0; index < itemsInRing; index += 1) {
          const angle = itemsInRing === 1
            ? startAngle
            : startAngle + offset + (2 * Math.PI * index) / itemsInRing
          transforms.push(createConeTransform(
            Math.sin(angle) * ringRadius,
            y,
            Math.cos(angle) * ringRadius,
            itemScale,
            angle,
            orientation,
            radius,
            height,
          ))
        }
      }

      return transforms
    },
  }
}

export function calculateConeRingDistribution(count: number, rings: number): number[] {
  if (count <= 0) return []
  const ringCount = Math.max(1, Math.min(count, Math.floor(rings)))
  const weights = Array.from({ length: ringCount }, (_, index) =>
    index === 0 ? 0 : index / Math.max(1, ringCount - 1),
  )
  return distributeWeighted(count, weights)
}

function createConeTransform(
  x: number,
  y: number,
  z: number,
  scale: number,
  angle: number,
  orientation: NonNullable<ConeOptions['orientation']>,
  radius = 1,
  height = 1,
): Transform {
  return {
    x,
    y,
    z,
    scale,
    rotationX: orientation === 'surface' ? -Math.atan(radius / height) : 0,
    rotationY: orientation === 'camera' ? 0 : angle,
    rotationZ: 0,
    opacity: 1,
  }
}
