import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Points,
  ShaderMaterial,
  type Group,
} from 'three'
import type { MotionItem } from '../../core/types.js'
import {
  TransformBuffer,
  type TransformBufferView,
} from '../../core/TransformBuffer.js'
import type {
  MotionRenderer,
  MotionRendererCapabilities,
  MotionRendererDescriptor,
  MotionRendererFactory,
  MotionRendererStats,
  MotionRendererViewport,
  MotionRendererVisualState,
} from '../MotionRenderer.js'

export type PointColor = string | number

export interface PointsRendererOptions<TMeta = unknown> {
  /** Point diameter in normalized layout units. Defaults to 1. */
  size?: number
  /** Shared fallback color. Omit for a stable color derived from each item id. */
  color?: PointColor
  /** Pure per-item color resolver. Errors fall back to color or the stable id color. */
  resolveColor?: (item: Readonly<MotionItem<TMeta>>, index: number) => PointColor
}

const vertexShader = `
  attribute vec3 fromPosition;
  attribute vec3 toPosition;
  attribute float fromScale;
  attribute float toScale;
  attribute float fromOpacity;
  attribute float toOpacity;
  attribute vec3 itemColor;
  attribute float visibilityRank;
  attribute float itemIndex;
  uniform float progress;
  uniform float visibleRatio;
  uniform float hoverIndex;
  uniform float viewportHeight;
  uniform float pointSize;
  uniform float fromHideBackHemisphere;
  uniform float toHideBackHemisphere;
  uniform float fromHemisphereEdgeFade;
  uniform float toHemisphereEdgeFade;
  varying vec3 vColor;
  varying float vOpacity;

  void main() {
    if (visibilityRank > visibleRatio) {
      vOpacity = 0.0;
      gl_PointSize = 0.0;
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    float highlighted = 1.0 - step(0.5, abs(itemIndex - hoverIndex));
    float itemScale = mix(fromScale, toScale, progress) * mix(1.0, 1.18, highlighted);
    vec3 center = mix(fromPosition, toPosition, progress);
    vec4 centerView = modelViewMatrix * vec4(center, 1.0);
    vec4 sphereCenterView = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    float hemisphereVisible = step(sphereCenterView.z, centerView.z);
    float hideBackAmount = mix(fromHideBackHemisphere, toHideBackHemisphere, progress);
    vOpacity = mix(fromOpacity, toOpacity, progress)
      * mix(1.0, hemisphereVisible, hideBackAmount);
    float edgeFade = mix(fromHemisphereEdgeFade, toHemisphereEdgeFade, progress);
    if (edgeFade > 0.0) {
      vec3 radialView = normalize(centerView.xyz - sphereCenterView.xyz);
      float facing = dot(radialView, normalize(-centerView.xyz));
      vOpacity *= smoothstep(0.0, edgeFade, facing);
    }
    gl_Position = projectionMatrix * centerView;
    gl_PointSize = max(
      1.0,
      pointSize * itemScale * viewportHeight * projectionMatrix[1][1]
        / max(0.001, -centerView.z) * 0.5
    );
    vColor = mix(itemColor, min(vec3(1.0), itemColor * 1.22 + 0.08), highlighted);
  }
`

const fragmentShader = `
  varying vec3 vColor;
  varying float vOpacity;

  void main() {
    vec2 centered = gl_PointCoord * 2.0 - 1.0;
    float radius = dot(centered, centered);
    if (radius > 1.0 || vOpacity < 0.01) discard;
    float edge = 1.0 - smoothstep(0.82, 1.0, radius);
    gl_FragColor = vec4(vColor, vOpacity * edge);
  }
`

export function pointsRenderer<TMeta = unknown>(
  options: PointsRendererOptions<TMeta> = {},
): MotionRendererFactory<TMeta> {
  const normalized = {
    ...options,
    size: normalizeSize(options.size),
  }
  return ({ root, signal }) => new PointsMotionRenderer<TMeta>(root, normalized, signal)
}

class PointsMotionRenderer<TMeta = unknown> implements MotionRenderer<TMeta> {
  readonly capabilities: MotionRendererCapabilities<TMeta>
  readonly descriptor: MotionRendererDescriptor

