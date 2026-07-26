import {
  BufferGeometry,
  Euler,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Points,
  PointsMaterial,
  Vector3,
  type Material,
  type Object3D,
  type Texture,
} from 'three'
import { identityTransform } from '../core/math.js'
import type {
  Layout,
  LayoutContext,
  MotionItem,
  Transform,
} from '../core/types.js'
import {
  type MotionRendererFactory,
  type MotionRendererPickShape,
  type MotionRendererStats,
} from '../renderers/MotionRenderer.js'

export type DevelopmentDiagnosticSeverity = 'error' | 'warning'

export interface DevelopmentDiagnostic {
  readonly severity: DevelopmentDiagnosticSeverity
  readonly code: string
  readonly message: string
  readonly itemIndex?: number
}

export interface DevelopmentValidationReport<TSamples extends object = Record<string, number>> {
  readonly valid: boolean
  readonly errors: readonly DevelopmentDiagnostic[]
  readonly warnings: readonly DevelopmentDiagnostic[]
  readonly samples: Readonly<TSamples>
}

export interface LayoutValidationOptions {
  readonly counts?: readonly number[]
  readonly contexts?: readonly LayoutContext[]
  readonly itemBounds?: MotionRendererPickShape | null
  readonly overlapTolerance?: number
}

export interface LayoutValidationSamples {
  readonly calculations: number
  readonly transforms: number
  readonly duplicatePositions: number
  readonly overlapPairs: number
  readonly minimumScale: number
  readonly maximumScale: number
}

export interface MotionRendererValidationOptions<TMeta = unknown> {
  readonly items?: readonly MotionItem<TMeta>[]
  readonly transforms?: readonly Transform[]
  readonly cycles?: number
  readonly maxTextureSize?: number
  readonly maxTextureLayers?: number
  readonly maxAnisotropy?: number
}

export interface MotionRendererValidationSamples {
  readonly cycles: number
  readonly peakObjects: number
  readonly peakGeometries: number
  readonly peakMaterials: number
  readonly peakTextures: number
  readonly finalInstanceCount: number
  readonly finalSubmittedInstanceCount: number
  readonly finalGpuBytes: number
}

export interface LayoutDebugVisualizationOptions {
  readonly count: number
  readonly context: LayoutContext
  readonly itemBounds?: MotionRendererPickShape | null
  readonly axisLength?: number
}

export interface LayoutDebugVisualization {
  readonly group: Group
  readonly report: DevelopmentValidationReport<LayoutValidationSamples>
  dispose(): void
}

const defaultContexts: readonly LayoutContext[] = [
  {
    width: 1280,
    height: 720,
    viewportWidth: 16,
    viewportHeight: 9,
    itemWidth: 1,
    itemHeight: 1,
  },
  {
    width: 390,
    height: 844,
    viewportWidth: 4.16,
    viewportHeight: 9,
    itemWidth: 1,
    itemHeight: 1,
  },
]

