import type {
  Layout,
  MotionItem,
  QualityLevel,
  QualityMode,
  QualityProfile,
  TransitionOptions,
} from './types.js'
import {
  type MotionRenderer,
  type MotionRendererFactory,
  type MotionRendererPrewarmRequest,
} from '../renderers/MotionRenderer.js'
import type {
  AdaptivePerformanceOptions,
  PerformanceStats,
} from '../performance/AdaptivePerformanceManager.js'
import { Timeline } from './Timeline.js'
import type {
  StageExtension,
  StageExtensionHandle,
  StageExtensionStats,
  StageViewport,
} from './extensions.js'
import type { StreamingEffect } from '../effects/types.js'
import { InteractionController } from './InteractionController.js'
import { validateMotionItems } from './ItemCoordinator.js'
import {
  MotionController,
  type MotionTransitionResult,
  type MotionTransitionStatus,
} from './MotionController.js'
import type { ExtensionHost } from './ExtensionHost.js'
import { StageRuntime } from './StageRuntime.js'
import { QualityController } from './QualityController.js'
import { StageEventHub, type StageEventListener } from './StageEventHub.js'
import { EffectController } from './EffectController.js'
import { StageRenderHost } from './StageRenderHost.js'
import { RendererStateCoordinator } from './RendererStateCoordinator.js'
import { StageClock } from './StageClock.js'
import {
  countVisibleItems,
  normalizeRendererStats,
} from './MotionRendererSupport.js'
import { StageContentState } from './StageContentState.js'
import { StageRotationController } from './StageRotationController.js'
import {
  compileRendererRuntime,
  type CompiledRendererRuntime,
} from './CompiledRendererRuntime.js'
import { StageContentCoordinator } from './StageContentCoordinator.js'
import { StageMotionCoordinator } from './StageMotionCoordinator.js'

export interface MotionStageOptions<TMeta = unknown> {
  container: HTMLElement
  items?: readonly MotionItem<TMeta>[]
  renderer: MotionRendererFactory<TMeta>
  quality?: QualityLevel | 'auto'
  qualityProfiles?: Partial<Record<QualityLevel, QualityProfile>>
  adaptivePerformanceOptions?: AdaptivePerformanceOptions
  cameraZ?: number
  adaptivePerformance?: boolean
  motionPreference?: MotionPreference
  /** Enables pointermove picking and itemhover events. */
  hover?: boolean
  hoverEffect?: 'none' | 'highlight'
  keyboardNavigation?: boolean
  ariaLabel?: string
  /** Defaults used when an individual transition omits duration or easing. */
  transition?: TransitionOptions
}

export interface UpdateItemsOptions<TMeta = unknown> extends TransitionOptions {
  layout?: Layout<TMeta>
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

export type MotionPreference = 'auto' | 'full' | 'reduced'
export type StageTransitionStatus = MotionTransitionStatus
export type StageTransitionResult = MotionTransitionResult

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
  residentItems: number
  submittedItems: number
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
  extensionRenderMs: number
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

export interface MotionStageEventMap<TMeta = unknown> {
  qualitychange: { quality: QualityLevel; stats: PerformanceStats }
  itemclick: { item: MotionItem<TMeta>; index: number }
  itemhover: { item: MotionItem<TMeta> | null; index: number | null }
  itemfocus: { item: MotionItem<TMeta> | null; index: number | null }
  contextchange: { state: 'lost' | 'restored' }
  extensionerror: { error: unknown; extension: StageExtension }
  effecterror: {
    error: unknown
    effect: string
    phase: 'activate' | 'reconfigure' | 'restore'
  }
  transitionstart: { layout: string }
  transitionend: { layout: string; result: StageTransitionResult }
}

export class MotionStage<TMeta = unknown> {
  readonly ready: Promise<void>
  private readonly host: StageRenderHost
  private readonly contentRenderer: CompiledRendererRuntime<TMeta>
  private readonly interaction: InteractionController<TMeta>
  private readonly contentCoordinator: StageContentCoordinator<TMeta>
  private readonly motionCoordinator: StageMotionCoordinator<TMeta>
  private readonly motionController = new MotionController()
  private extensionHost: ExtensionHost | null = null
  private extensionHostPromise: Promise<ExtensionHost> | null = null
  private readonly runtime: StageRuntime
  private readonly qualityController: QualityController
  private readonly effectController: EffectController
  private readonly rendererState: RendererStateCoordinator<TMeta>
  private readonly stageClock = new StageClock()
  private readonly contentState = new StageContentState<TMeta>()
  private readonly rotation: StageRotationController
  private readonly events = new StageEventHub<MotionStageEventMap<TMeta>>()
  private readonly itemWidth: number
  private readonly itemHeight: number
  private readonly resizeObserver: ResizeObserver
  private destroyed = false
  private readonly motionPreference: MotionPreference
  private readonly motionQuery: MediaQueryList | null
  private reducedMotion = false
  private frameCpuMs = 0
  private renderSubmitMs = 0
  private performanceSnapshot: StagePerformanceStats | null = null
  private performanceSnapshotClearQueued = false
  private readonly updateRendererProgress = (progress: number) => {
    this.contentRenderer.setProgress(progress)
  }

