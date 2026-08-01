import {
  MotionStage,
  defineLayout,
  defineMotionRenderer,
  sphere,
  type MotionItem,
  type MotionRenderer,
  type MotionRendererStats,
  type TransformBuffer,
  type TransformBufferView,
} from '@itagan/spatial-motion'
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  LineSegments,
  ShaderMaterial,
  type Group,
} from 'three'
import '../shared.css'

interface BusinessMeta {
  team: string
  score: number
  color: string
}

const items: MotionItem<BusinessMeta>[] = Array.from({ length: 180 }, (_, index) => ({
  id: `metric-${index}`,
  title: `Metric ${index + 1}`,
  meta: {
    team: ['Platform', 'Growth', 'Experience'][index % 3],
    score: 35 + (index * 37) % 66,
    color: ['#67e8f9', '#a78bfa', '#fbbf24'][index % 3],
  },
}))

const businessLanes = defineLayout<BusinessMeta>({
  name: 'business-lanes',
  orientation: 'camera',
  calculateInto(count, context, target: TransformBuffer) {
    target.resize(count)
    const visibleItems = context.items ?? []
    const teams = [...new Set(visibleItems.map((item) => item.meta?.team ?? 'Other'))]
    const laneOffsets = new Map<string, number>()
    const laneCounts = new Map<string, number>()
    const laneSizes = new Map<string, number>()
    teams.forEach((team, index) => laneOffsets.set(team, index))
    visibleItems.forEach((item) => {
      const team = item.meta?.team ?? 'Other'
      laneSizes.set(team, (laneSizes.get(team) ?? 0) + 1)
    })

    for (let index = 0; index < count; index += 1) {
      const meta = visibleItems[index]?.meta
      const team = meta?.team ?? 'Other'
      const lane = laneOffsets.get(team) ?? 0
      const itemInLane = laneCounts.get(team) ?? 0
      laneCounts.set(team, itemInLane + 1)
      const laneSize = laneSizes.get(team) ?? count
      const columns = Math.max(1, Math.ceil(Math.sqrt(laneSize * 1.6)))
      const rows = Math.ceil(laneSize / columns)
      const column = itemInLane % columns
      const row = Math.floor(itemInLane / columns)
      const x = (lane - (teams.length - 1) / 2) * 3.8
        + (column - (columns - 1) / 2) * 0.28
      const y = (row - (rows - 1) / 2) * 1.05
      const score = meta?.score ?? 50
      target.setValues(index, x, y, (score - 50) * 0.015, 0.35 + score / 130, 0, 0, 0, 1)
    }
  },
})

const vertexShader = `
  attribute vec3 fromCenter;
  attribute vec3 toCenter;
  attribute float fromScale;
  attribute float toScale;
  attribute float fromOpacity;
  attribute float toOpacity;
  attribute vec3 itemColor;
  attribute float visibilityRank;
  uniform float progress;
  uniform float visibleRatio;
  varying vec3 vColor;
  varying float vOpacity;

  void main() {
    vec3 center = mix(fromCenter, toCenter, progress);
    float scale = mix(fromScale, toScale, progress);
    float visible = 1.0 - step(visibleRatio, visibilityRank);
    vec3 local = position * vec3(0.32, scale, 1.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(center + local, 1.0);
    vColor = itemColor;
    vOpacity = mix(fromOpacity, toOpacity, progress) * visible;
  }
`

const fragmentShader = `
  varying vec3 vColor;
  varying float vOpacity;

  void main() {
    if (vOpacity < 0.01) discard;
    gl_FragColor = vec4(vColor, vOpacity);
  }
`

function businessBarsRenderer() {
  return defineMotionRenderer<BusinessMeta>(({ root, signal }) =>
    new BusinessBarsRenderer(root, signal))
}

