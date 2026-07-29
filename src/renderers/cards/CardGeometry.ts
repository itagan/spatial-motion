import {
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  PlaneGeometry,
} from 'three'

export function createCardGeometry(
  capacity: number,
  itemCount: number,
  aspectRatio: number,
  atlasRects: Float32Array,
): InstancedBufferGeometry {
  const plane = new PlaneGeometry(
    aspectRatio >= 1 ? 1 : aspectRatio,
    aspectRatio >= 1 ? 1 / aspectRatio : 1,
  )
  const geometry = new InstancedBufferGeometry()
  geometry.index = plane.index
  geometry.setAttribute('position', plane.getAttribute('position'))
  geometry.setAttribute('uv', plane.getAttribute('uv'))
  geometry.instanceCount = itemCount
  geometry.setAttribute('atlasRect', dynamicAttribute(new Float32Array(capacity * 4), 4))
  geometry.setAttribute(
    'visibilityRank',
    new InstancedBufferAttribute(createVisibilityRanks(capacity), 1),
  )
  geometry.setAttribute('itemIndex', new InstancedBufferAttribute(createItemIndices(capacity), 1))
  geometry.setAttribute('fromPosition', dynamicAttribute(new Float32Array(capacity * 3), 3))
  geometry.setAttribute('toPosition', dynamicAttribute(new Float32Array(capacity * 3), 3))
  geometry.setAttribute('fromQuaternion', dynamicAttribute(new Float32Array(capacity * 4), 4))
  geometry.setAttribute('toQuaternion', dynamicAttribute(new Float32Array(capacity * 4), 4))
  geometry.setAttribute('fromScale', dynamicAttribute(new Float32Array(capacity), 1))
  geometry.setAttribute('toScale', dynamicAttribute(new Float32Array(capacity), 1))
  geometry.setAttribute('fromOpacity', dynamicAttribute(new Float32Array(capacity), 1))
  geometry.setAttribute('toOpacity', dynamicAttribute(new Float32Array(capacity), 1))
  copyAttribute(
    geometry.getAttribute('atlasRect') as InstancedBufferAttribute,
    atlasRects,
  )
  return geometry
}

export function geometryByteLength(geometry: InstancedBufferGeometry | undefined): number {
  if (!geometry) return 0
  const attributes = Object.values(geometry.attributes)
    .reduce((total, attribute) => total + attribute.array.byteLength, 0)
  return attributes + (geometry.index?.array.byteLength ?? 0)
}

export function resolveBufferCapacity(current: number, required: number): number {
  if (required <= 0) return 0
  if (required <= current && required >= current / 2) return current
  return 2 ** Math.ceil(Math.log2(required))
}

export function dynamicAttribute(
  array: Float32Array,
  itemSize: number,
): InstancedBufferAttribute {
  return new InstancedBufferAttribute(array, itemSize).setUsage(DynamicDrawUsage)
}

export function copyAttribute(
  attribute: InstancedBufferAttribute,
  values: Float32Array,
): void {
  const target = attribute.array as Float32Array
  target.fill(0)
  target.set(values.subarray(0, target.length))
  markAttribute(attribute, Math.min(target.length, values.length))
}

export function markAttribute(attribute: InstancedBufferAttribute, count: number): void {
  attribute.clearUpdateRanges()
  if (count > 0) attribute.addUpdateRange(0, count)
  attribute.needsUpdate = true
}

function createVisibilityRanks(count: number): Float32Array {
  const ranks = new Float32Array(count)
  for (let index = 0; index < count; index += 1) {
    ranks[index] = (index * 0.618033988749895) % 1
  }
  return ranks
}

function createItemIndices(count: number): Float32Array {
  return Float32Array.from({ length: count }, (_, index) => index)
}
