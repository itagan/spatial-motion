import { Euler, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three'
import type {
  CardStyle,
  DrawCard,
  Layout,
  MotionItem,
  QualityLevel,
  Transform,
  TransitionOptions,
} from './types.js'
import { easing, identityTransform, interpolateTransform } from './math.js'
import { InstancedCardRenderer } from '../renderers/InstancedCardRenderer.js'
import { detectQuality, qualityProfiles, visibleRatios } from '../performance/quality.js'
import {
  AdaptivePerformanceManager,
  type PerformanceStats,
} from '../performance/AdaptivePerformanceManager.js'
import { Timeline } from './Timeline.js'
import { TunnelEffect } from '../effects/TunnelEffect.js'
import { LinearShooterEffect } from '../effects/LinearShooterEffect.js'
import type { StreamingEffect, StreamingEffectGpuData } from '../effects/types.js'

export interface MotionStageOptions {
  container: HTMLElement
  items?: MotionItem[]
  quality?: QualityLevel | 'auto'
  cameraZ?: number
  adaptivePerformance?: boolean
  onQualityChange?: (quality: QualityLevel, stats: PerformanceStats) => void
  onItemClick?: (item: MotionItem, index: number) => void
  motionPreference?: MotionPreference
  onItemHover?: (item: MotionItem | null, index: number | null) => void
  hoverEffect?: 'none' | 'highlight'
  cardStyle?: CardStyle
  drawCard?: DrawCard
}

export interface UpdateItemsOptions {
  layout?: Layout
  duration?: number
}

export type MotionItemPatch = Partial<Omit<MotionItem, 'id'>>

export interface MotionItemUpdate {
  id: string
  patch: MotionItemPatch
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

export interface PickOptions {
  /** Extra hit area around the projected card in CSS pixels. */
  padding?: number
  /** Prefer the closest card center instead of resolving overlap by camera depth. */
  includeOccluded?: boolean
}

export type QualityMode = QualityLevel | 'auto'
export type MotionPreference = 'auto' | 'full' | 'reduced'

export interface StagePerformanceStats extends PerformanceStats {
  qualityMode: QualityMode
  inputItems: number
  renderedItems: number
  visibleItems: number
  drawCalls: number
  triangles: number
  textureBytes: number
  pixelRatio: number
  paused: boolean
  effect: string | null
  activeEffectItems: number
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
  private sourceItems: MotionItem[] = []
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
  private activeEffect: {
    effect: StreamingEffect
    gpuData: StreamingEffectGpuData
    startedAt: number
  } | null = null
  private quality: QualityLevel
  private performanceManager: AdaptivePerformanceManager
  private qualityMode: QualityMode
  private lastLayout: Layout | null = null
  private visibleRatio = 1
  private currentOrientation: 'surface' | 'camera' = 'surface'
  private hideBackHemisphere = false
  private inputItemCount = 0
  private itemsToken = 0
  private destroyed = false
  private pausedByUser = false
  private pausedByVisibility = document.visibilityState === 'hidden'
  private readonly motionPreference: MotionPreference
  private readonly motionQuery: MediaQueryList | null
  private reducedMotion = false
  private hoveredIndex: number | null = null
  private readonly hoverEnabled: boolean

  constructor(private readonly options: MotionStageOptions) {
    this.motionPreference = options.motionPreference ?? 'auto'
    this.motionQuery = typeof matchMedia === 'function'
      ? matchMedia('(prefers-reduced-motion: reduce)')
      : null
    this.reducedMotion = this.motionPreference === 'reduced'
      || (this.motionPreference === 'auto' && Boolean(this.motionQuery?.matches))
    this.hoverEnabled = Boolean(options.onItemHover) || options.hoverEffect === 'highlight'
    this.qualityMode = options.quality ?? 'auto'
    this.quality = this.qualityMode === 'auto' ? detectQuality() : this.qualityMode
    this.performanceManager = new AdaptivePerformanceManager(this.quality)
    const profile = qualityProfiles[this.quality]
    this.camera = new PerspectiveCamera(45, 1, 0.1, 100)
    this.camera.position.z = options.cameraZ ?? 18
    this.renderer = new WebGLRenderer({ alpha: true, antialias: profile.antialias, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, profile.maxPixelRatio))
    this.options.container.appendChild(this.renderer.domElement)
    this.renderer.domElement.addEventListener('pointerup', this.handlePointerUp)
    if (this.hoverEnabled) {
      this.renderer.domElement.addEventListener('pointermove', this.handlePointerMove)
      this.renderer.domElement.addEventListener('pointerleave', this.handlePointerLeave)
    }
    if (this.motionPreference === 'auto') {
      this.motionQuery?.addEventListener('change', this.handleMotionPreferenceChange)
    }
    document.addEventListener('visibilitychange', this.handleVisibilityChange)
    this.cards = new InstancedCardRenderer(this.scene, {
      cardStyle: options.cardStyle,
      drawCard: options.drawCard,
    })
    this.resizeObserver = new ResizeObserver(() => {
      if (!this.destroyed) this.resizeInternal()
    })
    this.resizeObserver.observe(this.options.container)
    this.resizeInternal()
    if (!this.isPaused()) this.frameId = requestAnimationFrame(this.render)
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
    this.sourceItems = items.map((item) => ({ ...item }))
    this.inputItemCount = items.length
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
    this.currentOrientation = layout.orientation ?? 'surface'
    this.hideBackHemisphere = layout.hideBackHemisphere ?? false
    this.cards.setOrientation(this.currentOrientation)
    this.cards.setHideBackHemisphere(this.hideBackHemisphere)
    const duration = this.reducedMotion ? 0 : Math.max(0, options.duration ?? 1200)
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
    return this.enterEffect(effect, options)
  }

  enterLinearShooter(effect: LinearShooterEffect, options: TransitionOptions = {}): Promise<boolean> {
    return this.enterEffect(effect, options)
  }

  enterEffect(effect: StreamingEffect, options: TransitionOptions = {}): Promise<boolean> {
    this.assertActive()
    return this.enterStreamingEffect(effect, options)
  }

  private async enterStreamingEffect(
    effect: StreamingEffect,
    options: TransitionOptions,
  ): Promise<boolean> {
    effect.prepare(this.items.length, qualityProfiles[this.quality].maxActiveEffectItems)
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
    if (this.reducedMotion) {
      this.transforms = target
      this.cards.setTransforms(target)
      return true
    }
    const gpuData = effect.getGpuData()
    this.cards.enableEffect(gpuData)
    this.activeEffect = { effect, gpuData, startedAt: performance.now() }
    return true
  }

  updateItems(items: MotionItem[], options: UpdateItemsOptions = {}): Promise<boolean> {
    this.assertActive()
    validateItems(items)
    return this.updateItemsInternal(items, options)
  }

  updateItem(id: string, patch: MotionItemPatch, options: UpdateItemsOptions = {}): Promise<boolean> {
    return this.updateItemsById([{ id, patch }], options)
  }

  updateItemsById(updates: MotionItemUpdate[], options: UpdateItemsOptions = {}): Promise<boolean> {
    this.assertActive()
    validateItemUpdates(updates)
    return this.updateItemsByIdInternal(updates, options)
  }

  private async updateItemsByIdInternal(
    updates: MotionItemUpdate[],
    options: UpdateItemsOptions,
  ): Promise<boolean> {
    if (!updates.length) return true
    const updatesById = new Map(updates.map((update) => [update.id, update.patch]))
    const knownIds = new Set(this.sourceItems.map((item) => item.id))
    updates.forEach(({ id }) => {
      if (!knownIds.has(id)) throw new Error(`Unknown MotionItem id: ${id}`)
    })
    const nextSource = this.sourceItems.map((item) => {
      const patch = updatesById.get(item.id)
      return patch ? { ...item, ...patch, id: item.id } : item
    })
    const maxItems = qualityProfiles[this.quality].maxVisibleItems
    const nextItems = nextSource.slice(0, maxItems)
    const changedIndices = nextItems
      .map((item, index) => updatesById.has(item.id) ? index : -1)
      .filter((index) => index >= 0)
    const token = ++this.itemsToken
    const applied = await this.cards.updateItems(nextItems, changedIndices)
    if (!applied || token !== this.itemsToken || this.destroyed) return false
    this.sourceItems = nextSource
    this.items = nextItems
    this.inputItemCount = nextSource.length

    if (!options.layout) return true
    const completed = await this.transitionTo(options.layout, { duration: options.duration ?? 800 })
    if (completed) this.lastLayout = options.layout
    return completed
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
    this.sourceItems = items.map((item) => ({ ...item }))
    this.inputItemCount = items.length
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

  pick(clientX: number, clientY: number, options: number | PickOptions = {}): PickResult | null {
    this.assertActive()
    const rect = this.renderer.domElement.getBoundingClientRect()
    if (!rect.width || !rect.height) return null
    const transforms = this.resolveCurrentTransforms(performance.now())
    this.camera.updateMatrixWorld()
    this.groupEuler.set(this.rotateX, this.rotateY, 0, 'XYZ')
    const legacyRadius = typeof options === 'number' ? Math.max(0, options) : null
    const pickOptions = typeof options === 'number' ? {} : options
    const padding = Math.max(0, pickOptions.padding ?? 0)
    const billboard = this.currentOrientation === 'camera' || Boolean(this.activeEffect)
    const candidates: Array<PickResult & { depth: number }> = []
    const groupOrigin = new Vector3(0, 0, 0)
    const groupOriginViewZ = groupOrigin.clone().applyMatrix4(this.camera.matrixWorldInverse).z

    transforms.forEach((transform, index) => {
      if (transform.opacity < 0.05 || visibilityRank(index) > this.visibleRatio) return
      const center = new Vector3(transform.x, transform.y, transform.z).applyEuler(this.groupEuler)
      const centerViewZ = center.clone().applyMatrix4(this.camera.matrixWorldInverse).z
      if (this.hideBackHemisphere && centerViewZ < groupOriginViewZ) return
      const projectedCenter = this.projectToScreen(center, rect)
      if (!projectedCenter) return
      const screenX = projectedCenter.x
      const screenY = projectedCenter.y
      const distance = Math.hypot(clientX - screenX, clientY - screenY)
      if (legacyRadius !== null) {
        if (distance <= legacyRadius) {
          candidates.push({ item: this.items[index], index, distance, depth: center.distanceTo(this.camera.position) })
        }
        return
      }

      const halfScale = Math.max(0, transform.scale) / 2
      const corners = billboard
        ? this.billboardCorners(center, halfScale)
        : this.surfaceCorners(center, halfScale, transform)
      if (!billboard && !isFrontFacing(corners, center, this.camera.position)) return
      const screenCorners = corners.map((corner) => this.projectToScreen(corner, rect))
      if (screenCorners.some((corner) => !corner)) return
      const quad = screenCorners as ScreenPoint[]
      if (!pointHitsQuad(clientX, clientY, quad, padding)) return
      candidates.push({ item: this.items[index], index, distance, depth: center.distanceTo(this.camera.position) })
    })

    if (!candidates.length) return null
    candidates.sort((a, b) => pickOptions.includeOccluded
      ? a.distance - b.distance || a.depth - b.depth
      : a.depth - b.depth || a.distance - b.distance)
    const { depth: _depth, ...result } = candidates[0]
    return result
  }

  autoRotate(options: { x?: number; y?: number } = {}): void {
    this.assertActive()
    if (this.reducedMotion) {
      this.rotateSpeedX = 0
      this.rotateSpeedY = 0
      return
    }
    this.rotateSpeedX = options.x ?? 0
    this.rotateSpeedY = options.y ?? 0.25
  }

  setQuality(mode: QualityMode): void {
    this.assertActive()
    this.qualityMode = mode
    const quality = mode === 'auto' ? detectQuality() : mode
    this.performanceManager = new AdaptivePerformanceManager(quality)
    if (quality !== this.quality) this.applyQuality(quality)
  }

  getQualityMode(): QualityMode {
    this.assertActive()
    return this.qualityMode
  }

  pause(): void {
    this.assertActive()
    if (this.pausedByUser) return
    this.pausedByUser = true
    this.stopRenderLoop()
  }

  resume(): void {
    this.assertActive()
    if (!this.pausedByUser) return
    this.pausedByUser = false
    this.startRenderLoop()
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
    this.frameId = 0
    this.resizeObserver.disconnect()
    this.renderer.domElement.removeEventListener('pointerup', this.handlePointerUp)
    this.renderer.domElement.removeEventListener('pointermove', this.handlePointerMove)
    this.renderer.domElement.removeEventListener('pointerleave', this.handlePointerLeave)
    this.motionQuery?.removeEventListener('change', this.handleMotionPreferenceChange)
    document.removeEventListener('visibilitychange', this.handleVisibilityChange)
    this.cards.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  getQuality(): QualityLevel {
    this.assertActive()
    return this.quality
  }

  getPerformanceStats(): StagePerformanceStats {
    this.assertActive()
    const performanceStats = this.performanceManager.getStats()
    const cardStats = this.cards.getStats()
    return {
      ...performanceStats,
      qualityMode: this.qualityMode,
      inputItems: this.inputItemCount,
      renderedItems: cardStats.instanceCount,
      visibleItems: this.activeEffect
        ? countVisibleEffectItems(this.activeEffect.gpuData.speedFactors, this.visibleRatio)
        : countVisibleItems(cardStats.instanceCount, this.visibleRatio),
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      textureBytes: cardStats.textureBytes,
      pixelRatio: this.renderer.getPixelRatio(),
      paused: this.isPaused(),
      effect: this.activeEffect?.effect.name ?? null,
      activeEffectItems: this.activeEffect
        ? countActiveEffectItems(this.activeEffect.gpuData.speedFactors)
        : 0,
    }
  }

  private context() {
    const width = this.options.container.clientWidth
    const height = this.options.container.clientHeight
    const distance = Math.abs(this.camera.position.z)
    const viewportHeight = 2 * Math.tan(this.camera.fov * Math.PI / 360) * distance
    return {
      width,
      height,
      viewportWidth: viewportHeight * (width / Math.max(1, height)),
      viewportHeight,
    }
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
    const nextQuality = this.performanceManager.recordFrame(
      rawFrameMs,
      now,
      this.qualityMode === 'auto' && this.options.adaptivePerformance !== false,
    )
    if (nextQuality) this.applyQuality(nextQuality)
    this.rotateX += this.rotateSpeedX * delta
    this.rotateY += this.rotateSpeedY * delta
    this.cards.setGroupRotation(this.rotateX, this.rotateY)
    if (this.activeEffect) {
      this.cards.setEffectTime(Math.max(0, (now - this.activeEffect.startedAt) / 1000))
    }
    this.renderer.render(this.scene, this.camera)
    if (!this.isPaused()) this.frameId = requestAnimationFrame(this.render)
  }

  private applyQuality(quality: QualityLevel): void {
    this.quality = quality
    const profile = qualityProfiles[quality]
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, profile.maxPixelRatio))
    this.cards.setVisibleRatio(visibleRatios[quality])
    this.visibleRatio = visibleRatios[quality]
    if (this.activeEffect) {
      const elapsedSeconds = Math.max(0, (performance.now() - this.activeEffect.startedAt) / 1000)
      this.activeEffect.effect.prepare(this.items.length, profile.maxActiveEffectItems)
      this.activeEffect.gpuData = this.activeEffect.effect.getGpuData()
      this.cards.enableEffect(this.activeEffect.gpuData)
      this.cards.setEffectTime(elapsedSeconds)
    }
    this.resizeInternal()
    this.options.onQualityChange?.(quality, this.performanceManager.getStats())
  }

  private readonly handleVisibilityChange = () => {
    if (this.destroyed) return
    this.pausedByVisibility = document.visibilityState === 'hidden'
    if (this.pausedByVisibility) this.stopRenderLoop()
    else this.startRenderLoop()
  }

  private startRenderLoop(): void {
    if (this.destroyed || this.isPaused() || this.frameId) return
    this.lastFrame = performance.now()
    this.frameId = requestAnimationFrame(this.render)
  }

  private stopRenderLoop(): void {
    if (!this.frameId) return
    cancelAnimationFrame(this.frameId)
    this.frameId = 0
  }

  private isPaused(): boolean {
    return this.pausedByUser || this.pausedByVisibility
  }

  private readonly handlePointerUp = (event: PointerEvent) => {
    if (this.destroyed) return
    const result = this.pick(event.clientX, event.clientY)
    if (result) this.options.onItemClick?.(result.item, result.index)
  }

  private readonly handlePointerMove = (event: PointerEvent) => {
    if (this.destroyed) return
    const result = this.pick(event.clientX, event.clientY)
    const index = result?.index ?? null
    if (index === this.hoveredIndex) return
    this.hoveredIndex = index
    this.cards.setHoverIndex(this.options.hoverEffect === 'highlight' ? index : null)
    this.options.onItemHover?.(result?.item ?? null, index)
  }

  private readonly handlePointerLeave = () => {
    if (this.destroyed || this.hoveredIndex === null) return
    this.hoveredIndex = null
    this.cards.setHoverIndex(null)
    this.options.onItemHover?.(null, null)
  }

  private readonly handleMotionPreferenceChange = (event: MediaQueryListEvent) => {
    if (this.destroyed || this.motionPreference !== 'auto') return
    this.reducedMotion = event.matches
    if (!this.reducedMotion) return
    this.stopRotation()
    if (!this.activeEffect) return
    this.transforms = this.activeEffect.effect.calculateTransforms(this.items.length, 0)
    this.activeEffect = null
    this.cards.disableEffect()
    this.cards.setTransforms(this.transforms)
  }

  private assertActive(): void {
    if (this.destroyed) throw new Error('MotionStage has been destroyed')
  }

  private projectToScreen(point: Vector3, rect: DOMRect): ScreenPoint | null {
    this.projectionVector.copy(point).project(this.camera)
    if (this.projectionVector.z < -1 || this.projectionVector.z > 1) return null
    return {
      x: rect.left + (this.projectionVector.x + 1) * rect.width / 2,
      y: rect.top + (1 - this.projectionVector.y) * rect.height / 2,
    }
  }

  private billboardCorners(center: Vector3, halfScale: number): Vector3[] {
    const right = new Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion)
    const up = new Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion)
    return [
      center.clone().addScaledVector(right, -halfScale).addScaledVector(up, -halfScale),
      center.clone().addScaledVector(right, halfScale).addScaledVector(up, -halfScale),
      center.clone().addScaledVector(right, halfScale).addScaledVector(up, halfScale),
      center.clone().addScaledVector(right, -halfScale).addScaledVector(up, halfScale),
    ]
  }

  private surfaceCorners(center: Vector3, halfScale: number, transform: Transform): Vector3[] {
    const itemEuler = new Euler(transform.rotationX, transform.rotationY, transform.rotationZ, 'XYZ')
    return [
      [-halfScale, -halfScale],
      [halfScale, -halfScale],
      [halfScale, halfScale],
      [-halfScale, halfScale],
    ].map(([x, y]) => new Vector3(x, y, 0)
      .applyEuler(itemEuler)
      .applyEuler(this.groupEuler)
      .add(center))
  }
}