export function validateLayout(
  layout: Layout,
  options: LayoutValidationOptions = {},
): DevelopmentValidationReport<LayoutValidationSamples> {
  const errors: DevelopmentDiagnostic[] = []
  const warnings: DevelopmentDiagnostic[] = []
  const counts = options.counts ?? [0, 1, 100, 500, 2000]
  const contexts = options.contexts ?? defaultContexts
  const overlapTolerance = finiteNonNegative(options.overlapTolerance, 0.02)
  let calculations = 0
  let transformCount = 0
  let duplicatePositions = 0
  let overlapPairs = 0
  let minimumScale = Number.POSITIVE_INFINITY
  let maximumScale = 0

  counts.forEach((count) => {
    contexts.forEach((context) => {
      calculations += 1
      let transforms: readonly Transform[]
      try {
        transforms = layout.calculate(count, context)
      } catch (error) {
        addDiagnostic(errors, {
          severity: 'error',
          code: 'LAYOUT_CALCULATION_FAILED',
          message: `Layout "${layout.name}" failed for count ${count}: ${errorText(error)}`,
        })
        return
      }
      if (transforms.length !== count) {
        addDiagnostic(errors, {
          severity: 'error',
          code: 'LAYOUT_COUNT_MISMATCH',
          message: `Layout "${layout.name}" returned ${transforms.length} transforms for ${count} items`,
        })
      }
      transformCount += transforms.length
      const positions = new Map<string, number>()
      transforms.forEach((transform, index) => {
        if (!isFiniteTransform(transform)) {
          addDiagnostic(errors, {
            severity: 'error',
            code: 'NON_FINITE_TRANSFORM',
            message: `Transform ${index} contains a non-finite value`,
            itemIndex: index,
          })
          return
        }
        minimumScale = Math.min(minimumScale, transform.scale)
        maximumScale = Math.max(maximumScale, transform.scale)
        if (transform.scale < 0) {
          addDiagnostic(warnings, {
            severity: 'warning',
            code: 'NEGATIVE_SCALE',
            message: `Transform ${index} uses a negative scale`,
            itemIndex: index,
          })
        }
        const key = `${roundPosition(transform.x)}:${roundPosition(transform.y)}:${roundPosition(transform.z)}`
        const previous = positions.get(key)
        if (previous !== undefined) {
          duplicatePositions += 1
          addDiagnostic(warnings, {
            severity: 'warning',
            code: 'DUPLICATE_POSITION',
            message: `Transforms ${previous} and ${index} share the same position`,
            itemIndex: index,
          })
        } else {
          positions.set(key, index)
        }
      })
      overlapPairs += detectOverlaps(
        transforms,
        options.itemBounds,
        overlapTolerance,
        warnings,
      )
    })
  })

  return freezeReport(errors, warnings, {
    calculations,
    transforms: transformCount,
    duplicatePositions,
    overlapPairs,
    minimumScale: Number.isFinite(minimumScale) ? minimumScale : 0,
    maximumScale,
  })
}