  private geometry = new BufferGeometry()
  private readonly material: ShaderMaterial
  private readonly points: Points<BufferGeometry, ShaderMaterial>
  private items: MotionItem<TMeta>[] = []
  private readonly transforms = new TransformBuffer()
  private disposed = false
  private capacity = 0
  private geometryBuilds = 0
  private attributeReuses = 0

  constructor(
    private readonly root: Group,
    private readonly options: PointsRendererOptions<TMeta> & { size: number },
    private readonly signal: AbortSignal,
  ) {
    this.descriptor = {
      itemBounds: {
        kind: 'disc',
        diameter: options.size,
        facing: 'camera',
      },
    }
    this.capabilities = {
      patch: { updateItems: (items, changedIndices) => this.updateItems(items, changedIndices) },
      visual: {
        setVisualState: (state) => this.setVisualState(state),
        prepareVisualTransition: (from, to) => this.prepareVisualTransition(from, to),
      },
      highlight: { setHighlightIndex: (index) => this.setHoverIndex(index) },
      viewport: { resize: (viewport) => this.resize(viewport) },
      resourceRecovery: { refreshResources: () => this.refreshResources() },
    }
    this.material = new ShaderMaterial({
      uniforms: {
        progress: { value: 1 },
        visibleRatio: { value: 1 },
        hoverIndex: { value: -1 },
        viewportHeight: { value: 1 },
        pointSize: { value: options.size },
        fromHideBackHemisphere: { value: 0 },
        toHideBackHemisphere: { value: 0 },
        fromHemisphereEdgeFade: { value: 0 },
        toHemisphereEdgeFade: { value: 0 },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
    })
    this.points = new Points(this.geometry, this.material)
    this.points.name = 'SpatialMotionPoints'
    this.points.frustumCulled = false
    this.geometry.setDrawRange(0, 0)
    this.root.add(this.points)
    this.signal.addEventListener('abort', this.dispose, { once: true })
  }

  async setItems(items: readonly MotionItem<TMeta>[]): Promise<boolean> {
    if (this.disposed || this.signal.aborted) return false
    this.items = items.map((item) => ({ ...item }))
    this.transforms.resize(items.length)
    const nextCapacity = resolveBufferCapacity(this.capacity, items.length)
    if (nextCapacity !== this.capacity) {
      const previousGeometry = this.geometry
      this.geometry = createGeometry(nextCapacity, items, this.options)
      this.points.geometry = this.geometry
      this.capacity = nextCapacity
      this.geometryBuilds += 1
      previousGeometry.dispose()
    } else {
      writeColors(
        this.geometry.getAttribute('itemColor') as BufferAttribute,
        items,
        this.options,
      )
      this.attributeReuses += 1
    }
    this.writeTransition(this.transforms, this.transforms)
    this.geometry.setDrawRange(0, items.length)
    return true
  }

  async updateItems(
    items: readonly MotionItem<TMeta>[],
    changedIndices: readonly number[],
  ): Promise<boolean> {
    if (this.disposed || this.signal.aborted) return false
    if (items.length !== this.items.length) return this.setItems(items)
    this.items = items.map((item) => ({ ...item }))
    const colors = this.geometry.getAttribute('itemColor') as BufferAttribute
    changedIndices.forEach((index) => {
      if (index < 0 || index >= items.length) return
      colors.setXYZ(index, ...itemColor(items[index], index, this.options))
    })
    markAttributeRanges(colors, changedIndices, 3, items.length)
    return true
  }

  setTransforms(buffer: TransformBufferView): void {
    this.transforms.copyFromBuffer(buffer)
    this.writeTransition(buffer, buffer)
    this.setProgress(1)
  }

  prepareTransition(
    from: TransformBufferView,
    to: TransformBufferView,
  ): void {
    this.transforms.copyFromBuffer(to)
    this.writeTransition(from, to)
    this.setProgress(0)
  }

  prepareVisualTransition(
    from: MotionRendererVisualState,
    to: MotionRendererVisualState,
  ): void {
    this.material.uniforms.fromHideBackHemisphere.value = from.hideBackHemisphere
    this.material.uniforms.toHideBackHemisphere.value = to.hideBackHemisphere
    this.material.uniforms.fromHemisphereEdgeFade.value = from.hemisphereEdgeFade
    this.material.uniforms.toHemisphereEdgeFade.value = to.hemisphereEdgeFade
  }

  setProgress(progress: number): void {
    this.material.uniforms.progress.value = clamp(progress, 0, 1)
  }

  setVisualState(state: MotionRendererVisualState): void {
    this.material.uniforms.fromHideBackHemisphere.value = state.hideBackHemisphere
    this.material.uniforms.toHideBackHemisphere.value = state.hideBackHemisphere
    this.material.uniforms.fromHemisphereEdgeFade.value = state.hemisphereEdgeFade
    this.material.uniforms.toHemisphereEdgeFade.value = state.hemisphereEdgeFade
  }

  setVisibleRatio(ratio: number): void {
    this.material.uniforms.visibleRatio.value = clamp(ratio, 0, 1)
  }

  setHoverIndex(index: number | null): void {
    this.material.uniforms.hoverIndex.value = index ?? -1
  }

  resize(viewport: MotionRendererViewport): void {
    this.material.uniforms.viewportHeight.value = Math.max(1, viewport.height * viewport.pixelRatio)
  }

  refreshResources(): void {
    Object.values(this.geometry.attributes).forEach((attribute) => {
      attribute.needsUpdate = true
    })
    this.material.needsUpdate = true
  }

  getStats(): MotionRendererStats {
    const instanceCount = this.disposed ? 0 : this.items.length
    return {
      instanceCount,
      submittedInstanceCount: this.disposed ? 0 : this.geometry.drawRange.count,
      gpuBytes: this.disposed ? 0 : geometryByteLength(this.geometry),
      metrics: {
        capacity: this.disposed ? 0 : this.capacity,
        geometryBuilds: this.geometryBuilds,
        attributeReuses: this.attributeReuses,
      },
    }
  }

  readonly dispose = (): void => {
    if (this.disposed) return
    this.disposed = true
    this.signal.removeEventListener('abort', this.dispose)
    this.root.remove(this.points)
    this.geometry.dispose()
    this.material.dispose()
    this.items = []
    this.transforms.resize(0)
  }

  private writeTransition(from: TransformBufferView, to: TransformBufferView): void {
    if (this.disposed) return
    const count = Math.min(from.count, to.count, this.items.length)
    const fromPosition = this.geometry.getAttribute('fromPosition') as BufferAttribute
    const toPosition = this.geometry.getAttribute('toPosition') as BufferAttribute
    const fromScale = this.geometry.getAttribute('fromScale') as BufferAttribute
    const toScale = this.geometry.getAttribute('toScale') as BufferAttribute
    const fromOpacity = this.geometry.getAttribute('fromOpacity') as BufferAttribute
    const toOpacity = this.geometry.getAttribute('toOpacity') as BufferAttribute
    ;(fromPosition.array as Float32Array).set(from.positions.subarray(0, count * 3))
    ;(toPosition.array as Float32Array).set(to.positions.subarray(0, count * 3))
    ;(fromScale.array as Float32Array).set(from.scales.subarray(0, count))
    ;(toScale.array as Float32Array).set(to.scales.subarray(0, count))
    ;(fromOpacity.array as Float32Array).set(from.opacities.subarray(0, count))
    ;(toOpacity.array as Float32Array).set(to.opacities.subarray(0, count))
    ;[fromPosition, toPosition].forEach((attribute) => markAttributeRange(attribute, count * 3))
    ;[fromScale, toScale, fromOpacity, toOpacity]
      .forEach((attribute) => markAttributeRange(attribute, count))
    this.attributeReuses += 6
    this.geometry.setDrawRange(0, count)
  }
}

function createGeometry<TMeta>(
  capacity: number,
  items: readonly MotionItem<TMeta>[],
  options: PointsRendererOptions<TMeta>,
): BufferGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', dynamicAttribute(new Float32Array(capacity * 3), 3))
  const colors = dynamicAttribute(new Float32Array(capacity * 3), 3)
  writeColors(colors, items, options)
  geometry.setAttribute('itemColor', colors)
  geometry.setAttribute('visibilityRank', new BufferAttribute(createVisibilityRanks(capacity), 1))
  geometry.setAttribute('itemIndex', new BufferAttribute(
    Float32Array.from({ length: capacity }, (_value, index) => index),
    1,
  ))
  geometry.setAttribute('fromPosition', dynamicAttribute(new Float32Array(capacity * 3), 3))
  geometry.setAttribute('toPosition', dynamicAttribute(new Float32Array(capacity * 3), 3))
  geometry.setAttribute('fromScale', dynamicAttribute(new Float32Array(capacity), 1))
  geometry.setAttribute('toScale', dynamicAttribute(new Float32Array(capacity), 1))
  geometry.setAttribute('fromOpacity', dynamicAttribute(new Float32Array(capacity), 1))
  geometry.setAttribute('toOpacity', dynamicAttribute(new Float32Array(capacity), 1))
  return geometry
}

