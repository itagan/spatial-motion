import type {
  Layout,
  LayoutContext,
  Transform,
} from './types.js'

export interface TransformBufferView {
  readonly positions: Float32Array
  readonly scales: Float32Array
  readonly rotations: Float32Array
  readonly opacities: Float32Array
  readonly count: number
}

export class TransformBuffer implements TransformBufferView {
  positions: Float32Array
  scales: Float32Array
  rotations: Float32Array
  opacities: Float32Array
  count = 0

  constructor(count = 0) {
    const capacity = nextCapacity(count)
    this.positions = new Float32Array(capacity * 3)
    this.scales = new Float32Array(capacity)
    this.rotations = new Float32Array(capacity * 3)
    this.opacities = new Float32Array(capacity)
    this.resize(count)
  }

  resize(count: number): this {
    if ((count >>> 0) !== count) {
      throw new RangeError('Invalid transform count')
    }
    if (count > this.scales.length) this.grow(nextCapacity(count))
    this.count = count
    return this
  }

  setValues(
    index: number,
    x: number,
    y: number,
    z: number,
    scale: number,
    rotationX: number,
    rotationY: number,
    rotationZ: number,
    opacity: number,
  ): this {
    const offset = index * 3
    this.positions[offset] = x
    this.positions[offset + 1] = y
    this.positions[offset + 2] = z
    this.scales[index] = scale
    this.rotations[offset] = rotationX
    this.rotations[offset + 1] = rotationY
    this.rotations[offset + 2] = rotationZ
    this.opacities[index] = opacity
    return this
  }

  copyFrom(transforms: readonly Transform[]): this {
    this.resize(transforms.length)
    transforms.forEach((transform, index) => this.setValues(
      index,
      transform.x,
      transform.y,
      transform.z,
      transform.scale,
      transform.rotationX,
      transform.rotationY,
      transform.rotationZ,
      transform.opacity,
    ))
    return this
  }

  copyFromBuffer(source: TransformBufferView): this {
    this.resize(source.count)
    this.positions.set(source.positions.subarray(0, source.count * 3))
    this.scales.set(source.scales.subarray(0, source.count))
    this.rotations.set(source.rotations.subarray(0, source.count * 3))
    this.opacities.set(source.opacities.subarray(0, source.count))
    return this
  }

  setFromBuffer(index: number, source: TransformBufferView, sourceIndex: number): this {
    const offset = index * 3
    const sourceOffset = sourceIndex * 3
    for (let axis = 0; axis < 3; axis += 1) {
      this.positions[offset + axis] = source.positions[sourceOffset + axis]
      this.rotations[offset + axis] = source.rotations[sourceOffset + axis]
    }
    this.scales[index] = source.scales[sourceIndex]
    this.opacities[index] = source.opacities[sourceIndex]
    return this
  }

  private grow(capacity: number): void {
    this.positions = growArray(this.positions, capacity * 3)
    this.scales = growArray(this.scales, capacity)
    this.rotations = growArray(this.rotations, capacity * 3)
    this.opacities = growArray(this.opacities, capacity)
  }

}

export function calculateLayoutInto<TMeta>(
  layout: Layout<TMeta>,
  count: number,
  context: LayoutContext<TMeta>,
  target: TransformBuffer,
): TransformBuffer {
  target.resize(count)
  if (layout.calculateInto) {
    layout.calculateInto(count, context, target)
  } else {
    target.copyFrom(layout.calculate(count, context))
  }
  return target
}

function nextCapacity(count: number): number {
  return count > 0 ? 2 ** Math.ceil(Math.log2(count)) : 0
}

function growArray(array: Float32Array, length: number): Float32Array {
  const next = new Float32Array(length)
  next.set(array.subarray(0, Math.min(array.length, length)))
  return next
}
