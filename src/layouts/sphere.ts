import type { Layout, Transform } from '../core/types'

export interface SphereOptions {
  radius?: number
  /** Number of latitude rings including the two poles. Auto-calculated by default. */
  rings?: number
  /** Offset alternating rings by half a card. Disabled to preserve clear meridians by default. */
  stagger?: boolean
  /** Card size relative to the angular distance between latitude rings. */
  density?: number
  /**
   * camera: always face the camera
   * surface: follow both longitude and latitude tangents
   * upright-surface: wrap around the sphere like a cylinder while staying upright
   */
  orientation?: 'camera' | 'surface' | 'upright-surface'
}

export function sphere(options: SphereOptions = {}): Layout {
  const radius = options.radius ?? 5
  const orientation = options.orientation ?? 'upright-surface'
  return {
    name: 'sphere',
    orientation: orientation === 'camera' ? 'camera' : 'surface',
    hideBackHemisphere: orientation === 'camera',
    calculate(count): Transform[] {
      if (count <= 0) return []
      if (count === 1) return [createTransform(0, 1, 0, radius, options.density ?? 0.86, orientation)]

      const rings = Math.max(2, Math.min(count, options.rings ?? calculateRingCount(count)))
      const distribution = calculateRingDistribution(count, rings)
      const angularStep = Math.PI / Math.max(1, rings - 1)
      const itemScale = Math.min(1, radius * angularStep * (options.density ?? 0.86))
      const transforms: Transform[] = []

      for (let ring = 0; ring < rings; ring += 1) {
        const phi = (Math.PI * ring) / (rings - 1)
        const y = Math.cos(phi)
        const ringRadius = Math.sin(phi)
        const itemsInRing = distribution[ring]
        const offset = options.stagger && ring % 2 === 1 ? Math.PI / itemsInRing : 0

        for (let index = 0; index < itemsInRing; index += 1) {
          const theta = itemsInRing === 1 ? 0 : (2 * Math.PI * index) / itemsInRing + offset
          const x = ringRadius * Math.cos(theta)
          const z = ringRadius * Math.sin(theta)
          transforms.push(createTransform(x, y, z, radius, itemScale, orientation))
        }
      }

      return transforms
    },
  }
}

/**
 * For equally spaced latitude and longitude arcs, the equator has about twice
 * as many cards as the number of latitude intervals. This approximation keeps
 * cards close to square while preserving visibly distinct horizontal rings.
 */
export function calculateRingCount(count: number): number {
  return Math.max(3, Math.round(Math.sqrt((count * Math.PI) / 4)) + 1)
}

export function calculateRingDistribution(count: number, rings: number): number[] {
  if (rings <= 1) return [count]
  if (count <= 2) return Array.from({ length: rings }, (_, index) => (index < count ? 1 : 0))

  const distribution = new Array<number>(rings).fill(1)
  const remaining = count - rings
  const weights = Array.from({ length: rings - 2 }, (_, index) =>
    Math.sin((Math.PI * (index + 1)) / (rings - 1)),
  )
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
  const allocations = weights.map((weight, index) => {
    const exact = (remaining * weight) / totalWeight
    return { ring: index + 1, count: Math.floor(exact), fraction: exact - Math.floor(exact) }
  })

  allocations.forEach((allocation) => {
    distribution[allocation.ring] += allocation.count
  })
  let unassigned = remaining - allocations.reduce((sum, allocation) => sum + allocation.count, 0)
  allocations
    .sort((a, b) => b.fraction - a.fraction)
    .forEach((allocation) => {
      if (unassigned > 0) {
        distribution[allocation.ring] += 1
        unassigned -= 1
      }
    })

  return distribution
}

function createTransform(
  x: number,
  y: number,
  z: number,
  radius: number,
  scale: number,
  orientation: NonNullable<SphereOptions['orientation']>,
): Transform {
  return {
    x: x * radius,
    y: y * radius,
    z: z * radius,
    scale,
    rotationX: orientation === 'surface' ? Math.asin(-y) : 0,
    rotationY: Math.atan2(x, z),
    rotationZ: 0,
    opacity: 1,
  }
}
