import {
  Group,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
  type Material,
  type Object3D,
  type Texture,
} from 'three'
import type {
  Layout,
  MotionItem,
  QualityLevel,
  Transform,
  TransitionOptions,
} from './types.js'
import { easing, identityTransform } from './math.js'
import {
  type MotionRenderer,
  type MotionRendererFactory,
  type MotionRendererStats,
  type MotionRendererVisualState,
} from '../renderers/MotionRenderer.js'
import { detectQuality, qualityProfiles } from '../performance/quality.js'
import {
  AdaptivePerformanceManager,
  type PerformanceStats,
} from '../performance/AdaptivePerformanceManager.js'
import { Timeline } from './Timeline.js'
import type {
  StageExtension,
  StageExtensionHandle,
  StageExtensionStats,
  StageViewport,
} from './extensions.js'
import type { StreamingEffect, StreamingEffectGpuData } from '../effects/types.js'
import {
  InteractionController,
  visibilityRank,
} from './InteractionController.js'
import { ItemCoordinator } from './ItemCoordinator.js'
import { MotionController } from './MotionController.js'
import { ExtensionHost } from './ExtensionHost.js'

export interface MotionStageOptions<TMeta = unknown> {
  container: HTMLElement
  items?: readonly MotionItem<TMeta>[]
  renderer: MotionRendererFactory<TMeta>
  quality?: QualityLevel | 'auto'
  cameraZ?: number
  adaptivePerformance?: boolean
  onQualityChange?: (quality: QualityLevel, stats: PerformanceStats) => void
  onItemClick?: (item: MotionItem<TMeta>, index: number) => void
  motionPreference?: MotionPreference
  onItemHover?: (item: MotionItem<TMeta> | null, index: number | null) => void
  onItemFocus?: (item: MotionItem<TMeta> | null, index: number | null) => void
  hoverEffect?: 'none' | 'highlight'
  keyboardNavigation?: boolean
  ariaLabel?: string
  /** Defaults used when an individual transition omits duration or easing. */
  transition?: TransitionOptions
  onContextChange?: (state: 'lost' | 'restored') => void
  onExtensionError?: (error: unknown, extension: StageExtension) => void
}

export interface UpdateItemsOptions extends TransitionOptions {
  layout?: Layout
}

export type MotionItemPatch<TMeta = unknown> = Partial<Omit<MotionItem<TMeta>, 'id'>>

export interface MotionItemUpdate<TMeta = unknown> {
  id: string
  patch: MotionItemPatch<TMeta>
}

export interface FocusItemsOptions extends TransitionOptions {
  columns?: number
  gap?: number
  scale?: number
  z?: number
  dimOpacity?: number
}

export interface PickResult<TMeta = unknown> {
  item: MotionItem<TMeta>
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
export type StageTransitionStatus = 'running' | 'completed' | 'interrupted' | 'aborted' | 'destroyed'

export interface StageTransitionResult {
  completed: boolean
  status: Exclude<StageTransitionStatus, 'running'>
}

export interface StageTransitionHandle {
  readonly status: StageTransitionStatus
  readonly finished: Promise<StageTransitionResult>
  cancel(): void
}

export interface StageTransitionState {
  active: boolean
  status: StageTransitionStatus | null
  layout: string | null
  progress: number
}

export interface StagePerformanceStats extends PerformanceStats {
  qualityMode: QualityMode
  inputItems: number
  visibleItems: number
  render: Readonly<{
    drawCalls: number
    triangles: number
  }>
  renderer: Readonly<{
    instanceCount: number
    submittedInstanceCount: number
    gpuBytes: number
    metrics: Readonly<Record<string, number>>
  }>
  pixelRatio: number
  paused: boolean
  effect: string | null
  activeEffectItems: number
  contextLost: boolean
  frameCpuMs: number
  renderSubmitMs: number
  transformCalculationMs: number
  transformCalculations: number
  pickingMs: number
  pickOperations: number
  extensions: number
  extensionUpdateMs: number
}

export interface StagePerformanceEnvironment {
  userAgent: string
  platform: string
  logicalCores: number | null
  deviceMemoryGb: number | null
  viewportWidth: number
  viewportHeight: number
  devicePixelRatio: number
  pixelRatio: number
  maxTextureSize: number
  webglVersion: string
  gpuVendor: string | null
  gpuRenderer: string | null
}

interface ActiveEffect {
  effect: StreamingEffect
  gpuData: StreamingEffectGpuData
  elapsedSeconds: number
  lastUpdatedAt: number
}

export class MotionStage<TMeta = unknown> {
  readonly ready: Promise<void>
  private readonly scene = new Scene()
  private readonly camera: PerspectiveCamera
  private readonly renderer: WebGLRenderer
  private readonly contentRoot: Group
  private readonly contentRenderer: MotionRenderer<TMeta>
  private readonly interaction: InteractionController<TMeta>
  private readonly itemCoordinator: ItemCoordinator<TMeta>
  private readonly motionController = new MotionController()
  private readonly extensionHost: ExtensionHost
  private readonly contentAbortController = new AbortController()
  private readonly itemWidth: number
  private readonly itemHeight: number
  private readonly resizeObserver: ResizeObserver
  private items: MotionItem<TMeta>[] = []
  private sourceItems: MotionItem<TMeta>[] = []
  private transforms: Transform[] = []
  private frameId = 0
  private lastFrame = 0
  private rotateX = 0
  private rotateY = 0
  private rotateSpeedX = 0
  private rotateSpeedY = 0
  private activeEffect: ActiveEffect | null = null
  private quality: QualityLevel
  private performanceManager: AdaptivePerformanceManager
  private qualityMode: QualityMode
  private lastLayout: Layout | null = null
  private visibleRatio = 1
  private currentOrientation: 'surface' | 'camera' = 'surface'
  private hideBackHemisphere = false
  private hemisphereEdgeFade = 0
  private inputItemCount = 0
  private destroyed = false
  private pausedByUser = false
  private pausedByVisibility = document.visibilityState === 'hidden'
  private pausedByContext = false
  private readonly motionPreference: MotionPreference
  private readonly motionQuery: MediaQueryList | null
  private reducedMotion = false
  private readonly stageWaits = new Set<{
    remainingMs: number
    complete: (result?: boolean) => void
  }>()
  private frameCpuMs = 0
  private renderSubmitMs = 0
  private transformCalculationMs = 0
  private transformCalculations = 0