export async function validateMotionRenderer<TMeta = unknown>(
  factory: MotionRendererFactory<TMeta>,
  options: MotionRendererValidationOptions<TMeta> = {},
): Promise<DevelopmentValidationReport<MotionRendererValidationSamples>> {
  const errors: DevelopmentDiagnostic[] = []
  const warnings: DevelopmentDiagnostic[] = []
  const root = new Group()
  const controller = new AbortController()
  const items = options.items ?? createDiagnosticItems<TMeta>(8)
  const transforms = fitTransforms(options.transforms ?? [], items.length)
  const cycles = clampInteger(options.cycles, 1, 20, 3)
  const peaks = { objects: 0, geometries: 0, materials: 0, textures: 0 }
  let renderer: ReturnType<MotionRendererFactory<TMeta>> | null = null
  let finalStats: MotionRendererStats = { instanceCount: 0, submittedInstanceCount: 0 }
  let baselineResources: ReturnType<typeof inspectResources> | null = null

  try {
    renderer = factory({
      root,
      maxTextureSize: clampInteger(options.maxTextureSize, 32, 32768, 4096),
      maxTextureLayers: clampInteger(options.maxTextureLayers, 1, 2048, 256),
      maxAnisotropy: finiteNonNegative(options.maxAnisotropy, 1),
      signal: controller.signal,
      prepareTexture: () => 0,
    })
    assertDiagnosticRenderer(renderer)
    for (let cycle = 0; cycle < cycles; cycle += 1) {
      const cycleItems = cycle % 2 === 1
        ? [...items, { id: '__diagnostic_capacity_item__' } as MotionItem<TMeta>]
        : items
      const cycleTransforms = fitTransforms(transforms, cycleItems.length)
      const applied = await renderer.setItems(cycleItems)
      if (!applied) {
        addDiagnostic(errors, {
          severity: 'error',
          code: 'SET_ITEMS_REJECTED',
          message: `Renderer rejected diagnostic item cycle ${cycle + 1}`,
        })
        break
      }
      renderer.setTransforms(cycleTransforms)
      renderer.prepareTransition(cycleTransforms, cycleTransforms)
      renderer.setProgress(0.5)
      renderer.setVisibleRatio(0.75)
      renderer.capabilities.visual?.prepareVisualTransition(
        { billboard: 0, hideBackHemisphere: 0, hemisphereEdgeFade: 0 },
        { billboard: 1, hideBackHemisphere: 1, hemisphereEdgeFade: 0.08 },
      )
      renderer.capabilities.visual?.setVisualState(
        { billboard: 0, hideBackHemisphere: 0, hemisphereEdgeFade: 0 },
      )
      renderer.capabilities.highlight?.setHighlightIndex(cycleItems.length ? 0 : null)
      renderer.capabilities.viewport?.resize({ width: 1280, height: 720, pixelRatio: 1 })
      renderer.capabilities.resourceRecovery?.refreshResources()
      if (renderer.capabilities.patch && cycleItems.length) {
        const patched = cycleItems.map((item, index) =>
          index === 0 ? { ...item, title: `diagnostic-${cycle}` } : item)
        await renderer.capabilities.patch.updateItems(patched, [0])
      }
      const resources = inspectResources(root)
      peaks.objects = Math.max(peaks.objects, resources.objects)
      peaks.geometries = Math.max(peaks.geometries, resources.geometries)
      peaks.materials = Math.max(peaks.materials, resources.materials)
      peaks.textures = Math.max(peaks.textures, resources.textures)
      if (!baselineResources) baselineResources = resources
      else if (
        resources.objects > baselineResources.objects
        || resources.geometries > baselineResources.geometries
        || resources.materials > baselineResources.materials
        || resources.textures > baselineResources.textures
      ) {
        addDiagnostic(warnings, {
          severity: 'warning',
          code: 'RESOURCE_COUNT_GROWTH',
          message: `Live renderer resources grew during cycle ${cycle + 1}`,
        })
      }
      finalStats = renderer.getStats()
      validateStats(finalStats, errors)
    }
    if (renderer.getStats().instanceCount !== items.length) {
      await renderer.setItems(items)
      renderer.setTransforms(transforms)
      finalStats = renderer.getStats()
    }
  } catch (error) {
    addDiagnostic(errors, {
      severity: 'error',
      code: 'RENDERER_VALIDATION_FAILED',
      message: errorText(error),
    })
  } finally {
    try {
      renderer?.dispose()
      renderer?.dispose()
    } catch (error) {
      addDiagnostic(errors, {
        severity: 'error',
        code: 'DISPOSE_FAILED',
        message: errorText(error),
      })
    }
    controller.abort()
  }

  if (root.children.length) {
    addDiagnostic(errors, {
      severity: 'error',
      code: 'OBJECTS_REMAIN_AFTER_DISPOSE',
      message: `${root.children.length} root object(s) remain after renderer disposal`,
    })
    disposeObjectResources(root)
    root.clear()
  }
  if (!renderer?.descriptor.itemBounds) {
    addDiagnostic(warnings, {
      severity: 'warning',
      code: 'POINTER_PICKING_DISABLED',
      message: 'Renderer declares no item bounds, so pointer picking is disabled',
    })
  }

  return freezeReport(errors, warnings, {
    cycles,
    peakObjects: peaks.objects,
    peakGeometries: peaks.geometries,
    peakMaterials: peaks.materials,
    peakTextures: peaks.textures,
    finalInstanceCount: finiteNonNegative(finalStats.instanceCount, 0),
    finalSubmittedInstanceCount: finiteNonNegative(finalStats.submittedInstanceCount, 0),
    finalGpuBytes: finiteNonNegative(finalStats.gpuBytes, 0),
  })
}

