import type { Layout, Transform } from '../core/types.js'

export interface BoxOptions {
  width?: number
  height?: number
  depth?: number
  density?: number
  orientation?: 'camera' | 'surface'
}

type FaceName = 'front' | 'back' | 'right' | 'left' | 'top' | 'bottom'

interface FaceDefinition {
  name: FaceName
  width: number
  height: number
  position(u: number, v: number): Pick<Transform, 'x' | 'y' | 'z'>
  rotation: Pick<Transform, 'rotationX' | 'rotationY' | 'rotationZ'>
}

export function box(options: BoxOptions = {}): Layout {
  const width = positive(options.width, 8)
  const height = positive(options.height, 8)
  const depth = positive(options.depth, 8)
  const density = Math.max(0, options.density ?? 0.82)
  const orientation = options.orientation ?? 'surface'
  const faces = createFaces(width, height, depth)

  return {
    name: 'box',
    orientation,
    calculate(count): Transform[] {
      if (count <= 0) return []
      const distribution = calculateBoxFaceDistribution(count, width, height, depth)
      const plans = faces.map((face, index) => createFacePlan(face, distribution[index]))
      const occupiedPlans = plans.filter(({ count }) => count > 0)
      const sharedScale = Math.min(
        1,
        ...occupiedPlans.flatMap(({ cellWidth, cellHeight }) => [cellWidth, cellHeight]),
      ) * density
      return plans.flatMap((plan) => createFaceTransforms(plan, sharedScale, orientation))
    },
  }
}

export function calculateBoxFaceDistribution(
  count: number,
  width: number,
  height: number,
  depth: number,
): number[] {
  if (count <= 0) return [0, 0, 0, 0, 0, 0]
  const safeWidth = positive(width, 1)
  const safeHeight = positive(height, 1)
  const safeDepth = positive(depth, 1)
  const weights = [
    safeWidth * safeHeight,
    safeWidth * safeHeight,
    safeDepth * safeHeight,
    safeDepth * safeHeight,
    safeWidth * safeDepth,
    safeWidth * safeDepth,
  ]
  const total = weights.reduce((sum, value) => sum + value, 0)
  let allocated = 0
  const remainders = weights.map((weight, index) => {
    const exact = count * weight / total
    const amount = Math.floor(exact)
    allocated += amount
    return { index, fraction: exact - amount, amount }
  })
  const distribution = remainders.map(({ amount }) => amount)
  remainders
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index)
    .forEach(({ index }) => {
      if (allocated < count) {
        distribution[index] += 1
        allocated += 1
      }
    })
  return distribution
}

function createFaces(width: number, height: number, depth: number): FaceDefinition[] {
  return [
    {
      name: 'front', width, height,
      position: (x, y) => ({ x, y, z: depth / 2 }),
      rotation: { rotationX: 0, rotationY: 0, rotationZ: 0 },
    },
    {
      name: 'back', width, height,
      position: (x, y) => ({ x: -x, y, z: -depth / 2 }),
      rotation: { rotationX: 0, rotationY: Math.PI, rotationZ: 0 },
    },
    {
      name: 'right', width: depth, height,
      position: (z, y) => ({ x: width / 2, y, z: -z }),
      rotation: { rotationX: 0, rotationY: Math.PI / 2, rotationZ: 0 },
    },
    {
      name: 'left', width: depth, height,
      position: (z, y) => ({ x: -width / 2, y, z }),
      rotation: { rotationX: 0, rotationY: -Math.PI / 2, rotationZ: 0 },
    },
    {
      name: 'top', width, height: depth,
      position: (x, z) => ({ x, y: height / 2, z }),
      rotation: { rotationX: -Math.PI / 2, rotationY: 0, rotationZ: 0 },
    },
    {
      name: 'bottom', width, height: depth,
      position: (x, z) => ({ x, y: -height / 2, z: -z }),
      rotation: { rotationX: Math.PI / 2, rotationY: 0, rotationZ: 0 },
    },
  ]
}

interface FacePlan {
  face: FaceDefinition
  count: number
  columns: number
  rows: number
  cellWidth: number
  cellHeight: number
}

function createFacePlan(face: FaceDefinition, count: number): FacePlan {
  const columns = count > 0
    ? Math.max(1, Math.ceil(Math.sqrt(count * face.width / face.height)))
    : 1
  const rows = Math.max(1, Math.ceil(count / columns))
  return {
    face,
    count,
    columns,
    rows,
    cellWidth: face.width / columns,
    cellHeight: face.height / rows,
  }
}

function createFaceTransforms(
  plan: FacePlan,
  scale: number,
  orientation: NonNullable<BoxOptions['orientation']>,
): Transform[] {
  const { face, count, columns, rows, cellWidth, cellHeight } = plan
  if (count <= 0) return []

  return Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / columns)
    const rowItems = Math.min(columns, count - row * columns)
    const column = index % columns
    const u = (column - (rowItems - 1) / 2) * cellWidth
    const v = ((rows - 1) / 2 - row) * cellHeight
    return {
      ...face.position(u, v),
      scale,
      ...(orientation === 'surface'
        ? face.rotation
        : { rotationX: 0, rotationY: 0, rotationZ: 0 }),
      opacity: 1,
    }
  })
}

function positive(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && (value ?? 0) > 0 ? value as number : fallback
}