  constructor(private readonly options: MotionStageOptions<TMeta>) {
    if (typeof options.renderer !== 'function') {
      throw new TypeError('MotionStage renderer must be a renderer factory')
    }
    this.itemCoordinator = new ItemCoordinator({
      applyPatches: (updates) => this.updateItemsByIdInternal(updates, {}),
      isDestroyed: () => this.destroyed,
    })
    if (options.items) this.itemCoordinator.validateItems(options.items)
    this.motionPreference = options.motionPreference ?? 'auto'
    this.motionQuery = typeof matchMedia === 'function'
      ? matchMedia('(prefers-reduced-motion: reduce)')
      : null
    this.reducedMotion = this.motionPreference === 'reduced'
      || (this.motionPreference === 'auto' && Boolean(this.motionQuery?.matches))
    const hoverEnabled = Boolean(options.onItemHover) || options.hoverEffect === 'highlight'
    const keyboardNavigation = options.keyboardNavigation !== false
    const baseAriaLabel = options.ariaLabel ?? 'Spatial Motion'
    this.qualityMode = options.quality ?? 'auto'
    this.quality = this.qualityMode === 'auto' ? detectQuality() : this.qualityMode
    this.performanceManager = new AdaptivePerformanceManager(this.quality)
    const profile = qualityProfiles[this.quality]
    this.camera = new PerspectiveCamera(45, 1, 0.1, 100)
    this.camera.position.z = options.cameraZ ?? 18
    this.renderer = new WebGLRenderer({ alpha: true, antialias: profile.antialias, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, profile.maxPixelRatio))
    const canvas = this.renderer.domElement
    canvas.style.width = canvas.style.height = '100%'
    this.options.container.appendChild(canvas)
    canvas.addEventListener('webglcontextlost', this.handleContextLost)
    canvas.addEventListener('webglcontextrestored', this.handleContextRestored)
    if (this.motionPreference === 'auto') {
      this.motionQuery?.addEventListener('change', this.handleMotionPreferenceChange)
    }
    document.addEventListener('visibilitychange', this.handleVisibilityChange)
    this.contentRoot = new Group()
    this.contentRoot.name = 'SpatialMotionContent'
    this.scene.add(this.contentRoot)
    let contentRenderer: MotionRenderer<TMeta> | null = null
    try {
      contentRenderer = options.renderer({
        root: this.contentRoot,
        maxTextureSize: this.renderer.capabilities.maxTextureSize,
        maxAnisotropy: this.renderer.capabilities.getMaxAnisotropy(),
        signal: this.contentAbortController.signal,
      })
      assertMotionRenderer(contentRenderer)
    } catch (error) {
      contentRenderer?.dispose?.()
      this.contentAbortController.abort()
      disposeObjectResources(this.contentRoot)
      this.scene.remove(this.contentRoot)
      this.cleanupCanvasAndListeners()
      this.renderer.dispose()
      this.renderer.domElement.remove()
      throw error
    }
    this.contentRenderer = contentRenderer
    const itemBounds = contentRenderer.descriptor.itemBounds
    this.itemWidth = itemBounds
      ? itemBounds.kind === 'disc' ? itemBounds.diameter : itemBounds.width
      : 1
    this.itemHeight = itemBounds
      ? itemBounds.kind === 'disc' ? itemBounds.diameter : itemBounds.height
      : 1
    this.interaction = new InteractionController({
      element: canvas,
      camera: this.camera,
      itemBounds,
      hoverEnabled,
      hoverEffect: options.hoverEffect ?? 'none',
      keyboardNavigation,
      ariaLabel: baseAriaLabel,
      getState: () => ({
        items: this.items,
        visibleRatio: this.visibleRatio,
        rotationX: this.rotateX,
        rotationY: this.rotateY,
        orientation: this.currentOrientation,
        hideBackHemisphere: this.hideBackHemisphere,
        effectActive: Boolean(this.activeEffect),
      }),
      resolveTransforms: (now) => this.resolveCurrentTransforms(now),
      hasScheduledFrame: () => Boolean(this.frameId),
      isDestroyed: () => this.destroyed,
      setHighlightIndex: (index) =>
        this.contentRenderer.capabilities.highlight?.setHighlightIndex(index),
      onItemClick: options.onItemClick,
      onItemHover: options.onItemHover,
      onItemFocus: options.onItemFocus,
    })
    this.extensionHost = new ExtensionHost({
      parent: this.scene,
      camera: this.camera,
      getViewport: () => this.extensionViewport(),
      getQuality: () => this.quality,
      getReducedMotion: () => this.reducedMotion,
      isPaused: () => this.isPaused(),
      isDestroyed: () => this.destroyed,
      onError: options.onExtensionError,
    })
    this.resizeObserver = new ResizeObserver(() => {
      if (!this.destroyed) this.resizeInternal()
    })
    this.resizeObserver.observe(this.options.container)
    this.resizeInternal()
    if (!this.isPaused()) {
      this.lastFrame = performance.now()
      this.frameId = requestAnimationFrame(this.render)
    }
    this.ready = options.items ? this.setItemsInternal(options.items) : Promise.resolve()
  }

