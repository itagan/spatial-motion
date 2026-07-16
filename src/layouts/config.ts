import type { Layout } from '../core/types.js'
import { box, boxFaces, type BoxFace, type BoxOptions } from './box.js'
import { cone, type ConeOptions } from './cone.js'
import { cylinder, type CylinderOptions } from './cylinder.js'
import { grid, type GridOptions } from './grid.js'
import { helix, type HelixOptions } from './helix.js'
import { ring, type RingOptions } from './ring.js'
import { scatter, type ScatterOptions } from './scatter.js'
import { sphere, type SphereOptions } from './sphere.js'

export type LayoutConfig =
  | { version: 1; type: 'sphere'; options?: SphereOptions }
  | { version: 1; type: 'box'; options?: BoxOptions }
  | { version: 1; type: 'cylinder'; options?: CylinderOptions }
  | { version: 1; type: 'grid'; options?: GridOptions }
  | { version: 1; type: 'ring'; options?: RingOptions }
  | { version: 1; type: 'helix'; options?: HelixOptions }
  | { version: 1; type: 'cone'; options?: ConeOptions }
  | { version: 1; type: 'scatter'; options?: ScatterOptions }

export type LayoutConfigType = LayoutConfig['type']

type Validator = (value: unknown, path: string) => void

const finite: Validator = (value, path) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, 'must be a finite number')
}

const positive: Validator = (value, path) => {
  finite(value, path)
  if ((value as number) <= 0) fail(path, 'must be greater than 0')
}

const nonNegative: Validator = (value, path) => {
  finite(value, path)
  if ((value as number) < 0) fail(path, 'must be greater than or equal to 0')
}

const positiveInteger: Validator = (value, path) => {
  positive(value, path)
  if (!Number.isInteger(value)) fail(path, 'must be an integer')
}

const boolean: Validator = (value, path) => {
  if (typeof value !== 'boolean') fail(path, 'must be a boolean')
}

const enumOf = <T extends string>(values: readonly T[]): Validator => (value, path) => {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    fail(path, `must be one of ${values.join(', ')}`)
  }
}

const opacity: Validator = (value, path) => {
  finite(value, path)
  if ((value as number) < 0 || (value as number) > 1) fail(path, 'must be between 0 and 1')
}

const latitude: Validator = (value, path) => {
  finite(value, path)
  if ((value as number) < -Math.PI / 2 || (value as number) > Math.PI / 2) {
    fail(path, 'must be between -π/2 and π/2')
  }
}

const arcAngle: Validator = (value, path) => {
  positive(value, path)
  if ((value as number) > Math.PI * 2) fail(path, 'must be less than or equal to 2π')
}

const boxFaceList: Validator = (value, path) => {
  if (!Array.isArray(value) || value.length === 0) fail(path, 'must be a non-empty array')
  const seen = new Set<string>()
  value.forEach((face, index) => {
    if (typeof face !== 'string' || !boxFaces.includes(face as BoxFace)) {
      fail(`${path}.${index}`, `must be one of ${boxFaces.join(', ')}`)
    }
    if (seen.has(face)) fail(`${path}.${index}`, 'must not be duplicated')
    seen.add(face)
  })
}

const boxFaceWeights: Validator = (value, path) => {
  if (!isRecord(value)) fail(path, 'must be an object')
  rejectUnknownKeys(value, [...boxFaces], path)
  Object.entries(value).forEach(([face, weight]) => nonNegative(weight, `${path}.${face}`))
}

const schemas: Record<LayoutConfigType, Record<string, Validator>> = {
  sphere: {
    radius: positive,
    distribution: enumOf(['latitude', 'fibonacci']),
    minLatitude: latitude,
    maxLatitude: latitude,
    poleMode: enumOf(['include', 'exclude']),
    rings: positiveInteger,
    stagger: boolean,
    density: nonNegative,
    orientation: enumOf(['camera', 'surface', 'upright-surface']),
  },
  box: {
    width: positive,
    height: positive,
    depth: positive,
    density: nonNegative,
    orientation: enumOf(['camera', 'surface']),
    faces: boxFaceList,
    edgePadding: nonNegative,
    faceWeights: boxFaceWeights,
  },
  cylinder: {
    radius: positive,
    spacing: positive,
    columns: positiveInteger,
    rows: positiveInteger,
    startAngle: finite,
    arcAngle,
    density: nonNegative,
    orientation: enumOf(['camera', 'surface']),
  },
  grid: {
    columns: positiveInteger,
    gap: positive,
    fit: enumOf(['fixed', 'contain', 'cover']),
  },
  ring: {
    innerRadius: nonNegative,
    spacing: positive,
    rings: positiveInteger,
    startAngle: finite,
    orientation: enumOf(['camera', 'tangent']),
    density: nonNegative,
    distribution: enumOf(['area', 'equal']),
    stagger: boolean,
    clockwise: boolean,
  },
  helix: {
    radius: nonNegative,
    height: nonNegative,
    turns: positive,
    startAngle: finite,
    clockwise: boolean,
    orientation: enumOf(['camera', 'surface']),
    density: nonNegative,
  },
  cone: {
    radius: positive,
    topRadius: nonNegative,
    height: positive,
    rings: positiveInteger,
    startAngle: finite,
    stagger: boolean,
    orientation: enumOf(['camera', 'surface', 'upright-surface']),
    density: nonNegative,
  },
  scatter: {
    direction: enumOf(['random', 'radial', 'left', 'right']),
    distance: positive,
    depth: nonNegative,
    spin: nonNegative,
    spinMode: enumOf(['random', 'directional']),
    layers: positiveInteger,
    scale: nonNegative,
    opacity,
    seed: finite,
  },
}

