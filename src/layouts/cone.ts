import type { Layout, Transform } from '../core/types.js'
import { distributeWeighted } from './distribution.js'

export interface ConeOptions {
  radius?: number
  /** Radius of the top face. Zero preserves a pointed cone. */
  topRadius?: number
  height?: number
  /** Number of horizontal rings including the apex. Auto-calculated by default. */
  rings?: number
  startAngle?: number
  stagger?: boolean
  orientation?: 'camera' | 'surface' | 'upright-surface'
  density?: number
}

export function cone(options: ConeOptions = {}): Layout {
  const radius = positive(options.radius, 5)
  const topRadius = clamp(finite(options.topRadius, 0), 0, radius)
  const height = positive(options.height, 9)
  const startAngle = finite(options.startAngle, 0)
  const orientation = options.orientation ?? 'upright-surface'

  return {
    name: 'cone',
    orientation: orientation === 'camera' ? 'camera' : 'surface',
    calculate(count): Transform[] {
      if (count <= 0) return []
      if (count === 1) {
        const singleRadius = topRadius
        return [createConeTransform(
          Math.sin(startAngle) * singleRadius,
          height / 2,
          Math.cos(startAngle) * singleRadius,
          1,
          startAngle,
          orientation,
          radius,
          topRadius,
          height,
        )]
      }

      const radiusDelta = radius - topRadius
      const slantHeight = Math.hypot(radiusDelta, height)
      const distributionRadius = topRadius === 0 ? radius : Math.max(0.01, (radius + topRadius) / 2)
      const autoRings = Math.round(Math.sqrt((count * slantHeight) / (Math.PI * distributionRadius)))
      const ringCount = Math.max(2, Math.min(count, positiveInteger(options.rings) ?? autoRings))
      const distribution = calculateConeRingDistribution(count, ringCount, topRadius, radius)
      const slantSpacing = slantHeight / (ringCount - 1)
      const density = Math.max(0, finite(options.density, 0.82))
      const transforms: Transform[] = []

      for (let ringIndex = 0; ringIndex < ringCount; ringIndex += 1) {
        const progress = ringIndex / (ringCount - 1)
        const ringRadius = topRadius + radiusDelta * progress
        const y = height * (0.5 - progress)
        const itemsInRing = distribution[ringIndex]
        const angularSpacing = itemsInRing > 1 ? (2 * Math.PI * ringRadius) / itemsInRing : slantSpacing
        const polarBreathingRoom = ringIndex === 0 && topRadius === 0 ? 0.72 : 1
        const itemScale = Math.min(1, slantSpacing, angularSpacing) * density * polarBreathingRoom
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
            topRadius,
            height,
          ))
        }
      }

      return transforms
    },
  }
}

export function calculateConeRingDistribution(
  count: number,
  rings: number,
  topRadius = 0,
  bottomRadius = 1,
): number[] {
  if (count <= 0) return []
  const ringCount = Math.max(1, Math.min(count, Math.floor(rings)))
  const safeTopRadius = Math.max(0, finite(topRadius, 0))
  const safeBottomRadius = Math.max(0, finite(bottomRadius, 1))
  const weights = Array.from({ length: ringCount }, (_, index) => {
    const progress = index / Math.max(1, ringCount - 1)
    return safeTopRadius + (safeBottomRadius - safeTopRadius) * progress
  })
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
  topRadius = 0,
  height = 1,
): Transform {
  return {
    x,
    y,
    z,
    scale,
    rotationX: orientation === 'surface' ? -Math.atan((radius - topRadius) / height) : 0,
    rotationY: orientation === 'camera' ? 0 : angle,
    rotationZ: 0,
    opacity: 1,
  }
}

function finite(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? value as number : fallback
}

function positive(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && (value ?? 0) > 0 ? value as number : fallback
}

function positiveInteger(value: number | undefined): number | undefined {
  return Number.isInteger(value) && (value ?? 0) > 0 ? value : undefined
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}