  setItems(items: readonly MotionItem<TMeta>[]): Promise<void> {
    this.assertActive()
    this.itemCoordinator.validateItems(items)
    return this.setItemsAfterPendingUpdates(items)
  }

  private async setItemsAfterPendingUpdates(items: readonly MotionItem<TMeta>[]): Promise<void> {
    await this.itemCoordinator.flushPatches()
    return this.setItemsInternal(items)
  }

  private async setItemsInternal(items: readonly MotionItem<TMeta>[]): Promise<void> {
    const revision = this.itemCoordinator.beginOperation()
    this.motionController.cancel('interrupted')
    this.activeEffect = null
    this.contentRenderer.capabilities.streamingEffects?.disable()
    const maxItems = qualityProfiles[this.quality].maxVisibleItems
    const prepared = this.itemCoordinator.prepareItems(items, maxItems)
    const nextItems = prepared.visibleItems
    const nextTransforms = nextItems.map(identityTransform)
    const applied = await this.contentRenderer.setItems(nextItems)
    if (!applied || !this.itemCoordinator.isCurrent(revision)) return
    this.items = nextItems
    this.sourceItems = prepared.sourceItems
    this.inputItemCount = prepared.sourceItems.length
    this.transforms = nextTransforms
    this.contentRenderer.capabilities.visual?.setVisualState(this.currentRendererVisualState())
    this.contentRenderer.setTransforms(nextTransforms)
    this.visibleRatio = 1
    this.contentRenderer.setVisibleRatio(this.visibleRatio)
    this.interaction.syncItems()
  }

  to(layout: Layout, options: TransitionOptions = {}): Promise<boolean> {
    this.assertActive()
    return this.toInternal(layout, options)
  }

  startTransition(layout: Layout, options: TransitionOptions = {}): StageTransitionHandle {
    this.assertActive()
    const controller = new AbortController()
    const forwardAbort = () => controller.abort()
    if (options.signal?.aborted) controller.abort()
    else options.signal?.addEventListener('abort', forwardAbort, { once: true })
    const state: { status: StageTransitionStatus } = { status: 'running' }
    const finished = this.transitionToResult(layout, { ...options, signal: controller.signal })
      .then((result) => {
        state.status = result.status
        if (result.completed) this.lastLayout = layout
        return result
      })
      .finally(() => options.signal?.removeEventListener('abort', forwardAbort))
    return {
      get status() { return state.status },
      finished,
      cancel: () => controller.abort(),
    }
  }

  getTransitionState(): StageTransitionState {
    this.assertActive()
    return this.motionController.getState(performance.now(), this.isPaused())
  }

  private async toInternal(layout: Layout, options: TransitionOptions): Promise<boolean> {
    const completed = await this.transitionTo(layout, options)
    if (completed) this.lastLayout = layout
    return completed
  }

  private async transitionTo(layout: Layout, options: TransitionOptions = {}): Promise<boolean> {
    return (await this.transitionToResult(layout, options)).completed
  }