export function createLayoutDebugVisualization(
  layout: Layout,
  options: LayoutDebugVisualizationOptions,
): LayoutDebugVisualization {
  const report = validateLayout(layout, {
    counts: [options.count],
    contexts: [options.context],
    itemBounds: options.itemBounds,
  })
  const transforms = layout.calculate(options.count, options.context)
  const group = new Group()
  group.name = `SpatialMotionLayoutDebug:${layout.name}`
  const linePositions: number[] = []
  const lineColors: number[] = []
  const markerPositions: number[] = []
  const markerColors: number[] = []
  const axisLength = finitePositive(options.axisLength, 0.35)
  transforms.forEach((transform) => {
    appendBounds(linePositions, lineColors, transform, options.itemBounds)
    appendAxis(linePositions, lineColors, transform, [0, 0, 1], axisLength, [0.2, 0.55, 1])
    appendAxis(linePositions, lineColors, transform, [0, 1, 0], axisLength, [0.2, 1, 0.45])
  })
  ;[...report.errors, ...report.warnings].forEach((diagnostic) => {
    if (diagnostic.itemIndex === undefined) return
    const transform = transforms[diagnostic.itemIndex]
    if (!transform) return
    markerPositions.push(transform.x, transform.y, transform.z)
    markerColors.push(...(diagnostic.severity === 'error' ? [1, 0.2, 0.2] : [1, 0.72, 0.1]))
  })

  const lineGeometry = new BufferGeometry()
  lineGeometry.setAttribute('position', new Float32BufferAttribute(linePositions, 3))
  lineGeometry.setAttribute('color', new Float32BufferAttribute(lineColors, 3))
  const lineMaterial = new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8 })
  group.add(new LineSegments(lineGeometry, lineMaterial))
  if (markerPositions.length) {
    const markerGeometry = new BufferGeometry()
    markerGeometry.setAttribute('position', new Float32BufferAttribute(markerPositions, 3))
    markerGeometry.setAttribute('color', new Float32BufferAttribute(markerColors, 3))
    group.add(new Points(markerGeometry, new PointsMaterial({
      size: 0.16,
      vertexColors: true,
      depthTest: false,
    })))
  }

  let disposed = false
  return {
    group,
    report,
    dispose() {
      if (disposed) return
      disposed = true
      disposeObjectResources(group)
      group.removeFromParent()
      group.clear()
    },
  }
}

function detectOverlaps(
  transforms: readonly Transform[],
  itemBounds: MotionRendererPickShape | null | undefined,
  tolerance: number,
  warnings: DevelopmentDiagnostic[],
): number {
  const diameter = itemBounds?.kind === 'disc'
    ? itemBounds.diameter
    : itemBounds?.kind === 'quad'
      ? Math.hypot(itemBounds.width, itemBounds.height)
      : Math.SQRT2
  let overlaps = 0
  for (let left = 0; left < transforms.length; left += 1) {
    const first = transforms[left]
    if (!isFiniteTransform(first) || first.scale <= 0) continue
    for (let right = left + 1; right < transforms.length; right += 1) {
      const second = transforms[right]
      if (!isFiniteTransform(second) || second.scale <= 0) continue
      const minimumDistance = diameter * Math.min(first.scale, second.scale) * (0.5 - tolerance)
      if (minimumDistance <= 0) continue
      const distance = Math.hypot(
        first.x - second.x,
        first.y - second.y,
        first.z - second.z,
      )
      if (distance >= minimumDistance) continue
      overlaps += 1
      addDiagnostic(warnings, {
        severity: 'warning',
        code: 'POSSIBLE_OVERLAP',
        message: `Transforms ${left} and ${right} may overlap`,
        itemIndex: right,
      })
    }
  }
  return overlaps
}