class BusinessBarsRenderer implements MotionRenderer<BusinessMeta> {
  readonly descriptor = { itemBounds: null }
  readonly capabilities = {
    patch: {
      updateItems: async (items: readonly MotionItem<BusinessMeta>[], changed: readonly number[]) => {
        if (this.disposed || items.length !== this.items.length) return this.setItems(items)
        this.items = [...items]
        const colors = this.geometry.getAttribute('itemColor') as BufferAttribute
        changed.forEach((index) => this.writeColor(colors, index, items[index]))
        colors.needsUpdate = true
        return true
      },
    },
    resourceRecovery: {
      refreshResources: () => {
        Object.values(this.geometry.attributes).forEach((attribute) => {
          attribute.needsUpdate = true
        })
        this.material.needsUpdate = true
      },
    },
  }

  private geometry = createGeometry(0)
  private readonly material = new ShaderMaterial({
    uniforms: {
      progress: { value: 1 },
      visibleRatio: { value: 1 },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
  })
  private readonly lines = new LineSegments(this.geometry, this.material)
  private readonly color = new Color()
  private items: readonly MotionItem<BusinessMeta>[] = []
  private disposed = false
  private capacity = 0
  private geometryBuilds = 0

  constructor(
    private readonly root: Group,
    private readonly signal: AbortSignal,
  ) {
    this.lines.name = 'BusinessBarsRenderer'
    this.lines.frustumCulled = false
    this.root.add(this.lines)
    this.signal.addEventListener('abort', this.dispose, { once: true })
  }

  async setItems(items: readonly MotionItem<BusinessMeta>[]): Promise<boolean> {
    if (this.disposed || this.signal.aborted) return false
    this.items = [...items]
    const nextCapacity = resolveCapacity(this.capacity, items.length)
    if (nextCapacity !== this.capacity) {
      const previous = this.geometry
      this.geometry = createGeometry(nextCapacity)
      this.lines.geometry = this.geometry
      this.capacity = nextCapacity
      this.geometryBuilds += 1
      previous.dispose()
    }
    const colors = this.geometry.getAttribute('itemColor') as BufferAttribute
    items.forEach((item, index) => this.writeColor(colors, index, item))
    colors.needsUpdate = true
    const ranks = this.geometry.getAttribute('visibilityRank') as BufferAttribute
    items.forEach((_item, index) => {
      const rank = (index + 0.5) / Math.max(1, items.length)
      ranks.setX(index * 2, rank)
      ranks.setX(index * 2 + 1, rank)
    })
    ranks.needsUpdate = true
    this.geometry.setDrawRange(0, items.length * 2)
    return true
  }

  setTransforms(buffer: TransformBufferView): void {
    this.writeTransition(buffer, buffer)
    this.setProgress(1)
  }

  prepareTransition(from: TransformBufferView, to: TransformBufferView): void {
    this.writeTransition(from, to)
    this.setProgress(0)
  }

  setProgress(progress: number): void {
    this.material.uniforms.progress.value = Math.min(1, Math.max(0, progress))
  }

  setVisibleRatio(ratio: number): void {
    this.material.uniforms.visibleRatio.value = Math.min(1, Math.max(0, ratio))
  }

  getStats(): MotionRendererStats {
    return {
      instanceCount: this.disposed ? 0 : this.items.length,
      submittedInstanceCount: this.disposed ? 0 : this.items.length,
      gpuBytes: this.disposed
        ? 0
        : Object.values(this.geometry.attributes)
            .reduce((bytes, attribute) => bytes + attribute.array.byteLength, 0),
      metrics: {
        capacity: this.disposed ? 0 : this.capacity,
        geometryBuilds: this.geometryBuilds,
      },
    }
  }

  readonly dispose = (): void => {
    if (this.disposed) return
    this.disposed = true
    this.signal.removeEventListener('abort', this.dispose)
    this.root.remove(this.lines)
    this.geometry.dispose()
    this.material.dispose()
    this.items = []
  }

  private writeColor(
    attribute: BufferAttribute,
    index: number,
    item: MotionItem<BusinessMeta> | undefined,
  ): void {
    if (!item || index < 0 || index >= this.items.length) return
    this.color.set(item.meta?.color ?? '#94a3b8')
    attribute.setXYZ(index * 2, this.color.r, this.color.g, this.color.b)
    attribute.setXYZ(index * 2 + 1, this.color.r, this.color.g, this.color.b)
  }

  private writeTransition(from: TransformBufferView, to: TransformBufferView): void {
    const count = Math.min(this.items.length, from.count, to.count)
    copyCenters(this.geometry.getAttribute('fromCenter') as BufferAttribute, from, count)
    copyCenters(this.geometry.getAttribute('toCenter') as BufferAttribute, to, count)
    copyScalar(this.geometry.getAttribute('fromScale') as BufferAttribute, from.scales, count)
    copyScalar(this.geometry.getAttribute('toScale') as BufferAttribute, to.scales, count)
    copyScalar(this.geometry.getAttribute('fromOpacity') as BufferAttribute, from.opacities, count)
    copyScalar(this.geometry.getAttribute('toOpacity') as BufferAttribute, to.opacities, count)
    this.geometry.setDrawRange(0, count * 2)
  }
}

function createGeometry(capacity: number): BufferGeometry {
  const geometry = new BufferGeometry()
  const vertices = capacity * 2
  const localPositions = new Float32Array(vertices * 3)
  for (let index = 0; index < capacity; index += 1) {
    localPositions[index * 6 + 1] = -0.5
    localPositions[index * 6 + 4] = 0.5
  }
  geometry.setAttribute('position', new BufferAttribute(localPositions, 3))
  geometry.setAttribute('fromCenter', dynamicAttribute(vertices * 3, 3))
  geometry.setAttribute('toCenter', dynamicAttribute(vertices * 3, 3))
  geometry.setAttribute('fromScale', dynamicAttribute(vertices, 1))
  geometry.setAttribute('toScale', dynamicAttribute(vertices, 1))
  geometry.setAttribute('fromOpacity', dynamicAttribute(vertices, 1))
  geometry.setAttribute('toOpacity', dynamicAttribute(vertices, 1))
  geometry.setAttribute('itemColor', dynamicAttribute(vertices * 3, 3))
  geometry.setAttribute('visibilityRank', dynamicAttribute(vertices, 1))
  return geometry
}

function resolveCapacity(current: number, required: number): number {
  if (required <= current) return current
  let capacity = Math.max(1, current)
  while (capacity < required) capacity *= 2
  return capacity
}

function dynamicAttribute(length: number, itemSize: number): BufferAttribute {
  return new BufferAttribute(new Float32Array(length), itemSize).setUsage(DynamicDrawUsage)
}

function copyCenters(attribute: BufferAttribute, source: TransformBufferView, count: number): void {
  const target = attribute.array as Float32Array
  for (let index = 0; index < count; index += 1) {
    const sourceOffset = index * 3
    const targetOffset = index * 6
    target.set(source.positions.subarray(sourceOffset, sourceOffset + 3), targetOffset)
    target.set(source.positions.subarray(sourceOffset, sourceOffset + 3), targetOffset + 3)
  }
  attribute.needsUpdate = true
}

function copyScalar(attribute: BufferAttribute, source: Float32Array, count: number): void {
  const target = attribute.array as Float32Array
  for (let index = 0; index < count; index += 1) {
    target[index * 2] = source[index]
    target[index * 2 + 1] = source[index]
  }
  attribute.needsUpdate = true
}

const status = document.querySelector<HTMLElement>('#status')!
const stage = new MotionStage<BusinessMeta>({
  container: document.querySelector<HTMLElement>('#stage')!,
  renderer: businessBarsRenderer(),
  quality: 'auto',
  transition: { duration: 700 },
})
await stage.setItems(items)
await stage.to(businessLanes, { duration: 0 })

document.querySelector('#business')?.addEventListener('click', () => {
  void stage.to(businessLanes)
})
document.querySelector('#sphere')?.addEventListener('click', () => {
  void stage.to(sphere({ radius: 4.8, orientation: 'camera' }))
})

const timer = window.setInterval(() => {
  const stats = stage.getPerformanceStats()
  status.textContent = `${stats.render.drawCalls} DRAW · ${stats.submittedItems} ITEMS · ${stats.renderer.gpuBytes} GPU BYTES`
}, 500)
window.addEventListener('pagehide', () => {
  window.clearInterval(timer)
  stage.destroy()
}, { once: true })
