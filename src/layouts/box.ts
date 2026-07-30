import type { Layout } from '../core/types.js'
import type { TransformBuffer } from '../core/TransformBuffer.js'
import { defineLayout } from './defineLayout.js'

export interface BoxOptions {
  width?: number
  height?: number
  depth?: number
  density?: number
  orientation?: 'camera' | 'surface'
  faces?: BoxFace[]
  /** Empty space from every selected face edge, in world units. */
  edgePadding?: number
  /** Multiplier applied to each selected face area during item allocation. */
  faceWeights?: Partial<Record<BoxFace, number>>
}

export type BoxFace = 'front' | 'back' | 'right' | 'left' | 'top' | 'bottom'

export const boxFaces: readonly BoxFace[] = ['front', 'back', 'right', 'left', 'top', 'bottom']

interface FaceDefinition {
  name: BoxFace
  width: number
  height: number
  write(
    target: TransformBuffer,
    index: number,
    u: number,
    v: number,
    scale: number,
    surfaceOrientation: boolean,
  ): void
}

export function box(options: BoxOptions = {}): Layout {
  const width = positive(options.width, 8)
  const height = positive(options.height, 8)
  const depth = positive(options.depth, 8)
  const density = Math.max(0, finite(options.density, 0.82))
  const orientation = options.orientation ?? 'surface'
  const selectedFaces = normalizeFaces(options.faces)
  const weights = normalizeFaceWeights(options.faceWeights, selectedFaces)
  const edgePadding = Math.max(0, finite(options.edgePadding, 0))
  const faces = createFaces(width, height, depth)

  return defineLayout({
    name: 'box',
    orientation,
    calculateInto(count, _context, target): void {
      if (count <= 0) return
      const distribution = calculateBoxFaceDistribution(
        count,
        width,
        height,
        depth,
        selectedFaces,
        weights,
      )
      const plans = faces.map((face, index) => createFacePlan(face, distribution[index], edgePadding))
      let sharedScale = 1
      for (const plan of plans) {
        if (plan.count > 0) {
          sharedScale = Math.min(sharedScale, plan.cellWidth, plan.cellHeight)
        }
      }
      sharedScale *= density
      let targetIndex = 0
      for (const plan of plans) {
        targetIndex = writeFaceTransformsInto(
          target,
          targetIndex,
          plan,
          sharedScale,
          orientation === 'surface',
        )
      }
    },
  })
}

export function calculateBoxFaceDistribution(
  count: number,
  width: number,
  height: number,
  depth: number,
  selectedFaces: readonly BoxFace[] = boxFaces,
  faceWeights: Partial<Record<BoxFace, number>> = {},
): number[] {
  if (count <= 0) return [0, 0, 0, 0, 0, 0]
  const safeWidth = positive(width, 1)
  const safeHeight = positive(height, 1)
  const safeDepth = positive(depth, 1)
  const areas = [
    safeWidth * safeHeight,
    safeWidth * safeHeight,
    safeDepth * safeHeight,
    safeDepth * safeHeight,
    safeWidth * safeDepth,
    safeWidth * safeDepth,
  ]
  const selected = new Set(normalizeFaces([...selectedFaces]))
  const normalizedWeights = normalizeFaceWeights(faceWeights, [...selected])
  const weights = areas.map((area, index) => {
    const face = boxFaces[index]
    return selected.has(face) ? area * (normalizedWeights[face] ?? 1) : 0
  })
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
      write: (target, index, x, y, scale) => {
        target.setValues(index, x, y, depth / 2, scale, 0, 0, 0, 1)
      },
    },
    {
      name: 'back', width, height,
      write: (target, index, x, y, scale, surface) => {
        target.setValues(index, -x, y, -depth / 2, scale, 0, surface ? Math.PI : 0, 0, 1)
      },
    },
    {
      name: 'right', width: depth, height,
      write: (target, index, z, y, scale, surface) => {
        target.setValues(index, width / 2, y, -z, scale, 0, surface ? Math.PI / 2 : 0, 0, 1)
      },
    },
    {
      name: 'left', width: depth, height,
      write: (target, index, z, y, scale, surface) => {
        target.setValues(index, -width / 2, y, z, scale, 0, surface ? -Math.PI / 2 : 0, 0, 1)
      },
    },
    {
      name: 'top', width, height: depth,
      write: (target, index, x, z, scale, surface) => {
        target.setValues(index, x, height / 2, z, scale, surface ? -Math.PI / 2 : 0, 0, 0, 1)
      },
    },
    {
      name: 'bottom', width, height: depth,
      write: (target, index, x, z, scale, surface) => {
        target.setValues(index, x, -height / 2, -z, scale, surface ? Math.PI / 2 : 0, 0, 0, 1)
      },
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

function createFacePlan(face: FaceDefinition, count: number, edgePadding = 0): FacePlan {
  const maximumPadding = Math.max(0, Math.min(face.width, face.height) / 2 - 1e-6)
  const padding = Math.min(edgePadding, maximumPadding)
  const usableWidth = Math.max(1e-6, face.width - padding * 2)
  const usableHeight = Math.max(1e-6, face.height - padding * 2)
  const columns = count > 0
    ? Math.max(1, Math.ceil(Math.sqrt(count * usableWidth / usableHeight)))
    : 1
  const rows = Math.max(1, Math.ceil(count / columns))
  return {
    face,
    count,
    columns,
    rows,
    cellWidth: usableWidth / columns,
    cellHeight: usableHeight / rows,
  }
}

function writeFaceTransformsInto(
  target: TransformBuffer,
  targetOffset: number,
  plan: FacePlan,
  scale: number,
  surfaceOrientation: boolean,
): number {
  const { face, count, columns, rows, cellWidth, cellHeight } = plan
  for (let index = 0; index < count; index += 1) {
    const row = Math.floor(index / columns)
    const rowItems = Math.min(columns, count - row * columns)
    const column = index % columns
    const u = (column - (rowItems - 1) / 2) * cellWidth
    const v = ((rows - 1) / 2 - row) * cellHeight
    face.write(target, targetOffset + index, u, v, scale, surfaceOrientation)
  }
  return targetOffset + count
}

function positive(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && (value ?? 0) > 0 ? value as number : fallback
}

function finite(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? value as number : fallback
}

function normalizeFaces(faces: BoxFace[] | undefined): BoxFace[] {
  if (!faces?.length) return [...boxFaces]
  const requested = new Set(faces.filter((face) => boxFaces.includes(face)))
  return boxFaces.filter((face) => requested.has(face))
}

function normalizeFaceWeights(
  weights: Partial<Record<BoxFace, number>> | undefined,
  selectedFaces: readonly BoxFace[],
): Partial<Record<BoxFace, number>> {
  const normalized: Partial<Record<BoxFace, number>> = {}
  selectedFaces.forEach((face) => {
    const value = weights?.[face]
    normalized[face] = Number.isFinite(value) && (value ?? -1) >= 0 ? value : 1
  })
  if (selectedFaces.every((face) => normalized[face] === 0)) {
    selectedFaces.forEach((face) => { normalized[face] = 1 })
  }
  return normalized
}
