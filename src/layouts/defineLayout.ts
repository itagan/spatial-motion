import type {
  Layout,
  LayoutContext,
  LayoutDefinition,
  Transform,
} from '../core/types.js'
import {
  TransformBuffer,
} from '../core/TransformBuffer.js'

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

export function defineLayout<TMeta = unknown>(
  definition: LayoutDefinition<TMeta>,
): Layout<TMeta> {
  if (!definition || typeof definition !== 'object') {
    throw new TypeError('Invalid layout definition')
  }
  const name = definition.name?.trim()
  if (!name) throw new TypeError('Layout name is required')
  if (definition.orientation !== undefined
    && definition.orientation !== 'surface'
    && definition.orientation !== 'camera') {
    throw new TypeError('Invalid layout orientation')
  }
  if (definition.hideBackHemisphere !== undefined
    && typeof definition.hideBackHemisphere !== 'boolean') {
    throw new TypeError('Invalid hideBackHemisphere')
  }
  if (definition.hemisphereEdgeFade !== undefined
    && (!Number.isFinite(definition.hemisphereEdgeFade)
      || definition.hemisphereEdgeFade < 0
      || definition.hemisphereEdgeFade > 0.5)) {
    throw new RangeError('Invalid hemisphereEdgeFade')
  }
  if (
    typeof definition.calculate !== 'function'
    && typeof definition.calculateInto !== 'function'
  ) {
    throw new TypeError('Layout must provide calculate or calculateInto')
  }
  const scratch = new TransformBuffer()

  const layout: Layout<TMeta> = {
    name,
    orientation: definition.orientation,
    hideBackHemisphere: definition.hideBackHemisphere,
    hemisphereEdgeFade: definition.hemisphereEdgeFade,
    calculate(count: number, context: LayoutContext<TMeta>): readonly Transform[] {
      if (!Number.isInteger(count) || count < 0) {
        throw new RangeError('Layout count must be a non-negative integer')
      }
      if (!definition.calculate) {
        scratch.resize(count)
        definition.calculateInto!(count, context, scratch)
        validateBufferCount(scratch, count, name)
        validateTransformBuffer(scratch, name)
        return materializeBuffer(scratch)
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
    calculateInto(
      count: number,
      context: LayoutContext<TMeta>,
      target: TransformBuffer,
    ): void {
      if (!Number.isInteger(count) || count < 0) {
        throw new RangeError('Layout count must be a non-negative integer')
      }
      target.resize(count)
      if (definition.calculateInto) definition.calculateInto(count, context, target)
      else target.copyFrom(definition.calculate!(count, context))
      validateBufferCount(target, count, name)
      validateTransformBuffer(target, name)
    },
  }
  return Object.freeze(layout)
}

function materializeBuffer(buffer: TransformBuffer): Transform[] {
  return Array.from({ length: buffer.count }, (_, index) => {
    const offset = index * 3
    return {
      x: buffer.positions[offset],
      y: buffer.positions[offset + 1],
      z: buffer.positions[offset + 2],
      scale: buffer.scales[index],
      rotationX: buffer.rotations[offset],
      rotationY: buffer.rotations[offset + 1],
      rotationZ: buffer.rotations[offset + 2],
      opacity: buffer.opacities[index],
    }
  })
}

function validateTransformBuffer(buffer: TransformBuffer, layoutName: string): void {
  for (let index = 0; index < buffer.count; index += 1) {
    const offset = index * 3
    for (const value of [
      buffer.positions[offset],
      buffer.positions[offset + 1],
      buffer.positions[offset + 2],
      buffer.scales[index],
      buffer.rotations[offset],
      buffer.rotations[offset + 1],
      buffer.rotations[offset + 2],
      buffer.opacities[index],
    ]) {
      if (!Number.isFinite(value)) {
        throw new RangeError(`Layout "${layoutName}" transform ${index} must be finite`)
      }
    }
  }
}

function validateBufferCount(
  buffer: TransformBuffer,
  count: number,
  layoutName: string,
): void {
  if (buffer.count !== count) {
    throw new RangeError(
      `Layout "${layoutName}" wrote ${buffer.count}/${count} transforms`,
    )
  }
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