export function parseLayoutConfig(value: unknown): LayoutConfig {
  let parsed = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value) as unknown
    } catch (error) {
      fail('$', `must be valid JSON (${error instanceof Error ? error.message : 'parse failed'})`)
    }
  }
  if (!isRecord(parsed)) fail('$', 'must be an object')
  rejectUnknownKeys(parsed, ['version', 'type', 'options'], '$')
  if (parsed.version !== 1) fail('version', 'must equal 1')
  if (typeof parsed.type !== 'string' || !Object.hasOwn(schemas, parsed.type)) {
    fail('type', `must be one of ${Object.keys(schemas).join(', ')}`)
  }

  const type = parsed.type as LayoutConfigType
  if (parsed.options !== undefined && !isRecord(parsed.options)) fail('options', 'must be an object')
  const sourceOptions = parsed.options as Record<string, unknown> | undefined
  if (!sourceOptions) return { version: 1, type } as LayoutConfig

  const schema = schemas[type]
  rejectUnknownKeys(sourceOptions, Object.keys(schema), 'options')
  const options: Record<string, unknown> = {}
  Object.entries(sourceOptions).forEach(([key, optionValue]) => {
    if (optionValue === undefined) return
    schema[key](optionValue, `options.${key}`)
    options[key] = optionValue
  })
  validateOptionRelationships(type, options)
  return { version: 1, type, options } as LayoutConfig
}

export function createLayout(config: LayoutConfig): Layout {
  const parsed = parseLayoutConfig(config)
  switch (parsed.type) {
    case 'sphere': return sphere(parsed.options)
    case 'box': return box(parsed.options)
    case 'cylinder': return cylinder(parsed.options)
    case 'grid': return grid(parsed.options)
    case 'ring': return ring(parsed.options)
    case 'helix': return helix(parsed.options)
    case 'cone': return cone(parsed.options)
    case 'scatter': return scatter(parsed.options)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: string[], path: string): void {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key))
  if (unknown) fail(path === '$' ? unknown : `${path}.${unknown}`, 'is not supported')
}

function fail(path: string, reason: string): never {
  throw new TypeError(`Invalid LayoutConfig at ${path}: ${reason}`)
}

function validateOptionRelationships(type: LayoutConfigType, options: Record<string, unknown>): void {
  if (type === 'sphere') {
    const minimum = (options.minLatitude as number | undefined) ?? -Math.PI / 2
    const maximum = (options.maxLatitude as number | undefined) ?? Math.PI / 2
    if (minimum >= maximum) {
      fail('options.minLatitude', 'must be less than options.maxLatitude')
    }
    if (options.distribution === 'fibonacci') {
      for (const key of ['rings', 'stagger', 'poleMode']) {
        if (options[key] !== undefined) fail(`options.${key}`, 'is only supported by latitude distribution')
      }
    }
  }

  if (type === 'cylinder' && options.rows !== undefined && options.columns !== undefined) {
    fail('options.rows', 'cannot be combined with options.columns')
  }

  if (type === 'box') {
    const faces = (options.faces as BoxFace[] | undefined) ?? [...boxFaces]
    const weights = options.faceWeights as Partial<Record<BoxFace, number>> | undefined
    if (weights && faces.every((face) => (weights[face] ?? 1) === 0)) {
      fail('options.faceWeights', 'must leave at least one selected face with a positive weight')
    }
  }

  if (type === 'cone') {
    const radius = (options.radius as number | undefined) ?? 5
    const topRadius = options.topRadius as number | undefined
    if (topRadius !== undefined && topRadius > radius) {
      fail('options.topRadius', 'must be less than or equal to options.radius')
    }
  }
}