  constructor(private readonly options: MotionStageOptions<TMeta>) {
    if (typeof options.renderer !== 'function') {
      throw new TypeError('MotionStage renderer must be a renderer factory')
    }
    if (options.items) validateMotionItems(options.items)
    this.motionPreference = options.motionPreference ?? 'auto'
    this.motionQuery = typeof matchMedia === 'function'
      ? matchMedia('(prefers-reduced-motion: reduce)')
      : null
    this.reducedMotion = this.motionPreference === 'reduced'
      || (this.motionPreference === 'auto' && Boolean(this.motionQuery?.matches))
    const hoverEnabled = options.hover === true || options.hoverEffect === 'highlight'
    const keyboardNavigation = options.keyboardNavigation !== false
    const baseAriaLabel = options.ariaLabel ?? 'Spatial Motion'
    this.qualityController = new QualityController({
      mode: options.quality,
      profiles: options.qualityProfiles,
      adaptive: options.adaptivePerformanceOptions,
    })
    const profile = this.qualityController.getProfile()
    this.host = new StageRenderHost(options.container, profile, options.cameraZ)
    this.rotation = new StageRotationController(this.host.contentRoot)
    const canvas = this.host.canvas
    if (this.motionPreference === 'auto') {
      this.motionQuery?.addEventListener('change', this.handleMotionPreferenceChange)
    }
    let contentRenderer: MotionRenderer<TMeta> | null = null
    let rendererRuntime: CompiledRendererRuntime<TMeta>
    try {
      contentRenderer = options.renderer(this.host.createRendererFactoryContext())
      rendererRuntime = compileRendererRuntime(contentRenderer)
    } catch (error) {
      contentRenderer?.dispose?.()
      this.cleanupCanvasAndListeners()
      this.host.dispose()
      throw error
    }
    this.contentRenderer = rendererRuntime
    this.effectController = new EffectController(
      this.contentRenderer.streamingEffects,
      (event) => this.events.emit('effecterror', event),
    )
    const itemBounds = contentRenderer.descriptor.itemBounds
    this.itemWidth = itemBounds
      ? itemBounds.kind === 'disc' ? itemBounds.diameter : itemBounds.width
      : 1
    this.itemHeight = itemBounds
      ? itemBounds.kind === 'disc' ? itemBounds.diameter : itemBounds.height
      : 1
    this.runtime = new StageRuntime({
      element: canvas,
      onFrame: (now, rawFrameMs, deltaSeconds) =>
        this.renderFrame(now, rawFrameMs, deltaSeconds),
      onPauseChange: (paused) => {
        this.invalidatePerformanceSnapshot()
        this.extensionHost?.setPaused(paused)
      },
      onResume: (now) => {
        this.motionController.rebaseClock(now)
        this.effectController.rebaseClock(now)
      },
      onContextLost: () => this.extensionHost?.contextLost(),
      onContextRestored: () => {
        this.host.restoreBaseState()
        this.contentRenderer.refreshResources()
        void this.effectController.restoreRendererState()
        this.extensionHost?.contextRestored()
      },
      onContextChange: (state) => {
        this.invalidatePerformanceSnapshot()
        this.events.emit('contextchange', { state })
      },
    })
    this.motionCoordinator = new StageMotionCoordinator({
      state: this.contentState,
      renderer: this.contentRenderer,
      motion: this.motionController,
      effects: this.effectController,
      quality: this.qualityController,
      defaultTransition: options.transition,
      getLayoutContext: () => this.context(),
      isPaused: () => this.runtime.isPaused(),
      isReducedMotion: () => this.reducedMotion,
      isDestroyed: () => this.destroyed,
      onTransitionStart: (layout) =>
        this.events.emit('transitionstart', { layout }),
      onTransitionEnd: (layout, result) =>
        this.events.emit('transitionend', { layout, result }),
    })
    this.interaction = new InteractionController({
      element: canvas,
      camera: this.host.camera,
      itemBounds,
      hoverEnabled,
      hoverEffect: options.hoverEffect ?? 'none',
      keyboardNavigation,
      ariaLabel: baseAriaLabel,
      getState: () => ({
        items: this.contentState.items,
        visibleRatio: this.contentState.visibleRatio,
        rotationX: this.rotation.rotationX,
        rotationY: this.rotation.rotationY,
        orientation: this.contentState.orientation,
        hideBackHemisphere: this.contentState.hideBackHemisphere,
        effectActive: this.effectController.hasActive(),
      }),
      getItemIndex: (id) => this.contentState.getItemIndex(id),
      resolveTransformBuffer: (now) =>
        this.motionCoordinator.resolveTransformBuffer(now),
      hasScheduledFrame: () => this.runtime.hasScheduledFrame(),
      isDestroyed: () => this.destroyed,
      setHighlightIndex: (index) =>
        this.contentRenderer.setHighlightIndex(index),
      onItemClick: (item, index) => this.events.emit('itemclick', { item, index }),
      onItemHover: (item, index) => this.events.emit('itemhover', { item, index }),
      onItemFocus: (item, index) => this.events.emit('itemfocus', { item, index }),
    })
    this.rendererState = new RendererStateCoordinator(
      this.contentRenderer,
      this.motionController,
      this.effectController,
      this.interaction,
    )
    this.contentCoordinator = new StageContentCoordinator({
      state: this.contentState,
      renderer: this.contentRenderer,
      motion: this.motionController,
      effects: this.effectController,
      interaction: this.interaction,
      quality: this.qualityController,
      rendererState: this.rendererState,
      resolveTransformBuffer: (now) =>
        this.motionCoordinator.resolveTransformBuffer(now),
      getLayoutContext: () => this.context(),
      transitionTo: (layout, transitionOptions) =>
        this.motionCoordinator.transition(layout, transitionOptions),
      isPaused: () => this.runtime.isPaused(),
      isDestroyed: () => this.destroyed,
    })
    this.resizeObserver = new ResizeObserver(() => {
      if (!this.destroyed) this.resizeInternal()
    })
    this.resizeObserver.observe(this.options.container)
    this.resizeInternal()
    this.runtime.start()
    this.ready = options.items
      ? this.contentCoordinator.setItemsInternal(options.items)
      : Promise.resolve()
  }