function appendBounds(
  positions: number[],
  colors: number[],
  transform: Transform,
  itemBounds: MotionRendererPickShape | null | undefined,
): void {
  const width = itemBounds?.kind === 'quad' ? itemBounds.width : itemBounds?.diameter ?? 1
  const height = itemBounds?.kind === 'quad' ? itemBounds.height : itemBounds?.diameter ?? 1
  const segments = itemBounds?.kind === 'disc' ? 16 : 4
  const points = Array.from({ length: segments }, (_value, index) => {
    const angle = index / segments * Math.PI * 2
    return itemBounds?.kind === 'disc'
      ? new Vector3(Math.cos(angle) * width / 2, Math.sin(angle) * height / 2, 0)
      : new Vector3(
          index === 0 || index === 3 ? -width / 2 : width / 2,
          index < 2 ? -height / 2 : height / 2,
          0,
        )
  })
  const euler = new Euler(transform.rotationX, transform.rotationY, transform.rotationZ, 'XYZ')
  points.forEach((point) => point.multiplyScalar(transform.scale).applyEuler(euler)
    .add(new Vector3(transform.x, transform.y, transform.z)))
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length]
    positions.push(point.x, point.y, point.z, next.x, next.y, next.z)
    colors.push(0.65, 0.72, 0.82, 0.65, 0.72, 0.82)
  })
}

function appendAxis(
  positions: number[],
  colors: number[],
  transform: Transform,
  axis: [number, number, number],
  length: number,
  color: [number, number, number],
): void {
  const start = new Vector3(transform.x, transform.y, transform.z)
  const end = new Vector3(...axis)
    .applyEuler(new Euler(transform.rotationX, transform.rotationY, transform.rotationZ, 'XYZ'))
    .multiplyScalar(length * Math.max(0, transform.scale))
    .add(start)
  positions.push(start.x, start.y, start.z, end.x, end.y, end.z)
  colors.push(...color, ...color)
}

function fitTransforms(transforms: readonly Transform[], count: number): Transform[] {
  return Array.from({ length: count }, (_value, index) =>
    transforms[index] ? { ...transforms[index] } : identityTransform())
}

function createDiagnosticItems<TMeta>(count: number): MotionItem<TMeta>[] {
  return Array.from({ length: count }, (_value, index) => ({ id: `diagnostic-${index}` }))
}

function inspectResources(root: Object3D): {
  objects: number
  geometries: number
  materials: number
  textures: number
} {
  let objects = 0
  const geometries = new Set<object>()
  const materials = new Set<Material>()
  const textures = new Set<Texture>()
  root.traverse((object) => {
    objects += 1
    const renderable = object as Object3D & {
      geometry?: object
      material?: Material | Material[]
    }
    if (renderable.geometry) geometries.add(renderable.geometry)
    const objectMaterials = Array.isArray(renderable.material)
      ? renderable.material
      : renderable.material
        ? [renderable.material]
        : []
    objectMaterials.forEach((material) => {
      materials.add(material)
      Object.values(material).forEach((value) => {
        if (value && typeof value === 'object' && (value as Texture).isTexture) {
          textures.add(value as Texture)
        }
      })
    })
  })
  return { objects, geometries: geometries.size, materials: materials.size, textures: textures.size }
}

function disposeObjectResources(root: Object3D): void {
  root.traverse((object) => {
    const renderable = object as Object3D & {
      geometry?: { dispose(): void }
      material?: Material | Material[]
    }
    renderable.geometry?.dispose()
    const materials = Array.isArray(renderable.material)
      ? renderable.material
      : renderable.material
        ? [renderable.material]
        : []
    materials.forEach((material) => {
      Object.values(material).forEach((value) => {
        if (value && typeof value === 'object' && (value as Texture).isTexture) {
          ;(value as Texture).dispose()
        }
      })
      material.dispose()
    })
  })
}