function writeColors<TMeta>(
  attribute: BufferAttribute,
  items: readonly MotionItem<TMeta>[],
  options: PointsRendererOptions<TMeta>,
): void {
  items.forEach((item, index) => {
    attribute.setXYZ(index, ...itemColor(item, index, options))
  })
  markAttributeRange(attribute, items.length * 3)
}

function itemColor<TMeta>(
  item: MotionItem<TMeta>,
  index: number,
  options: PointsRendererOptions<TMeta>,
): [number, number, number] {
  let value: PointColor | undefined
  try {
    value = options.resolveColor?.(item, index)
  } catch {
    value = undefined
  }
  const color = new Color()
  try {
    if (value !== undefined) color.set(value)
    else if (options.color !== undefined) color.set(options.color)
    else color.setHSL(hashUnit(item.id), 0.68, 0.58)
  } catch {
    color.setHSL(hashUnit(item.id), 0.68, 0.58)
  }
  return [color.r, color.g, color.b]
}

function createVisibilityRanks(count: number): Float32Array {
  return Float32Array.from(
    { length: count },
    (_value, index) => (index * 0.618033988749895) % 1,
  )
}

function normalizeSize(value: number | undefined): number {
  return Number.isFinite(value) ? clamp(value as number, 0.05, 4) : 1
}