interface ScreenPoint {
  x: number
  y: number
}

function isFrontFacing(corners: Vector3[], center: Vector3, cameraPosition: Vector3): boolean {
  const edgeA = corners[1].clone().sub(corners[0])
  const edgeB = corners[3].clone().sub(corners[0])
  const normal = edgeA.cross(edgeB)
  return normal.dot(cameraPosition.clone().sub(center)) > 0
}

function pointHitsQuad(x: number, y: number, corners: ScreenPoint[], padding: number): boolean {
  let hasPositive = false
  let hasNegative = false
  for (let index = 0; index < corners.length; index += 1) {
    const start = corners[index]
    const end = corners[(index + 1) % corners.length]
    const cross = (end.x - start.x) * (y - start.y) - (end.y - start.y) * (x - start.x)
    hasPositive ||= cross > 0
    hasNegative ||= cross < 0
  }
  if (!(hasPositive && hasNegative)) return true
  if (!padding) return false
  return corners.some((start, index) =>
    distanceToSegment(x, y, start, corners[(index + 1) % corners.length]) <= padding,
  )
}

function distanceToSegment(x: number, y: number, start: ScreenPoint, end: ScreenPoint): number {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy
  if (!lengthSquared) return Math.hypot(x - start.x, y - start.y)
  const amount = Math.min(1, Math.max(0, ((x - start.x) * dx + (y - start.y) * dy) / lengthSquared))
  return Math.hypot(x - (start.x + amount * dx), y - (start.y + amount * dy))
}