  private transitionToResult(
    layout: Layout,
    options: TransitionOptions = {},
  ): Promise<StageTransitionResult> {
    if (options.signal?.aborted) {
      return Promise.resolve(this.motionController.settle(layout.name, 'aborted'))
    }
    const now = performance.now()
    const visualState = this.resolveCurrentVisualState(now)
    this.transforms = this.resolveCurrentTransforms(now)
    if (this.activeEffect) {
      this.activeEffect = null
      this.contentRenderer.capabilities.streamingEffects?.disable()
    }
    this.motionController.cancel('interrupted')
    const from = this.transforms
    const calculationStartedAt = performance.now()
    const target = [...layout.calculate(this.items.length, this.context())]
    this.transformCalculationMs += performance.now() - calculationStartedAt
    this.transformCalculations += 1
    const targetOrientation = layout.orientation ?? 'surface'
    const targetHideBackHemisphere = layout.hideBackHemisphere ?? false
    const targetHemisphereEdgeFade = layout.hemisphereEdgeFade ?? 0
    const targetBillboard = targetOrientation === 'camera' ? 1 : 0
    const targetHideBack = targetHideBackHemisphere ? 1 : 0
    this.currentOrientation = targetOrientation
    this.hideBackHemisphere = targetHideBackHemisphere
    this.hemisphereEdgeFade = targetHemisphereEdgeFade
    const duration = this.reducedMotion
      ? 0
      : Math.max(0, options.duration ?? this.options.transition?.duration ?? 1200)
    const ease = options.easing ?? this.options.transition?.easing ?? easing.sineInOut
    if (duration === 0) {
      this.transforms = target
      this.contentRenderer.capabilities.visual?.setVisualState({
        billboard: targetBillboard,
        hideBackHemisphere: targetHideBack,
        hemisphereEdgeFade: targetHemisphereEdgeFade,
      })
      this.contentRenderer.setTransforms(target)
      return Promise.resolve(this.motionController.settle(layout.name, 'completed'))
    }
    this.contentRenderer.prepareTransition(from, target)
    this.contentRenderer.capabilities.visual?.prepareVisualTransition(visualState, {
      billboard: targetBillboard,
      hideBackHemisphere: targetHideBack,
      hemisphereEdgeFade: targetHemisphereEdgeFade,
    })
    return this.motionController.start({
      from,
      to: target,
      fromVisual: visualState,
      toVisual: {
        billboard: targetBillboard,
        hideBackHemisphere: targetHideBack,
        hemisphereEdgeFade: targetHemisphereEdgeFade,
      },
      targetLayout: layout,
      duration,
      easing: ease,
      now,
      signal: options.signal,
    })
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
        hemisphereEdgeFade: 0,
        calculate: () => target,
      },
      options,
    )
    if (!entered) return false
    if (this.reducedMotion) {
      this.transforms = target
      this.contentRenderer.setTransforms(target)
      return true
    }
    const streamingEffects = this.contentRenderer.capabilities.streamingEffects
    if (!streamingEffects) {
      this.transforms = target
      this.contentRenderer.setTransforms(target)
      return true
    }
    const gpuData = effect.getGpuData()
    streamingEffects.enable(gpuData)
    this.activeEffect = { effect, gpuData, elapsedSeconds: 0, lastUpdatedAt: performance.now() }
    return true
  }

  updateItems(
    items: readonly MotionItem<TMeta>[],
    options: UpdateItemsOptions = {},
  ): Promise<boolean> {
    this.assertActive()
    this.itemCoordinator.validateItems(items)
    return this.updateItemsAfterPendingUpdates(items, options)
  }

  private async updateItemsAfterPendingUpdates(
    items: readonly MotionItem<TMeta>[],
    options: UpdateItemsOptions,
  ): Promise<boolean> {
    await this.itemCoordinator.flushPatches()
    return this.updateItemsInternal(items, options)
  }

  updateItem(
    id: string,
    patch: MotionItemPatch<TMeta>,
    options: UpdateItemsOptions = {},
  ): Promise<boolean> {
    return this.updateItemsById([{ id, patch }], options)
  }

  updateItemsById(
    updates: MotionItemUpdate<TMeta>[],
    options: UpdateItemsOptions = {},
  ): Promise<boolean> {
    this.assertActive()
    this.itemCoordinator.validateUpdates(updates)
    if (!updates.length) return Promise.resolve(true)
    if (!isBatchableItemUpdate(options)) {
      return this.updateItemsByIdAfterPendingUpdates(updates, options)
    }
    return this.itemCoordinator.queuePatches(updates)
  }

  private async updateItemsByIdAfterPendingUpdates(
    updates: MotionItemUpdate<TMeta>[],
    options: UpdateItemsOptions,
  ): Promise<boolean> {
    await this.itemCoordinator.flushPatches()
    return this.updateItemsByIdInternal(updates, options)
  }

  private async updateItemsByIdInternal(
    updates: MotionItemUpdate<TMeta>[],
    options: UpdateItemsOptions,
  ): Promise<boolean> {
    if (!updates.length) return true
    const maxItems = qualityProfiles[this.quality].maxVisibleItems
    const prepared = this.itemCoordinator.preparePatch(this.sourceItems, updates, maxItems)
    const nextItems = prepared.visibleItems
    const revision = this.itemCoordinator.beginOperation()
    const patch = this.contentRenderer.capabilities.patch
    const applied = patch
      ? await patch.updateItems(nextItems, prepared.changedIndices)
      : await this.contentRenderer.setItems(nextItems)
    if (!applied || !this.itemCoordinator.isCurrent(revision)) return false
    this.sourceItems = prepared.sourceItems
    this.items = nextItems
    this.inputItemCount = prepared.sourceItems.length
    this.visibleRatio = 1
    if (!patch) this.restoreRendererStateAfterItems()
    this.contentRenderer.setVisibleRatio(this.visibleRatio)
    this.interaction.syncItems()

    if (!options.layout) return true
    const completed = await this.transitionTo(options.layout, {
      duration: options.duration ?? 800,
      easing: options.easing,
    })
    if (completed) this.lastLayout = options.layout
    return completed
  }

  private async updateItemsInternal(
    items: readonly MotionItem<TMeta>[],
    options: UpdateItemsOptions,
    preserveEffect = false,
  ): Promise<boolean> {
    const now = performance.now()
    const current = this.resolveCurrentTransforms(now)
    const previousById = new Map(this.items.map((item, index) => [item.id, current[index]]))
    const currentEffect = preserveEffect ? this.activeEffect : null
    const revision = this.itemCoordinator.beginOperation()
    this.motionController.cancel('interrupted')
    if (!preserveEffect) {
      this.activeEffect = null
      this.contentRenderer.capabilities.streamingEffects?.disable()
    }
    this.transforms = current
    this.contentRenderer.setTransforms(current)

    const maxItems = qualityProfiles[this.quality].maxVisibleItems
    const prepared = this.itemCoordinator.prepareItems(items, maxItems)
    const nextItems = prepared.visibleItems
    const nextTransforms = nextItems.map((item) => {
      const previous = previousById.get(item.id)
      return previous ? { ...previous } : identityTransform()
    })
    const applied = await this.contentRenderer.setItems(nextItems)
    if (!applied || !this.itemCoordinator.isCurrent(revision)) return false
    this.items = nextItems
    this.sourceItems = prepared.sourceItems
    this.inputItemCount = prepared.sourceItems.length
    this.transforms = nextTransforms
    this.contentRenderer.capabilities.visual?.setVisualState(this.currentRendererVisualState())
    this.contentRenderer.setTransforms(nextTransforms)
    this.visibleRatio = 1
    this.contentRenderer.setVisibleRatio(this.visibleRatio)
    this.interaction.syncItems()

    const targetLayout = options.layout ?? this.lastLayout
    if (currentEffect && this.activeEffect === currentEffect) {
      if (targetLayout) {
        this.transforms = [...targetLayout.calculate(this.items.length, this.context())]
        this.contentRenderer.setTransforms(this.transforms)
        if (options.layout) this.lastLayout = options.layout
      }
      const profile = qualityProfiles[this.quality]
      currentEffect.effect.prepare(this.items.length, profile.maxActiveEffectItems)
      currentEffect.gpuData = currentEffect.effect.getGpuData()
      this.contentRenderer.capabilities.streamingEffects?.enable(currentEffect.gpuData)
      this.contentRenderer.capabilities.streamingEffects?.setTime(currentEffect.elapsedSeconds)
      return true
    }
    if (!targetLayout) return true
    const completed = await this.transitionTo(targetLayout, {
      duration: options.duration ?? 800,
      easing: options.easing,
    })
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

  pick(
    clientX: number,
    clientY: number,
    options: number | PickOptions = {},
  ): PickResult<TMeta> | null {
    this.assertActive()
    return this.interaction.pick(clientX, clientY, options)
  }

  focusItem(id: string): boolean {
    this.assertActive()
    return this.interaction.focusItem(id)
  }

  getFocusedItem(): MotionItem<TMeta> | null {
    this.assertActive()
    return this.interaction.getFocusedItem()
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
    this.contentRoot.rotation.set(x, y, 0)
  }

  timeline(): Timeline {
    this.assertActive()
    return new Timeline((duration) => this.waitOnStageClock(duration))
  }

  async addExtension(extension: StageExtension): Promise<StageExtensionHandle> {
    this.assertActive()
    return this.extensionHost.add(extension)
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
    if (
      this.lastLayout
      && this.items.length
      && !this.motionController.hasActiveTransition()
      && !this.activeEffect
    ) {
      this.transforms = [...this.lastLayout.calculate(this.items.length, this.context())]
      this.contentRenderer.setTransforms(this.transforms)
    }
    const viewport = this.extensionViewport()
    this.contentRenderer.capabilities.viewport?.resize(viewport)
    this.extensionHost.resize(viewport)
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.itemCoordinator.invalidate()
    this.motionController.cancel('destroyed')
    cancelAnimationFrame(this.frameId)
    this.frameId = 0
    this.resizeObserver.disconnect()
    this.cleanupCanvasAndListeners()
    for (const wait of this.stageWaits) wait.complete(false)
    this.stageWaits.clear()
    this.extensionHost.dispose()
    this.contentAbortController.abort()
    this.contentRenderer.dispose()
    this.scene.remove(this.contentRoot)
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  private cleanupCanvasAndListeners(): void {
    this.interaction?.dispose()
    this.renderer.domElement.removeEventListener('webglcontextlost', this.handleContextLost)
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.handleContextRestored)
    this.motionQuery?.removeEventListener('change', this.handleMotionPreferenceChange)
    document.removeEventListener('visibilitychange', this.handleVisibilityChange)
  }

  getQuality(): QualityLevel {
    this.assertActive()
    return this.quality
  }

  getPerformanceStats(): StagePerformanceStats {
    this.assertActive()
    const performanceStats = this.performanceManager.getStats()
    const rendererStats = normalizeRendererStats(this.contentRenderer.getStats())
    const interactionStats = this.interaction.getStats()
    return {
      ...performanceStats,
      qualityMode: this.qualityMode,
      inputItems: this.inputItemCount,
      visibleItems: this.activeEffect
        ? countVisibleEffectItems(this.activeEffect.gpuData.speedFactors, this.visibleRatio)
        : countVisibleItems(rendererStats.instanceCount, this.visibleRatio),
      render: Object.freeze({
        drawCalls: this.renderer.info.render.calls,
        triangles: this.renderer.info.render.triangles,
      }),
      renderer: Object.freeze(rendererStats),
      pixelRatio: this.renderer.getPixelRatio(),
      paused: this.isPaused(),
      effect: this.activeEffect?.effect.name ?? null,
      activeEffectItems: this.activeEffect
        ? countActiveEffectItems(this.activeEffect.gpuData.speedFactors)
        : 0,
      contextLost: this.pausedByContext,
      frameCpuMs: this.frameCpuMs,
      renderSubmitMs: this.renderSubmitMs,
      transformCalculationMs: this.transformCalculationMs,
      transformCalculations: this.transformCalculations,
      pickingMs: interactionStats.pickingMs,
      pickOperations: interactionStats.pickOperations,
      extensions: this.extensionHost.getCount(),
      extensionUpdateMs: this.extensionHost.getUpdateDuration(),
    }
  }

  getExtensionStats(): StageExtensionStats[] {
    this.assertActive()
    return this.extensionHost.getStats()
  }

  getPerformanceEnvironment(): StagePerformanceEnvironment {
    this.assertActive()
    const context = this.renderer.getContext()
    const debugInfo = context.getExtension('WEBGL_debug_renderer_info') as {
      UNMASKED_VENDOR_WEBGL: number
      UNMASKED_RENDERER_WEBGL: number
    } | null
    const browserNavigator = typeof navigator === 'undefined'
      ? null
      : navigator as Navigator & { deviceMemory?: number }
    return {
      userAgent: browserNavigator?.userAgent ?? '',
      platform: browserNavigator?.platform ?? '',
      logicalCores: Number.isFinite(browserNavigator?.hardwareConcurrency)
        ? browserNavigator?.hardwareConcurrency ?? null
        : null,
      deviceMemoryGb: Number.isFinite(browserNavigator?.deviceMemory)
        ? browserNavigator?.deviceMemory ?? null
        : null,
      viewportWidth: this.options.container.clientWidth,
      viewportHeight: this.options.container.clientHeight,
      devicePixelRatio: typeof devicePixelRatio === 'number' ? devicePixelRatio : 1,
      pixelRatio: this.renderer.getPixelRatio(),
      maxTextureSize: this.renderer.capabilities.maxTextureSize,
      webglVersion: String(context.getParameter(context.VERSION) ?? ''),
      gpuVendor: debugInfo ? String(context.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) ?? '') : null,
      gpuRenderer: debugInfo ? String(context.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) ?? '') : null,
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
      itemWidth: this.itemWidth,
      itemHeight: this.itemHeight,
    }
  }

  private resolveCurrentTransforms(now: number): Transform[] {
    if (this.activeEffect) {
      return this.activeEffect.effect.calculateTransforms(
        this.items.length,
        this.effectElapsedSeconds(this.activeEffect, now),
      )
    }
    return this.motionController.resolveTransforms(this.transforms, now, this.isPaused())
  }

  private resolveCurrentVisualState(now: number): MotionRendererVisualState {
    if (this.activeEffect) return { billboard: 1, hideBackHemisphere: 0, hemisphereEdgeFade: 0 }
    return this.motionController.resolveVisualState(
      this.currentRendererVisualState(),
      now,
      this.isPaused(),
    )
  }

  private currentRendererVisualState(): MotionRendererVisualState {
    return {
      billboard: this.currentOrientation === 'camera' ? 1 : 0,
      hideBackHemisphere: this.hideBackHemisphere ? 1 : 0,
      hemisphereEdgeFade: this.hemisphereEdgeFade,
    }
  }

  private restoreRendererStateAfterItems(): void {
    const visual = this.contentRenderer.capabilities.visual
    const transition = this.motionController.getSnapshot(performance.now(), this.isPaused())
    if (transition) {
      this.contentRenderer.prepareTransition(transition.from, transition.to)
      visual?.prepareVisualTransition(transition.fromVisual, transition.toVisual)
      this.contentRenderer.setProgress(transition.progress)
    } else {
      visual?.setVisualState(this.currentRendererVisualState())
      this.contentRenderer.setTransforms(this.transforms)
    }
    this.contentRenderer.setVisibleRatio(this.visibleRatio)
    this.interaction.refreshHighlight()
    if (this.activeEffect) {
      const streaming = this.contentRenderer.capabilities.streamingEffects
      streaming?.enable(this.activeEffect.gpuData)
      streaming?.setTime(this.activeEffect.elapsedSeconds)
    }
  }

  private effectElapsedSeconds(effect: ActiveEffect, now: number): number {
    const pendingSeconds = this.isPaused() ? 0 : Math.max(0, now - effect.lastUpdatedAt) / 1000
    return effect.elapsedSeconds + pendingSeconds
  }

  private readonly render = (now: number) => {
    const frameCpuStartedAt = performance.now()
    const rawFrameMs = now - this.lastFrame || 0
    const delta = Math.min(0.05, rawFrameMs / 1000)
    this.lastFrame = now
    this.advanceStageWaits(rawFrameMs)
    const completedTransforms = this.motionController.advance(
      now,
      (progress) => this.contentRenderer.setProgress(progress),
    )
    if (completedTransforms) this.transforms = completedTransforms
    const nextQuality = this.performanceManager.recordFrame(
      rawFrameMs,
      now,
      this.qualityMode === 'auto' && this.options.adaptivePerformance !== false,
    )
    if (nextQuality) this.applyQuality(nextQuality)
    this.rotateX += this.rotateSpeedX * delta
    this.rotateY += this.rotateSpeedY * delta
    this.contentRoot.rotation.set(this.rotateX, this.rotateY, 0)
    if (this.activeEffect) {
      this.activeEffect.elapsedSeconds += Math.max(0, now - this.activeEffect.lastUpdatedAt) / 1000
      this.activeEffect.lastUpdatedAt = now
      this.contentRenderer.capabilities.streamingEffects?.setTime(this.activeEffect.elapsedSeconds)
    }
    this.interaction.flushPendingPointerMove()
    this.extensionHost.update(delta)
    this.frameCpuMs = performance.now() - frameCpuStartedAt
    const renderStartedAt = performance.now()
    this.renderer.render(this.scene, this.camera)
    this.renderSubmitMs = performance.now() - renderStartedAt
    if (!this.isPaused()) this.frameId = requestAnimationFrame(this.render)
  }

  private applyQuality(quality: QualityLevel): void {
    const targetLayout = this.motionController.getTargetLayout() ?? this.lastLayout
    this.quality = quality
    const profile = qualityProfiles[quality]
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, profile.maxPixelRatio))
    const targetCount = Math.min(this.sourceItems.length, profile.maxVisibleItems)
    this.visibleRatio = this.items.length
      ? Math.min(1, targetCount / this.items.length)
      : 1
    this.contentRenderer.setVisibleRatio(this.visibleRatio)
    this.interaction.syncItems()
    if (this.activeEffect) {
      const now = performance.now()
      this.activeEffect.elapsedSeconds = this.effectElapsedSeconds(this.activeEffect, now)
      this.activeEffect.lastUpdatedAt = now
      this.activeEffect.effect.prepare(this.items.length, profile.maxActiveEffectItems)
      this.activeEffect.gpuData = this.activeEffect.effect.getGpuData()
      this.contentRenderer.capabilities.streamingEffects?.enable(this.activeEffect.gpuData)
      this.contentRenderer.capabilities.streamingEffects?.setTime(this.activeEffect.elapsedSeconds)
    }
    this.extensionHost.qualityChange(quality)
    this.resizeInternal()
    this.options.onQualityChange?.(quality, this.performanceManager.getStats())
    if (this.sourceItems.length) {
      void this.updateItemsInternal(this.sourceItems, {
        layout: targetLayout ?? undefined,
        duration: 0,
      }, true).catch((error) => console.error('Spatial Motion quality reconciliation failed', error))
    }
  }

  private readonly handleVisibilityChange = () => {
    if (this.destroyed) return
    this.pausedByVisibility = document.visibilityState === 'hidden'
    if (this.pausedByVisibility) this.stopRenderLoop()
    else this.startRenderLoop()
  }

  private startRenderLoop(): void {
    if (this.destroyed || this.isPaused() || this.frameId) return
    this.extensionHost.setPaused(false)
    const now = performance.now()
    this.lastFrame = now
    this.motionController.rebaseClock(now)
    if (this.activeEffect) this.activeEffect.lastUpdatedAt = now
    this.frameId = requestAnimationFrame(this.render)
  }

  private stopRenderLoop(): void {
    this.extensionHost.setPaused(true)
    if (!this.frameId) return
    cancelAnimationFrame(this.frameId)
    this.frameId = 0
  }

  private isPaused(): boolean {
    return this.pausedByUser || this.pausedByVisibility || this.pausedByContext
  }

  private waitOnStageClock(duration: number): {
    promise: Promise<boolean | void>
    cancel: () => void
  } {
    this.assertActive()
    let settled = false
    let resolvePromise!: (result?: boolean) => void
    const wait = {
      remainingMs: Math.max(0, Number.isFinite(duration) ? duration : 0),
      complete: (result?: boolean) => {
        if (settled) return
        settled = true
        this.stageWaits.delete(wait)
        resolvePromise(result)
      },
    }
    const promise = new Promise<boolean | void>((resolve) => { resolvePromise = resolve })
    if (wait.remainingMs === 0) wait.complete()
    else this.stageWaits.add(wait)
    return { promise, cancel: () => wait.complete(false) }
  }

  private advanceStageWaits(deltaMs: number): void {
    if (deltaMs <= 0) return
    for (const wait of this.stageWaits) {
      wait.remainingMs -= deltaMs
      if (wait.remainingMs <= 0) wait.complete()
    }
  }

  private extensionViewport(): StageViewport {
    return {
      width: this.options.container.clientWidth,
      height: this.options.container.clientHeight,
      pixelRatio: this.renderer.getPixelRatio(),
    }
  }

  private readonly handleContextLost = (event: Event) => {
    if (this.destroyed || this.pausedByContext) return
    event.preventDefault()
    this.pausedByContext = true
    this.stopRenderLoop()
    this.options.onContextChange?.('lost')
  }

  private readonly handleContextRestored = () => {
    if (this.destroyed || !this.pausedByContext) return
    this.pausedByContext = false
    this.contentRenderer.capabilities.resourceRecovery?.refreshResources()
    this.startRenderLoop()
    this.options.onContextChange?.('restored')
  }

  private readonly handleMotionPreferenceChange = (event: MediaQueryListEvent) => {
    if (this.destroyed || this.motionPreference !== 'auto') return
    this.reducedMotion = event.matches
    this.extensionHost.reducedMotionChange(this.reducedMotion)
    if (!this.reducedMotion) return
    this.stopRotation()
    if (!this.activeEffect) return
    this.transforms = this.activeEffect.effect.calculateTransforms(this.items.length, 0)
    this.activeEffect = null
    this.contentRenderer.capabilities.streamingEffects?.disable()
    this.contentRenderer.setTransforms(this.transforms)
  }

  private assertActive(): void {
    if (this.destroyed) throw new Error('MotionStage has been destroyed')
  }
}