function validateStats(stats: MotionRendererStats, errors: DevelopmentDiagnostic[]): void {
  ;[
    ['instanceCount', stats.instanceCount],
    ['submittedInstanceCount', stats.submittedInstanceCount],
    ['gpuBytes', stats.gpuBytes ?? 0],
  ].forEach(([name, value]) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      addDiagnostic(errors, {
        severity: 'error',
        code: 'INVALID_RENDERER_STATS',
        message: `Renderer stat ${name} must be finite and non-negative`,
      })
    }
  })
  Object.entries(stats.metrics ?? {}).forEach(([name, value]) => {
    if (!Number.isFinite(value) || value < 0) {
      addDiagnostic(errors, {
        severity: 'error',
        code: 'INVALID_RENDERER_METRIC',
        message: `Renderer metric ${name} must be finite and non-negative`,
      })
    }
  })
}

function assertDiagnosticRenderer(value: unknown): asserts value is ReturnType<MotionRendererFactory> {
  if (!value || typeof value !== 'object') throw new TypeError('Renderer factory returned no object')
  const renderer = value as Record<string, unknown>
  for (const method of [
    'setItems', 'setTransforms', 'prepareTransition', 'setProgress',
    'setVisibleRatio', 'getStats', 'dispose',
  ]) {
    if (typeof renderer[method] !== 'function') {
      throw new TypeError(`Motion renderer is missing required method: ${method}`)
    }
  }
  if (!renderer.descriptor || !renderer.capabilities) {
    throw new TypeError('Motion renderer must declare descriptor and capabilities')
  }
  const bounds = (renderer.descriptor as { itemBounds?: MotionRendererPickShape | null }).itemBounds
  if (bounds !== null) {
    if (!bounds || (bounds.kind !== 'quad' && bounds.kind !== 'disc')) {
      throw new TypeError('Motion renderer descriptor has invalid item bounds')
    }
    const dimensions = bounds.kind === 'disc' ? [bounds.diameter] : [bounds.width, bounds.height]
    if (dimensions.some((dimension) => !Number.isFinite(dimension) || dimension <= 0)) {
      throw new TypeError('Motion renderer item bounds must be positive and finite')
    }
  }
  const capabilities = renderer.capabilities as Record<string, unknown>
  const required = {
    patch: ['updateItems'],
    visual: ['setVisualState', 'prepareVisualTransition'],
    highlight: ['setHighlightIndex'],
    viewport: ['resize'],
    resourceRecovery: ['refreshResources'],
    streamingEffects: ['enable', 'disable', 'setTime'],
    frame: ['update'],
  } as const
  Object.entries(required).forEach(([name, methods]) => {
    const capability = capabilities[name]
    if (capability === undefined) return
    if (!capability || typeof capability !== 'object'
      || methods.some((method) =>
        typeof (capability as Record<string, unknown>)[method] !== 'function')) {
      throw new TypeError(`Motion renderer capability ${name} is incomplete`)
    }
  })
}

function isFiniteTransform(transform: Transform): boolean {
  return Object.values(transform).every((value) =>
    typeof value === 'number' && Number.isFinite(value))
}

function freezeReport<TSamples extends object>(
  errors: DevelopmentDiagnostic[],
  warnings: DevelopmentDiagnostic[],
  samples: TSamples,
): DevelopmentValidationReport<TSamples> {
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    warnings: Object.freeze(warnings),
    samples: Object.freeze(samples),
  })
}

function addDiagnostic(
  target: DevelopmentDiagnostic[],
  diagnostic: DevelopmentDiagnostic,
): void {
  if (target.length < 100) target.push(Object.freeze(diagnostic))
}

function roundPosition(value: number): string {
  return Number.isFinite(value) ? value.toFixed(7) : String(value)
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function clampInteger(
  value: number | undefined,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  return Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, Math.floor(value as number)))
    : fallback
}

function finiteNonNegative(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, value as number) : fallback
}

function finitePositive(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && (value as number) > 0 ? value as number : fallback
}