function visibilityRank(index: number): number {
  return (index * 0.618033988749895) % 1
}

function countVisibleItems(count: number, ratio: number): number {
  let visible = 0
  for (let index = 0; index < count; index += 1) {
    if (visibilityRank(index) <= ratio) visible += 1
  }
  return visible
}

function countActiveEffectItems(speedFactors: Float32Array): number {
  let active = 0
  speedFactors.forEach((speed) => {
    if (speed >= 0) active += 1
  })
  return active
}

function countVisibleEffectItems(speedFactors: Float32Array, ratio: number): number {
  let visible = 0
  speedFactors.forEach((speed, index) => {
    if (speed >= 0 && visibilityRank(index) <= ratio) visible += 1
  })
  return visible
}

function validateItems(items: MotionItem[]): void {
  const ids = new Set<string>()
  items.forEach((item, index) => {
    if (!item.id.trim()) throw new Error(`MotionItem at index ${index} must have a non-empty id`)
    if (ids.has(item.id)) throw new Error(`Duplicate MotionItem id: ${item.id}`)
    ids.add(item.id)
  })
}

function validateItemUpdates(updates: MotionItemUpdate[]): void {
  const ids = new Set<string>()
  updates.forEach(({ id }, index) => {
    if (!id.trim()) throw new Error(`MotionItem update at index ${index} must have a non-empty id`)
    if (ids.has(id)) throw new Error(`Duplicate MotionItem update id: ${id}`)
    ids.add(id)
  })
}
