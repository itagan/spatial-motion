import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Points,
  ShaderMaterial,
  type Group,
} from 'three'
import type { MotionItem, Transform } from '../../core/types.js'
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
  private transforms: Transform[] = []
  private disposed = false

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

  async setItems(items: MotionItem<TMeta>[]): Promise<boolean> {
    if (this.disposed || this.signal.aborted) return false
    this.items = items.map((item) => ({ ...item }))
    this.transforms = fitTransforms(this.transforms, items.length)
    const previousGeometry = this.geometry
    this.geometry = createGeometry(items, this.options)
    this.points.geometry = this.geometry
    previousGeometry.dispose()
    this.writeTransition(this.transforms, this.transforms)
    this.geometry.setDrawRange(0, items.length)
    return true
  }

  async updateItems(items: MotionItem<TMeta>[], changedIndices: number[]): Promise<boolean> {
    if (this.disposed || this.signal.aborted) return false
    if (items.length !== this.items.length) return this.setItems(items)
    this.items = items.map((item) => ({ ...item }))
    const colors = this.geometry.getAttribute('itemColor') as BufferAttribute
    changedIndices.forEach((index) => {
      if (index < 0 || index >= items.length) return
      colors.setXYZ(index, ...itemColor(items[index], index, this.options))
    })
    colors.needsUpdate = true
    return true
  }

  setTransforms(transforms: Transform[]): void {
    this.transforms = transforms.map((transform) => ({ ...transform }))
    this.writeTransition(this.transforms, this.transforms)
    this.setProgress(1)
  }

  prepareTransition(
    from: Transform[],
    to: Transform[],
  ): void {
    this.transforms = to.map((transform) => ({ ...transform }))
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
    this.transforms = []
  }

  private writeTransition(from: Transform[], to: Transform[]): void {
    if (this.disposed) return
    const count = Math.min(from.length, to.length, this.items.length)
    const fromPosition = new Float32Array(count * 3)
    const toPosition = new Float32Array(count * 3)
    const fromScale = new Float32Array(count)
    const toScale = new Float32Array(count)
    const fromOpacity = new Float32Array(count)
    const toOpacity = new Float32Array(count)
    for (let index = 0; index < count; index += 1) {
      writeTransform(from[index], index, fromPosition, fromScale, fromOpacity)
      writeTransform(to[index], index, toPosition, toScale, toOpacity)
    }
    this.geometry.setAttribute('fromPosition', new BufferAttribute(fromPosition, 3))
    this.geometry.setAttribute('toPosition', new BufferAttribute(toPosition, 3))
    this.geometry.setAttribute('fromScale', new BufferAttribute(fromScale, 1))
    this.geometry.setAttribute('toScale', new BufferAttribute(toScale, 1))
    this.geometry.setAttribute('fromOpacity', new BufferAttribute(fromOpacity, 1))
    this.geometry.setAttribute('toOpacity', new BufferAttribute(toOpacity, 1))
    this.geometry.setDrawRange(0, count)
  }
}

function createGeometry<TMeta>(
  items: MotionItem<TMeta>[],
  options: PointsRendererOptions<TMeta>,
): BufferGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(items.length * 3), 3))
  geometry.setAttribute('itemColor', new BufferAttribute(createColors(items, options), 3))
  geometry.setAttribute('visibilityRank', new BufferAttribute(createVisibilityRanks(items.length), 1))
  geometry.setAttribute('itemIndex', new BufferAttribute(
    Float32Array.from({ length: items.length }, (_value, index) => index),
    1,
  ))
  return geometry
}

function createColors<TMeta>(
  items: MotionItem<TMeta>[],
  options: PointsRendererOptions<TMeta>,
): Float32Array {
  const colors = new Float32Array(items.length * 3)
  items.forEach((item, index) => {
    colors.set(itemColor(item, index, options), index * 3)
  })
  return colors
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

function writeTransform(
  transform: Transform,
  index: number,
  positions: Float32Array,
  scales: Float32Array,
  opacities: Float32Array,
): void {
  positions.set([transform.x, transform.y, transform.z], index * 3)
  scales[index] = transform.scale
  opacities[index] = transform.opacity
}

function fitTransforms(transforms: Transform[], count: number): Transform[] {
  return Array.from({ length: count }, (_value, index) => transforms[index]
    ? { ...transforms[index] }
    : {
        x: 0,
        y: 0,
        z: 0,
        scale: 0,
        rotationX: 0,
        rotationY: 0,
        rotationZ: 0,
        opacity: 0,
      })
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