function assertMotionRenderer(value: unknown): asserts value is MotionRenderer {
  if (!value || typeof value !== 'object') {
    throw new TypeError('Motion renderer factory must return a MotionRenderer object')
  }
  const renderer = value as Partial<MotionRenderer>
  const methods: Array<keyof MotionRenderer> = [
    'setItems', 'setTransforms', 'prepareTransition', 'setProgress',
    'setVisibleRatio', 'getStats', 'dispose',
  ]
  const missing = methods.find((method) => typeof renderer[method] !== 'function')
  if (missing) throw new TypeError(`Motion renderer is missing required method: ${missing}`)
  if (!renderer.descriptor || typeof renderer.descriptor !== 'object') {
    throw new TypeError('Motion renderer must declare a descriptor')
  }
  if (!renderer.capabilities || typeof renderer.capabilities !== 'object') {
    throw new TypeError('Motion renderer must declare capabilities')
  }
  validateCapability(renderer.capabilities.patch, 'patch', ['updateItems'])
  validateCapability(renderer.capabilities.visual, 'visual', [
    'setVisualState', 'prepareVisualTransition',
  ])
  validateCapability(renderer.capabilities.highlight, 'highlight', ['setHighlightIndex'])
  validateCapability(renderer.capabilities.viewport, 'viewport', ['resize'])
  validateCapability(renderer.capabilities.resourceRecovery, 'resourceRecovery', ['refreshResources'])
  validateCapability(renderer.capabilities.streamingEffects, 'streamingEffects', [
    'enable', 'disable', 'setTime',
  ])
  const shape = renderer.descriptor.itemBounds
  if (shape === null) return
  if (!shape || (shape.kind !== 'quad' && shape.kind !== 'disc')) {
    throw new TypeError('Motion renderer descriptor must declare valid itemBounds or null')
  }
  if (shape.kind === 'disc') {
    if (shape.facing !== 'camera' || !Number.isFinite(shape.diameter) || shape.diameter <= 0) {
      throw new TypeError('Disc itemBounds must be camera-facing with a positive diameter')
    }
    return
  }
  if (
    (shape.facing !== 'layout' && shape.facing !== 'camera')
    || !Number.isFinite(shape.width)
    || !Number.isFinite(shape.height)
    || shape.width <= 0
    || shape.height <= 0
  ) {
    throw new TypeError('Quad itemBounds must have a valid facing and positive width/height')
  }
}

