import type { Layout, Transform } from '../core/types.js'

export interface SphereOptions {
  radius?: number
  /** Ring-based latitude rows, or an equal-area Fibonacci distribution. */
  distribution?: 'latitude' | 'fibonacci'
  /** Lower latitude boundary in radians. */
  minLatitude?: number
  /** Upper latitude boundary in radians. */
  maxLatitude?: number
  /** Include exact poles when a latitude boundary reaches them. */
  poleMode?: 'include' | 'exclude'
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
  const radius = positive(options.radius, 5)
  const orientation = options.orientation ?? 'surface'
  const distributionMode = options.distribution ?? 'latitude'
  const [minLatitude, maxLatitude] = latitudeRange(options.minLatitude, options.maxLatitude)
  const poleMode = options.poleMode ?? 'include'
  const legacyLatitudeRange = options.minLatitude === undefined
    && options.maxLatitude === undefined
    && poleMode === 'include'
  return {
    name: 'sphere',
    orientation: orientation === 'camera' ? 'camera' : 'surface',
    hideBackHemisphere: orientation === 'camera',
    calculate(count): Transform[] {
      if (count <= 0) return []
      if (distributionMode === 'fibonacci') {
        return calculateFibonacciSphere(count, radius, minLatitude, maxLatitude, options.density, orientation)
      }
      if (count === 1) {
        const latitude = poleMode === 'include' ? maxLatitude : (minLatitude + maxLatitude) / 2
        if (approximately(latitude, Math.PI / 2)) {
          return [createTransform(0, 1, 0, radius, Math.max(0, finite(options.density, 0.86)), orientation)]
        }
        return [createLatitudeTransform(latitude, 0, radius, options.density ?? 0.86, orientation)]
      }

      const rings = Math.max(2, Math.min(count, positiveInteger(options.rings) ?? calculateRingCount(count)))
      const distribution = calculateRingDistribution(count, rings)
      const latitudeSpan = maxLatitude - minLatitude
      const excludesNorth = poleMode === 'exclude' && approximately(maxLatitude, Math.PI / 2)
      const excludesSouth = poleMode === 'exclude' && approximately(minLatitude, -Math.PI / 2)
      const northInset = excludesNorth ? latitudeSpan / (2 * rings) : 0
      const southInset = excludesSouth ? latitudeSpan / (2 * rings) : 0
      const upperLatitude = maxLatitude - northInset
      const lowerLatitude = minLatitude + southInset
      const angularStep = (upperLatitude - lowerLatitude) / Math.max(1, rings - 1)
      const density = Math.max(0, finite(options.density, 0.86))
      const transforms: Transform[] = []

      for (let ring = 0; ring < rings; ring += 1) {
        const phi = legacyLatitudeRange ? (Math.PI * ring) / (rings - 1) : null
        const latitude = phi === null ? upperLatitude - angularStep * ring : Math.PI / 2 - phi
        const exactPole = phi === null
          ? approximately(Math.abs(latitude), Math.PI / 2)
          : ring === 0 || ring === rings - 1
        const y = phi === null
          ? exactPole ? Math.sign(latitude) : Math.sin(latitude)
          : Math.cos(phi)
        const ringRadius = phi === null
          ? exactPole ? 0 : Math.cos(latitude)
          : Math.sin(phi)
        const itemsInRing = distribution[ring]
        const offset = options.stagger && ring % 2 === 1 ? Math.PI / itemsInRing : 0
        const meridianSpacing = radius * angularStep
        const circumferenceSpacing = itemsInRing > 1
          ? (2 * Math.PI * radius * ringRadius) / itemsInRing
          : meridianSpacing
        const polarBreathingRoom = exactPole ? 0.72 : 1
        const itemScale = Math.min(1, meridianSpacing, circumferenceSpacing)
          * density
          * polarBreathingRoom

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

function calculateFibonacciSphere(
  count: number,
  radius: number,
  minLatitude: number,
  maxLatitude: number,
  densityOption: number | undefined,
  orientation: NonNullable<SphereOptions['orientation']>,
): Transform[] {
  if (count <= 0) return []
  const density = Math.max(0, finite(densityOption, 0.86))
  const minY = Math.sin(minLatitude)
  const maxY = Math.sin(maxLatitude)
  const surfaceArea = 2 * Math.PI * radius * radius * Math.max(0, maxY - minY)
  const itemScale = Math.min(1, Math.sqrt(surfaceArea / Math.max(1, count))) * density
  const goldenAngle = Math.PI * (3 - Math.sqrt(5))

  return Array.from({ length: count }, (_, index) => {
    const progress = (index + 0.5) / count
    const y = maxY + (minY - maxY) * progress
    const ringRadius = Math.sqrt(Math.max(0, 1 - y * y))
    const theta = index * goldenAngle
    return createTransform(
      ringRadius * Math.cos(theta),
      y,
      ringRadius * Math.sin(theta),
      radius,
      itemScale,
      orientation,
    )
  })
}

function createLatitudeTransform(
  latitude: number,
  theta: number,
  radius: number,
  scale: number,
  orientation: NonNullable<SphereOptions['orientation']>,
): Transform {
  const y = Math.sin(latitude)
  const ringRadius = Math.cos(latitude)
  return createTransform(
    ringRadius * Math.cos(theta),
    y,
    ringRadius * Math.sin(theta),
    radius,
    Math.max(0, finite(scale, 0.86)),
    orientation,
  )
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
  // InstancedCardRenderer converts these XYZ Euler angles to a quaternion.
  // Solving the transformed local +Z normal against the radial direction keeps
  // every card plane tangent to the sphere. The Z roll then aligns local +Y
  // with world-up projected onto that tangent plane, so images share one north.
  return {
    x: x * radius,
    y: y * radius,
    z: z * radius,
    scale,
    rotationX: orientation === 'surface' ? Math.atan2(-y, z) : 0,
    rotationY: orientation === 'surface' ? Math.asin(x) : Math.atan2(x, z),
    rotationZ: orientation === 'surface' ? Math.atan2(x * y, z) : 0,
    opacity: 1,
  }
}

function latitudeRange(minimum: number | undefined, maximum: number | undefined): [number, number] {
  const lower = clamp(finite(minimum, -Math.PI / 2), -Math.PI / 2, Math.PI / 2)
  const upper = clamp(finite(maximum, Math.PI / 2), -Math.PI / 2, Math.PI / 2)
  return lower < upper ? [lower, upper] : [-Math.PI / 2, Math.PI / 2]
}

function positive(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value! > 0 ? value! : fallback
}

function positiveInteger(value: number | undefined): number | undefined {
  return Number.isInteger(value) && value! > 0 ? value : undefined
}

function finite(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? value as number : fallback
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function approximately(left: number, right: number): boolean {
  return Math.abs(left - right) < 1e-8
}
