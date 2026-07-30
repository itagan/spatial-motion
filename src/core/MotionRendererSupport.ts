import type {
  MotionRenderer,
  MotionRendererStats,
} from '../renderers/MotionRenderer.js'
import { visibilityRank } from './Visibility.js'

export interface NormalizedRendererStats {
  instanceCount: number
  submittedInstanceCount: number
  gpuBytes: number
  metrics: Readonly<Record<string, number>>
}

export function assertMotionRenderer(value: unknown): asserts value is MotionRenderer {
  if (!value || typeof value !== 'object') {
    throw new TypeError('Motion renderer factory must return a MotionRenderer object')
  }
  const renderer = value as Partial<MotionRenderer>
  const methods: Array<keyof MotionRenderer> = [
    'setItems', 'setTransforms', 'prepareTransition', 'setProgress',
    'setVisibleRatio', 'getStats', 'dispose',
  ]
  const missing = methods.find((method) => typeof renderer[method] !== 'function')
  if (missing) throw new TypeError(`Motion renderer is missing required method: ${missing}`)
  if (!renderer.descriptor || typeof renderer.descriptor !== 'object') {
    throw new TypeError('Motion renderer must declare a descriptor')
  }
  if (!renderer.capabilities || typeof renderer.capabilities !== 'object') {
    throw new TypeError('Motion renderer must declare capabilities')
  }
  validateCapability(renderer.capabilities.patch, 'patch', ['updateItems'])
  validateCapability(renderer.capabilities.visual, 'visual', [
    'setVisualState', 'prepareVisualTransition',
  ])
  validateCapability(renderer.capabilities.highlight, 'highlight', ['setHighlightIndex'])
  validateCapability(renderer.capabilities.viewport, 'viewport', ['resize'])
  validateCapability(renderer.capabilities.resourceRecovery, 'resourceRecovery', ['refreshResources'])
  validateCapability(renderer.capabilities.streamingEffects, 'streamingEffects', [
    'enable', 'disable', 'setTime',
  ])
  validateCapability(renderer.capabilities.frame, 'frame', ['update'])
  const shape = renderer.descriptor.itemBounds
  if (shape === null) return
  if (!shape || (shape.kind !== 'quad' && shape.kind !== 'disc')) {
    throw new TypeError('Motion renderer descriptor must declare valid itemBounds or null')
  }
  if (shape.kind === 'disc') {
    if (shape.facing !== 'camera' || !Number.isFinite(shape.diameter) || shape.diameter <= 0) {
      throw new TypeError('Disc itemBounds must be camera-facing with a positive diameter')
    }
    return
  }
  if (
    (shape.facing !== 'layout' && shape.facing !== 'camera')
    || !Number.isFinite(shape.width)
    || !Number.isFinite(shape.height)
    || shape.width <= 0
    || shape.height <= 0
  ) {
    throw new TypeError('Quad itemBounds must have a valid facing and positive width/height')
  }
}

export function normalizeRendererStats(stats: MotionRendererStats): NormalizedRendererStats {
  const input = stats && typeof stats === 'object'
    ? stats as Partial<MotionRendererStats>
    : {}
  const metricInput = input.metrics && typeof input.metrics === 'object'
    ? input.metrics
    : {}
  const metrics = Object.fromEntries(
    Object.entries(metricInput)
      .slice(0, 64)
      .map(([key, value]) => [key, finiteStat(value)]),
  )
  const instanceCount = finiteStat(input.instanceCount)
  return {
    instanceCount,
    submittedInstanceCount: Math.min(instanceCount, finiteStat(input.submittedInstanceCount)),
    gpuBytes: finiteStat(input.gpuBytes),
    metrics: Object.freeze(metrics),
  }
}

export function countVisibleItems(count: number, ratio: number): number {
  let visible = 0
  for (let index = 0; index < count; index += 1) {
    if (visibilityRank(index) <= ratio) visible += 1
  }
  return visible
}

function validateCapability(
  capability: unknown,
  name: string,
  methods: readonly string[],
): void {
  if (capability === undefined) return
  if (!capability || typeof capability !== 'object') {
    throw new TypeError(`Motion renderer capability ${name} must be an object`)
  }
  const missing = methods.find((method) =>
    typeof (capability as Record<string, unknown>)[method] !== 'function')
  if (missing) {
    throw new TypeError(`Motion renderer capability ${name} is missing method: ${missing}`)
  }
}

function finiteStat(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
}