function validateCapability(
  capability: unknown,
  name: string,
  methods: readonly string[],
): void {
  if (capability === undefined) return
  if (!capability || typeof capability !== 'object') {
    throw new TypeError(`Motion renderer capability ${name} must be an object`)
  }
  const missing = methods.find((method) =>
    typeof (capability as Record<string, unknown>)[method] !== 'function')
  if (missing) {
    throw new TypeError(`Motion renderer capability ${name} is missing method: ${missing}`)
  }
}

interface NormalizedRendererStats {
  instanceCount: number
  submittedInstanceCount: number
  gpuBytes: number
  metrics: Readonly<Record<string, number>>
}

function normalizeRendererStats(stats: MotionRendererStats): NormalizedRendererStats {
  const input = stats && typeof stats === 'object'
    ? stats as Partial<MotionRendererStats>
    : {}
  const metricInput = input.metrics && typeof input.metrics === 'object'
    ? input.metrics
    : {}
  const metrics = Object.fromEntries(
    Object.entries(metricInput)
      .slice(0, 64)
      .map(([key, value]) => [key, finiteStat(value)]),
  )
  const instanceCount = finiteStat(input.instanceCount)
  return {
    instanceCount,
    submittedInstanceCount: Math.min(instanceCount, finiteStat(input.submittedInstanceCount)),
    gpuBytes: finiteStat(input.gpuBytes),
    metrics: Object.freeze(metrics),
  }
}

function finiteStat(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
}

function disposeObjectResources(root: Object3D): void {
  const geometries = new Set<{ dispose(): void }>()
  const materials = new Set<Material>()
  const textures = new Set<Texture>()
  root.traverse((object) => {
    const renderable = object as Object3D & {
      geometry?: { dispose(): void }
      material?: Material | Material[]
    }
    if (renderable.geometry?.dispose) geometries.add(renderable.geometry)
    const objectMaterials = Array.isArray(renderable.material)
      ? renderable.material
      : renderable.material
        ? [renderable.material]
        : []
    objectMaterials.forEach((material) => {
      materials.add(material)
      Object.values(material).forEach((value) => {
        if (value && typeof value === 'object' && (value as Texture).isTexture) {
          textures.add(value as Texture)
        }
      })
    })
  })
  textures.forEach((texture) => texture.dispose())
  materials.forEach((material) => material.dispose())
  geometries.forEach((geometry) => geometry.dispose())
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

function isBatchableItemUpdate(options: UpdateItemsOptions): boolean {
  return options.layout === undefined
    && options.duration === undefined
    && options.easing === undefined
}
