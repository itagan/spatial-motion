import { Euler, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three'
import type { Layout, MotionItem, QualityLevel, Transform, TransitionOptions } from './types'
import { easing, identityTransform, interpolateTransform } from './math'
import { InstancedCardRenderer } from '../renderers/InstancedCardRenderer'
import { detectQuality, qualityProfiles, visibleRatios } from '../performance/quality'
import {
  AdaptivePerformanceManager,
  type PerformanceStats,
} from '../performance/AdaptivePerformanceManager'
import { Timeline } from './Timeline'
import { TunnelEffect } from '../effects/TunnelEffect'
import { LinearShooterEffect } from '../effects/LinearShooterEffect'
import type { StreamingEffect } from '../effects/types'

export interface MotionStageOptions {
  container: HTMLElement
  items?: MotionItem[]
  quality?: QualityLevel | 'auto'
  cameraZ?: number
  adaptivePerformance?: boolean
  onQualityChange?: (quality: QualityLevel, stats: PerformanceStats) => void
  onItemClick?: (item: MotionItem, index: number) => void
}

export interface UpdateItemsOptions {
  layout?: Layout
  duration?: number
}

export interface FocusItemsOptions extends TransitionOptions {
  columns?: number
  gap?: number
  scale?: number
  z?: number
  dimOpacity?: number
}

export interface PickResult {
  item: MotionItem
  index: number
  distance: number
}

export class MotionStage {
  private readonly scene = new Scene()
  private readonly camera: PerspectiveCamera
  private readonly renderer: WebGLRenderer
  private readonly cards: InstancedCardRenderer
  private readonly resizeObserver: ResizeObserver
  private readonly projectionVector = new Vector3()
  private readonly groupEuler = new Euler()
  private items: MotionItem[] = []
  private transforms: Transform[] = []
  private frameId = 0
  private lastFrame = 0
  private rotateX = 0
  private rotateY = 0
  private rotateSpeedX = 0
  private rotateSpeedY = 0
  private transitionToken = 0
  private activeTransition: {
    from: Transform[]
    to: Transform[]
    startedAt: number
    duration: number
    easing: (value: number) => number
  } | null = null
  private activeEffect: { effect: StreamingEffect; startedAt: number } | null = null
  private quality: QualityLevel
  private readonly performanceManager: AdaptivePerformanceManager
  private lastLayout: Layout | null = null
  private visibleRatio = 1
  private itemsToken = 0
  private destroyed = false

  constructor(private readonly options: MotionStageOptions) {
    this.quality = options.quality === 'auto' || !options.quality ? detectQuality() : options.quality
    this.performanceManager = new AdaptivePerformanceManager(this.quality)
    const profile = qualityProfiles[this.quality]
    this.camera = new PerspectiveCamera(45, 1, 0.1, 100)
    this.camera.position.z = options.cameraZ ?? 18
    this.renderer = new WebGLRenderer({ alpha: true, antialias: profile.antialias, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, profile.maxPixelRatio))
    this.options.container.appendChild(this.renderer.domElement)
    this.renderer.domElement.addEventListener('pointerup', this.handlePointerUp)
    this.cards = new InstancedCardRenderer(this.scene)
    this.resizeObserver = new ResizeObserver(() => {
      if (!this.destroyed) this.resizeInternal()
    })
    this.resizeObserver.observe(this.options.container)
    this.resizeInternal()
    this.frameId = requestAnimationFrame(this.render)
  }

  setItems(items: MotionItem[]): Promise<void> {
    this.assertActive()
    validateItems(items)
    return this.setItemsInternal(items)
  }

  private async setItemsInternal(items: MotionItem[]): Promise<void> {
    const token = ++this.itemsToken
    this.transitionToken += 1
    this.activeTransition = null
    this.activeEffect = null
    this.cards.disableEffect()
    const maxItems = qualityProfiles[this.quality].maxVisibleItems
    const nextItems = items.slice(0, maxItems)
    const nextTransforms = nextItems.map(identityTransform)
    const applied = await this.cards.setItems(nextItems)
    if (!applied || token !== this.itemsToken || this.destroyed) return
    this.items = nextItems
    this.transforms = nextTransforms
    this.cards.setTransforms(nextTransforms)
    this.visibleRatio = visibleRatios[this.quality]
    this.cards.setVisibleRatio(this.visibleRatio)
  }

  to(layout: Layout, options: TransitionOptions = {}): Promise<boolean> {
    this.assertActive()
    return this.toInternal(layout, options)
  }

  private async toInternal(layout: Layout, options: TransitionOptions): Promise<boolean> {
    const completed = await this.transitionTo(layout, options)
    if (completed) this.lastLayout = layout
    return completed
  }

  private async transitionTo(layout: Layout, options: TransitionOptions = {}): Promise<boolean> {
    const now = performance.now()
    this.transforms = this.resolveCurrentTransforms(now)
    if (this.activeEffect) {
      this.activeEffect = null
      this.cards.disableEffect()
    }
    const token = ++this.transitionToken
    const from = this.transforms
    const target = layout.calculate(this.items.length, this.context())
    this.cards.setOrientation(layout.orientation ?? 'surface')
    this.cards.setHideBackHemisphere(layout.hideBackHemisphere ?? false)
    const duration = Math.max(0, options.duration ?? 1200)
    const ease = options.easing ?? easing.cubicInOut
    if (duration === 0) {
      this.transforms = target
      this.activeTransition = null
      this.cards.setTransforms(target)
      return true
    }
    this.activeTransition = { from, to: target, startedAt: now, duration, easing: ease }
    this.cards.prepareTransition(from, target)
    return new Promise<boolean>((resolve) => {
      const update = (frameTime: number) => {
        if (token !== this.transitionToken) return resolve(false)
        const progress = Math.min(1, (frameTime - now) / duration)
        const eased = ease(progress)
        this.cards.setProgress(eased)
        if (progress < 1) requestAnimationFrame(update)
        else {
          this.transforms = target
          this.activeTransition = null
          resolve(true)
        }
      }
      requestAnimationFrame(update)
    })
  }

  enterTunnel(effect: TunnelEffect, options: TransitionOptions = {}): Promise<boolean> {
    this.assertActive()
    return this.enterStreamingEffect(effect, () => this.cards.enableTunnel(effect.getGpuData()), options)
  }

  enterLinearShooter(effect: LinearShooterEffect, options: TransitionOptions = {}): Promise<boolean> {
    this.assertActive()
    return this.enterStreamingEffect(effect, () => this.cards.enableLinearShooter(effect.getGpuData()), options)
  }

  private async enterStreamingEffect(
    effect: StreamingEffect,
    enableEffect: () => void,
    options: TransitionOptions,
  ): Promise<boolean> {
    effect.prepare(this.items.length)
    const target = effect.calculateTransforms(this.items.length, 0)
    const entered = await this.transitionTo(
      {
        name: `${effect.name}-entry`,
        orientation: 'camera',
        hideBackHemisphere: false,
        calculate: () => target,
      },
      options,
    )
    if (!entered) return false
    enableEffect()
    this.activeEffect = { effect, startedAt: performance.now() }
    return true
  }

  updateItems(items: MotionItem[], options: UpdateItemsOptions = {}): Promise<boolean> {
    this.assertActive()
    validateItems(items)
    return this.updateItemsInternal(items, options)
  }

  private async updateItemsInternal(items: MotionItem[], options: UpdateItemsOptions): Promise<boolean> {
    const now = performance.now()
    const current = this.resolveCurrentTransforms(now)
    const previousById = new Map(this.items.map((item, index) => [item.id, current[index]]))
    const token = ++this.itemsToken
    this.transitionToken += 1
    this.activeTransition = null
    this.activeEffect = null
    this.cards.disableEffect()
    this.transforms = current
    this.cards.setTransforms(current)

    const maxItems = qualityProfiles[this.quality].maxVisibleItems
    const nextItems = items.slice(0, maxItems)
    const nextTransforms = nextItems.map((item) => {
      const previous = previousById.get(item.id)
      return previous ? { ...previous } : identityTransform()
    })
    const applied = await this.cards.setItems(nextItems)
    if (!applied || token !== this.itemsToken || this.destroyed) return false
    this.items = nextItems
    this.transforms = nextTransforms
    this.cards.setTransforms(nextTransforms)
    this.cards.setVisibleRatio(this.visibleRatio)

    const targetLayout = options.layout ?? this.lastLayout
    if (!targetLayout) return true
    const completed = await this.transitionTo(targetLayout, { duration: options.duration ?? 800 })
    if (completed && options.layout) this.lastLayout = options.layout
    return completed
  }

  focusItems(ids: string[], options: FocusItemsOptions = {}): Promise<boolean> {
    this.assertActive()
    return this.focusItemsInternal(ids, options)
  }

  private async focusItemsInternal(ids: string[], options: FocusItemsOptions): Promise<boolean> {
    const selected = new Set(ids)
    const selectedIndices = this.items
      .map((item, index) => (selected.has(item.id) ? index : -1))
      .filter((index) => index >= 0)
    if (!selectedIndices.length) return false

    const current = this.resolveCurrentTransforms(performance.now())
    const selectedOrder = new Map(selectedIndices.map((index, order) => [index, order]))
    const columns = Math.max(1, options.columns ?? Math.ceil(Math.sqrt(selectedIndices.length)))
    const rows = Math.ceil(selectedIndices.length / columns)
    const gap = options.gap ?? 1.7
    const focusScale = options.scale ?? 1.45
    const z = options.z ?? 8
    const dimOpacity = options.dimOpacity ?? 0.08

    return this.transitionTo(
      {
        name: 'focus',
        orientation: 'camera',
        calculate: () => current.map((transform, index) => {
          const order = selectedOrder.get(index)
          if (order === undefined) {
            return { ...transform, scale: Math.min(transform.scale, 0.35), opacity: dimOpacity }
          }
          return {
            x: (order % columns - (columns - 1) / 2) * gap,
            y: ((rows - 1) / 2 - Math.floor(order / columns)) * gap,
            z,
            scale: focusScale,
            rotationX: 0,
            rotationY: 0,
            rotationZ: 0,
            opacity: 1,
          }
        }),
      },
      options,
    )
  }

  restoreLayout(options: TransitionOptions = {}): Promise<boolean> {
    this.assertActive()
    if (!this.lastLayout) return Promise.resolve(false)
    return this.transitionTo(this.lastLayout, options)
  }

  pick(clientX: number, clientY: number, radius = 56): PickResult | null {
    this.assertActive()
    const rect = this.renderer.domElement.getBoundingClientRect()
    const transforms = this.resolveCurrentTransforms(performance.now())
    this.camera.updateMatrixWorld()
    this.groupEuler.set(this.rotateX, this.rotateY, 0, 'XYZ')
    let closest: PickResult | null = null

    transforms.forEach((transform, index) => {
      if (transform.opacity < 0.05 || visibilityRank(index) > this.visibleRatio) return
      this.projectionVector
        .set(transform.x, transform.y, transform.z)
        .applyEuler(this.groupEuler)
        .project(this.camera)
      if (this.projectionVector.z < -1 || this.projectionVector.z > 1) return
      const screenX = rect.left + (this.projectionVector.x + 1) * rect.width / 2
      const screenY = rect.top + (1 - this.projectionVector.y) * rect.height / 2
      const distance = Math.hypot(clientX - screenX, clientY - screenY)
      if (distance <= radius && (!closest || distance < closest.distance)) {
        closest = { item: this.items[index], index, distance }
      }
    })
    return closest
  }

  autoRotate(options: { x?: number; y?: number } = {}): void {
    this.assertActive()
    this.rotateSpeedX = options.x ?? 0
    this.rotateSpeedY = options.y ?? 0.25
  }

  stopRotation(): void {
    this.assertActive()
    this.rotateSpeedX = 0
    this.rotateSpeedY = 0
  }

  setRotation(x: number, y: number): void {
    this.assertActive()
    this.rotateX = x
    this.rotateY = y
    this.cards.setGroupRotation(x, y)
  }

  timeline(): Timeline {
    this.assertActive()
    return new Timeline()
  }

  resize(): void {
    this.assertActive()
    this.resizeInternal()
  }

  private resizeInternal(): void {
    const { clientWidth: width, clientHeight: height } = this.options.container
    if (!width || !height) return
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height, false)
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.itemsToken += 1
    this.transitionToken += 1
    cancelAnimationFrame(this.frameId)
    this.resizeObserver.disconnect()
    this.renderer.domElement.removeEventListener('pointerup', this.handlePointerUp)
    this.cards.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  getQuality(): QualityLevel {
    this.assertActive()
    return this.quality
  }

  getPerformanceStats(): PerformanceStats {
    this.assertActive()
    return this.performanceManager.getStats()
  }

  private context() {
    return { width: this.options.container.clientWidth, height: this.options.container.clientHeight }
  }

  private resolveCurrentTransforms(now: number): Transform[] {
    if (this.activeEffect) {
      return this.activeEffect.effect.calculateTransforms(
        this.items.length,
        Math.max(0, (now - this.activeEffect.startedAt) / 1000),
      )
    }
    if (!this.activeTransition) return this.transforms.map((transform) => ({ ...transform }))
    const { from, to, startedAt, duration, easing: transitionEasing } = this.activeTransition
    const progress = transitionEasing(Math.min(1, Math.max(0, (now - startedAt) / duration)))
    return to.map((transform, index) =>
      interpolateTransform(from[index] ?? identityTransform(), transform, progress),
    )
  }

  private readonly render = (now: number) => {
    const rawFrameMs = now - this.lastFrame || 0
    const delta = Math.min(0.05, rawFrameMs / 1000)
    this.lastFrame = now
    if (this.options.adaptivePerformance !== false && document.visibilityState === 'visible') {
      const nextQuality = this.performanceManager.recordFrame(rawFrameMs, now)
      if (nextQuality) this.applyQuality(nextQuality)
    }
    this.rotateX += this.rotateSpeedX * delta
    this.rotateY += this.rotateSpeedY * delta
    this.cards.setGroupRotation(this.rotateX, this.rotateY)
    if (this.activeEffect) {
      this.cards.setEffectTime(Math.max(0, (now - this.activeEffect.startedAt) / 1000))
    }
    this.renderer.render(this.scene, this.camera)
    this.frameId = requestAnimationFrame(this.render)
  }

  private applyQuality(quality: QualityLevel): void {
    this.quality = quality
    const profile = qualityProfiles[quality]
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, profile.maxPixelRatio))
    this.cards.setVisibleRatio(visibleRatios[quality])
    this.visibleRatio = visibleRatios[quality]
    this.resizeInternal()
    this.options.onQualityChange?.(quality, this.performanceManager.getStats())
  }

  private readonly handlePointerUp = (event: PointerEvent) => {
    if (this.destroyed) return
    const result = this.pick(event.clientX, event.clientY)
    if (result) this.options.onItemClick?.(result.item, result.index)
  }

  private assertActive(): void {
    if (this.destroyed) throw new Error('MotionStage has been destroyed')
  }
}

function visibilityRank(index: number): number {
  return (index * 0.618033988749895) % 1
}

function validateItems(items: MotionItem[]): void {
  const ids = new Set<string>()
  items.forEach((item, index) => {
    if (!item.id.trim()) throw new Error(`MotionItem at index ${index} must have a non-empty id`)
    if (ids.has(item.id)) throw new Error(`Duplicate MotionItem id: ${item.id}`)
    ids.add(item.id)
  })
}