function resolveBufferCapacity(current: number, required: number): number {
  if (required <= 0) return 0
  if (required <= current && required >= current / 2) return current
  return 2 ** Math.ceil(Math.log2(required))
}

function hashUnit(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) / 0xffffffff
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function geometryByteLength(geometry: BufferGeometry): number {
  const attributes = Object.values(geometry.attributes)
    .reduce((total, attribute) => total + attribute.array.byteLength, 0)
  return attributes + (geometry.index?.array.byteLength ?? 0)
}

function dynamicAttribute(array: Float32Array, itemSize: number): BufferAttribute {
  return new BufferAttribute(array, itemSize).setUsage(DynamicDrawUsage)
}

function markAttributeRange(attribute: BufferAttribute, count: number): void {
  attribute.clearUpdateRanges()
  if (count > 0) attribute.addUpdateRange(0, count)
  attribute.needsUpdate = true
}

function markAttributeRanges(
  attribute: BufferAttribute,
  indices: readonly number[],
  itemSize: number,
  itemCount: number,
): void {
  const unique = [...new Set(indices)]
    .filter((index) => index >= 0 && index < itemCount)
    .sort((left, right) => left - right)
  attribute.clearUpdateRanges()
  let start = unique[0]
  let previous = start
  for (let index = 1; index <= unique.length; index += 1) {
    const current = unique[index]
    if (current === previous + 1) {
      previous = current
      continue
    }
    if (start !== undefined && previous !== undefined) {
      attribute.addUpdateRange(start * itemSize, (previous - start + 1) * itemSize)
    }
    start = current
    previous = current
  }
  if (unique.length) attribute.needsUpdate = true
}