  setItems(items: readonly MotionItem<TMeta>[]): Promise<void> {
    this.assertActive()
    this.invalidatePerformanceSnapshot()
    this.contentCoordinator.validateItems(items)
    this.motionCoordinator.invalidate()
    return this.contentCoordinator.setItems(items)
  }

  on<TKey extends keyof MotionStageEventMap<TMeta>>(
    type: TKey,
    listener: StageEventListener<MotionStageEventMap<TMeta>[TKey]>,
  ): () => void {
    this.assertActive()
    return this.events.on(type, listener)
  }

  to(layout: Layout<TMeta>, options: TransitionOptions = {}): Promise<boolean> {
    this.assertActive()
    this.invalidatePerformanceSnapshot()
    return this.motionCoordinator.transitionAndRemember(layout, options)
  }

  startTransition(layout: Layout<TMeta>, options: TransitionOptions = {}): StageTransitionHandle {
    this.assertActive()
    const controller = new AbortController()
    const forwardAbort = () => controller.abort()
    if (options.signal?.aborted) controller.abort()
    else options.signal?.addEventListener('abort', forwardAbort, { once: true })
    const state: { status: StageTransitionStatus } = { status: 'running' }
    const finished = this.motionCoordinator
      .transitionResult(layout, { ...options, signal: controller.signal })
      .then((result) => {
        state.status = result.status
        if (result.completed) this.contentState.lastLayout = layout
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
    return this.motionController.getState(performance.now(), this.runtime.isPaused())
  }

  enterEffect(effect: StreamingEffect, options: TransitionOptions = {}): Promise<boolean> {
    this.assertActive()
    this.invalidatePerformanceSnapshot()
    return this.motionCoordinator.enterEffect(effect, options)
  }

  updateItems(
    items: readonly MotionItem<TMeta>[],
    options: UpdateItemsOptions<TMeta> = {},
  ): Promise<boolean> {
    this.assertActive()
    this.invalidatePerformanceSnapshot()
    this.contentCoordinator.validateItems(items)
    this.motionCoordinator.invalidate()
    return this.contentCoordinator.updateItems(items, options)
  }

  updateItem(
    id: string,
    patch: MotionItemPatch<TMeta>,
    options: UpdateItemsOptions<TMeta> = {},
  ): Promise<boolean> {
    return this.updateItemsById([{ id, patch }], options)
  }

  updateItemsById(
    updates: MotionItemUpdate<TMeta>[],
    options: UpdateItemsOptions<TMeta> = {},
  ): Promise<boolean> {
    this.assertActive()
    this.invalidatePerformanceSnapshot()
    this.contentCoordinator.validateUpdates(updates)
    this.motionCoordinator.invalidate()
    return this.contentCoordinator.updateItemsById(updates, options)
  }

  focusItems(ids: string[], options: FocusItemsOptions = {}): Promise<boolean> {
    this.assertActive()
    this.invalidatePerformanceSnapshot()
    return this.motionCoordinator.focusItems(ids, options)
  }

  restoreLayout(options: TransitionOptions = {}): Promise<boolean> {
    this.assertActive()
    this.invalidatePerformanceSnapshot()
    return this.motionCoordinator.restoreLayout(options)
  }

  pick(
    clientX: number,
    clientY: number,
    options: number | PickOptions = {},
  ): Promise<PickResult<TMeta> | null> {
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
    this.rotation.autoRotate(options, this.reducedMotion)
  }

  setQuality(mode: QualityMode): void {
    this.assertActive()
    this.invalidatePerformanceSnapshot()
    const quality = this.qualityController.setMode(mode)
    if (quality) this.applyQuality(quality)
  }

  getQualityMode(): QualityMode {
    this.assertActive()
    return this.qualityController.getMode()
  }

  pause(): void {
    this.assertActive()
    this.runtime.pause()
  }

  resume(): void {
    this.assertActive()
    this.runtime.resume()
  }

  stopRotation(): void {
    this.assertActive()
    this.rotation.stop()
  }

  setRotation(x: number, y: number): void {
    this.assertActive()
    this.rotation.set(x, y)
  }

  timeline(): Timeline {
    this.assertActive()
    return new Timeline((duration) => this.stageClock.wait(duration))
  }

  async addExtension(extension: StageExtension): Promise<StageExtensionHandle> {
    this.assertActive()
    return (await this.getExtensionHost()).add(extension)
  }

  resize(): void {
    this.assertActive()
    this.resizeInternal()
  }

  /** Explicitly prepares resident textures and renderer-specific lazy Programs. */
  async prewarm(request: MotionRendererPrewarmRequest = {}): Promise<boolean> {
    this.assertActive()
    const result = await this.contentRenderer.prewarm(request)
    return !this.destroyed && result
  }

  private resizeInternal(): void {
    const { clientWidth: width, clientHeight: height } = this.options.container
    if (!width || !height) return
    this.host.resize(width, height)
    this.motionCoordinator.recalculateSettledLayout()
    const viewport = this.extensionViewport()
    this.contentRenderer.resize(viewport)
    this.extensionHost?.resize(viewport)
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.performanceSnapshot = null
    this.motionCoordinator.invalidate()
    this.contentCoordinator.invalidate()
    this.motionController.cancel('destroyed')
    this.runtime.dispose()
    this.resizeObserver.disconnect()
    this.cleanupCanvasAndListeners()
    this.stageClock.dispose()
    this.extensionHost?.dispose()
    this.effectController.dispose()
    this.contentRenderer.dispose()
    this.host.dispose()
    this.events.clear()
  }

  private cleanupCanvasAndListeners(): void {
    this.interaction?.dispose()
    this.runtime?.dispose()
    this.motionQuery?.removeEventListener('change', this.handleMotionPreferenceChange)
  }

  getQuality(): QualityLevel {
    this.assertActive()
    return this.qualityController.getLevel()
  }

  getPerformanceStats(): StagePerformanceStats {
    this.assertActive()
    if (this.performanceSnapshot) return this.performanceSnapshot
    const performanceStats = this.qualityController.getStats()
    const rendererStats = normalizeRendererStats(this.contentRenderer.getStats())
    const interactionStats = this.interaction.getStats()
    const activeEffectItems = this.effectController.getActiveCount()
    const snapshot = Object.freeze({
      ...performanceStats,
      qualityMode: this.qualityController.getMode(),
      inputItems: this.contentState.inputItemCount,
      residentItems: rendererStats.instanceCount,
      submittedItems: rendererStats.submittedInstanceCount,
      visibleItems: activeEffectItems
        ? countVisibleItems(activeEffectItems, this.contentState.visibleRatio)
        : countVisibleItems(rendererStats.instanceCount, this.contentState.visibleRatio),
      render: Object.freeze(this.host.getRenderStats()),
      renderer: Object.freeze(rendererStats),
      pixelRatio: this.host.getViewport().pixelRatio,
      paused: this.runtime.isPaused(),
      effect: this.effectController.getName(),
      activeEffectItems,
      contextLost: this.runtime.isContextLost(),
      frameCpuMs: this.frameCpuMs,
      renderSubmitMs: this.renderSubmitMs,
      transformCalculationMs: this.motionCoordinator.transformCalculationMs,
      transformCalculations: this.motionCoordinator.transformCalculations,
      pickingMs: interactionStats.pickingMs,
      pickOperations: interactionStats.pickOperations,
      extensions: this.extensionHost?.getCount() ?? 0,
      extensionUpdateMs: this.extensionHost?.getUpdateDuration() ?? 0,
      extensionRenderMs: this.extensionHost?.getRenderDuration() ?? 0,
    })
    this.performanceSnapshot = snapshot
    if (!this.performanceSnapshotClearQueued) {
      this.performanceSnapshotClearQueued = true
      queueMicrotask(() => {
        this.performanceSnapshot = null
        this.performanceSnapshotClearQueued = false
      })
    }
    return snapshot
  }

  getExtensionStats(): StageExtensionStats[] {
    this.assertActive()
    return this.extensionHost?.getStats() ?? []
  }

  getPerformanceEnvironment(): StagePerformanceEnvironment {
    this.assertActive()
    return this.host.getEnvironment()
  }

  private context() {
    const width = this.options.container.clientWidth
    const height = this.options.container.clientHeight
    const visibleWorld = this.host.getVisibleWorldSize()
    return {
      width,
      height,
      viewportWidth: visibleWorld.width,
      viewportHeight: visibleWorld.height,
      itemWidth: this.itemWidth,
      itemHeight: this.itemHeight,
      items: this.contentState.items,
      quality: this.qualityController.getLevel(),
    }
  }

  private renderFrame(now: number, rawFrameMs: number, delta: number): void {
    const frameCpuStartedAt = performance.now()
    this.stageClock.advance(rawFrameMs)
    const completedTransforms = this.motionController.advance(
      now,
      this.updateRendererProgress,
    )
    if (completedTransforms) this.contentState.transforms = completedTransforms
    const nextQuality = this.qualityController.recordFrame(
      rawFrameMs,
      now,
      this.options.adaptivePerformance !== false,
    )
    if (nextQuality) this.applyQuality(nextQuality)
    this.rotation.advance(delta)
    this.effectController.advance(now)
    this.contentRenderer.updateFrame(delta)
    this.interaction.flushPendingPointerMove()
    this.extensionHost?.update(delta)
    this.frameCpuMs = performance.now() - frameCpuStartedAt
    this.extensionHost?.beforeRender()
    const renderStartedAt = performance.now()
    this.host.render()
    this.renderSubmitMs = performance.now() - renderStartedAt
    this.extensionHost?.afterRender()
    this.invalidatePerformanceSnapshot()
  }

  private applyQuality(quality: QualityLevel): void {
    const targetLayout = this.motionController.getTargetLayout() ?? this.contentState.lastLayout
    const profile = this.qualityController.getProfile(quality)
    this.host.setPixelRatio(profile.maxPixelRatio)
    const targetCount = Math.min(this.contentState.sourceItems.length, profile.maxVisibleItems)
    this.contentState.visibleRatio = this.contentState.items.length
      ? Math.min(1, targetCount / this.contentState.items.length)
      : 1
    this.contentRenderer.setVisibleRatio(this.contentState.visibleRatio)
    this.interaction.syncItems()
    void this.effectController.reconfigure(
      this.contentState.items.length,
      profile.maxActiveEffectItems,
      performance.now(),
      this.runtime.isPaused(),
    )
    this.extensionHost?.qualityChange(quality)
    this.resizeInternal()
    const stats = this.qualityController.getStats()
    this.events.emit('qualitychange', { quality, stats })
    if (
      this.contentState.sourceItems.length
      && targetCount > this.contentState.items.length
    ) {
      void this.contentCoordinator.updateItemsInternal(this.contentState.sourceItems, {
        layout: targetLayout ?? undefined,
        duration: 0,
      }, true).catch((error) => console.error('Spatial Motion quality reconciliation failed', error))
    }
  }

  private extensionViewport(): StageViewport {
    return {
      width: this.options.container.clientWidth,
      height: this.options.container.clientHeight,
      pixelRatio: this.host.getViewport().pixelRatio,
    }
  }

  private readonly handleMotionPreferenceChange = (event: MediaQueryListEvent) => {
    if (this.destroyed || this.motionPreference !== 'auto') return
    this.reducedMotion = event.matches
    this.extensionHost?.reducedMotionChange(this.reducedMotion)
    if (!this.reducedMotion) return
    this.stopRotation()
    this.motionCoordinator.settleReducedMotion()
  }

  private assertActive(): void {
    if (this.destroyed) throw new Error('MotionStage has been destroyed')
  }

  private invalidatePerformanceSnapshot(): void {
    this.performanceSnapshot = null
  }

  private getExtensionHost(): Promise<ExtensionHost> {
    if (this.extensionHost) return Promise.resolve(this.extensionHost)
    return this.extensionHostPromise ??= import('./ExtensionHost.js')
      .then(({ ExtensionHost }) => {
        this.assertActive()
        return this.extensionHost = new ExtensionHost({
          parent: this.host.scene,
          camera: this.host.camera,
          getViewport: () => this.extensionViewport(),
          getQuality: () => this.qualityController.getLevel(),
          getReducedMotion: () => this.reducedMotion,
          isPaused: () => this.runtime.isPaused(),
          isDestroyed: () => this.destroyed,
          onError: (error, extension) =>
            this.events.emit('extensionerror', { error, extension }),
        })
      })
      .finally(() => {
        this.extensionHostPromise = null
      })
  }

}
