import type {
  Layout,
  LayoutContext,
  Transform,
} from './types.js'

export class TransformBuffer {
  positions: Float32Array
  scales: Float32Array
  rotations: Float32Array
  opacities: Float32Array
  count = 0
  capacity: number

  constructor(count = 0) {
    this.capacity = nextCapacity(count)
    this.positions = new Float32Array(this.capacity * 3)
    this.scales = new Float32Array(this.capacity)
    this.rotations = new Float32Array(this.capacity * 3)
    this.opacities = new Float32Array(this.capacity)
    this.resize(count)
  }

  resize(count: number): this {
    if (!Number.isInteger(count) || count < 0) {
      throw new RangeError('Transform count must be a non-negative integer')
    }
    if (count > this.capacity) this.grow(nextCapacity(count))
    this.count = count
    return this
  }

  set(index: number, transform: Transform): this {
    return this.setValues(
      index,
      transform.x,
      transform.y,
      transform.z,
      transform.scale,
      transform.rotationX,
      transform.rotationY,
      transform.rotationZ,
      transform.opacity,
    )
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
    this.assertIndex(index)
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

  get(index: number, target: WritableTransform = createWritableTransform()): Transform {
    this.assertIndex(index)
    const offset = index * 3
    target.x = this.positions[offset]
    target.y = this.positions[offset + 1]
    target.z = this.positions[offset + 2]
    target.scale = this.scales[index]
    target.rotationX = this.rotations[offset]
    target.rotationY = this.rotations[offset + 1]
    target.rotationZ = this.rotations[offset + 2]
    target.opacity = this.opacities[index]
    return target
  }

  copyFrom(transforms: readonly Transform[]): this {
    this.resize(transforms.length)
    transforms.forEach((transform, index) => this.set(index, transform))
    return this
  }

  toTransforms(target: WritableTransform[] = []): Transform[] {
    target.length = this.count
    for (let index = 0; index < this.count; index += 1) {
      target[index] = this.get(index, target[index])
    }
    return target
  }

  byteLength(): number {
    return this.positions.byteLength
      + this.scales.byteLength
      + this.rotations.byteLength
      + this.opacities.byteLength
  }

  private grow(capacity: number): void {
    this.positions = growArray(this.positions, capacity * 3)
    this.scales = growArray(this.scales, capacity)
    this.rotations = growArray(this.rotations, capacity * 3)
    this.opacities = growArray(this.opacities, capacity)
    this.capacity = capacity
  }

  private assertIndex(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.count) {
      throw new RangeError(`Transform index ${index} is outside count ${this.count}`)
    }
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
  if (target.count !== count) {
    throw new RangeError(
      `Layout "${layout.name}" wrote ${target.count}/${count} transforms`,
    )
  }
  validateTransformBuffer(target, layout.name)
  return target
}

export function validateTransformBuffer(buffer: TransformBuffer, layoutName: string): void {
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

type WritableTransform = { -readonly [TKey in keyof Transform]: Transform[TKey] }

function createWritableTransform(): WritableTransform {
  return {
    x: 0,
    y: 0,
    z: 0,
    scale: 1,
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,
    opacity: 1,
  }
}

function nextCapacity(count: number): number {
  if (count <= 0) return 0
  return 2 ** Math.ceil(Math.log2(count))
}

function growArray(array: Float32Array, length: number): Float32Array {
  const next = new Float32Array(length)
  next.set(array.subarray(0, Math.min(array.length, length)))
  return next
}
