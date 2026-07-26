import type {
  Layout,
  LayoutContext,
  LayoutDefinition,
  Transform,
} from '../core/types.js'

const transformKeys = [
  'x',
  'y',
  'z',
  'scale',
  'rotationX',
  'rotationY',
  'rotationZ',
  'opacity',
] as const satisfies readonly (keyof Transform)[]

export function defineLayout(definition: LayoutDefinition): Layout {
  if (!definition || typeof definition !== 'object') {
    throw new TypeError('Layout definition must be an object')
  }
  const name = definition.name?.trim()
  if (!name) throw new TypeError('Layout name must be a non-empty string')
  if (definition.orientation !== undefined
    && definition.orientation !== 'surface'
    && definition.orientation !== 'camera') {
    throw new TypeError('Layout orientation must be "surface" or "camera"')
  }
  if (definition.hideBackHemisphere !== undefined
    && typeof definition.hideBackHemisphere !== 'boolean') {
    throw new TypeError('Layout hideBackHemisphere must be a boolean')
  }
  if (definition.hemisphereEdgeFade !== undefined
    && (!Number.isFinite(definition.hemisphereEdgeFade)
      || definition.hemisphereEdgeFade < 0
      || definition.hemisphereEdgeFade > 0.5)) {
    throw new RangeError('Layout hemisphereEdgeFade must be between 0 and 0.5')
  }
  if (typeof definition.calculate !== 'function') {
    throw new TypeError('Layout calculate must be a function')
  }

  const layout: Layout = {
    name,
    orientation: definition.orientation,
    hideBackHemisphere: definition.hideBackHemisphere,
    hemisphereEdgeFade: definition.hemisphereEdgeFade,
    calculate(count: number, context: LayoutContext): readonly Transform[] {
      if (!Number.isInteger(count) || count < 0) {
        throw new RangeError('Layout count must be a non-negative integer')
      }
      const transforms = definition.calculate(count, context)
      if (!Array.isArray(transforms)) {
        throw new TypeError(`Layout "${name}" must return an array`)
      }
      if (transforms.length !== count) {
        throw new RangeError(
          `Layout "${name}" returned ${transforms.length} transforms for ${count} items`,
        )
      }
      transforms.forEach((transform, index) => validateTransform(transform, index, name))
      return transforms
    },
  }
  return Object.freeze(layout)
}

function validateTransform(transform: Transform, index: number, layoutName: string): void {
  if (!transform || typeof transform !== 'object') {
    throw new TypeError(`Layout "${layoutName}" transform ${index} must be an object`)
  }
  for (const key of transformKeys) {
    if (!Number.isFinite(transform[key])) {
      throw new RangeError(
        `Layout "${layoutName}" transform ${index}.${key} must be finite`,
      )
    }
  }
}
