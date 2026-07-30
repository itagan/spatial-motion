import type {
  Layout,
  MotionItem,
  QualityLevel,
  QualityMode,
  QualityProfile,
  TransitionOptions,
} from './types.js'
import { easing } from './math.js'
import {
  type MotionRenderer,
  type MotionRendererFactory,
  type MotionRendererVisualState,
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
import { MotionController } from './MotionController.js'
import { ExtensionHost } from './ExtensionHost.js'
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
import {
  calculateLayoutInto,
  TransformBuffer,
  type TransformBufferView,
} from './TransformBuffer.js'

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
  private readonly motionController = new MotionController()
  private readonly extensionHost: ExtensionHost
  private readonly runtime: StageRuntime
  private readonly qualityController: QualityController
  private readonly effectController: EffectController
  private readonly rendererState: RendererStateCoordinator<TMeta>
  private readonly stageClock = new StageClock()
  private readonly contentState = new StageContentState<TMeta>()
  private readonly effectTransformBuffer = new TransformBuffer()
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
  private transformCalculationMs = 0
  private transformCalculations = 0
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
    this.extensionHost = new ExtensionHost({
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
    this.runtime = new StageRuntime({
      element: canvas,
      onFrame: (now, rawFrameMs, deltaSeconds) =>
        this.renderFrame(now, rawFrameMs, deltaSeconds),
      onPauseChange: (paused) => this.extensionHost.setPaused(paused),
      onResume: (now) => {
        this.motionController.rebaseClock(now)
        this.effectController.rebaseClock(now)
      },
      onContextLost: () => this.extensionHost.contextLost(),
      onContextRestored: () => {
        this.host.restoreBaseState()
        this.contentRenderer.refreshResources()
        void this.effectController.restoreRendererState()
        this.extensionHost.contextRestored()
      },
      onContextChange: (state) => this.events.emit('contextchange', { state }),
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
      resolveTransformBuffer: (now) => this.resolveCurrentTransformBuffer(now),
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
      resolveTransformBuffer: (now) => this.resolveCurrentTransformBuffer(now),
      getLayoutContext: () => this.context(),
      transitionTo: (layout, transitionOptions) =>
        this.transitionTo(layout, transitionOptions),
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
    this.contentCoordinator.validateItems(items)
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
    return this.toInternal(layout, options)
  }

  startTransition(layout: Layout<TMeta>, options: TransitionOptions = {}): StageTransitionHandle {
    this.assertActive()
    const controller = new AbortController()
    const forwardAbort = () => controller.abort()
    if (options.signal?.aborted) controller.abort()
    else options.signal?.addEventListener('abort', forwardAbort, { once: true })
    const state: { status: StageTransitionStatus } = { status: 'running' }
    const finished = this.transitionToResult(layout, { ...options, signal: controller.signal })
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

  private async toInternal(layout: Layout<TMeta>, options: TransitionOptions): Promise<boolean> {
    const completed = await this.transitionTo(layout, options)
    if (completed) this.contentState.lastLayout = layout
    return completed
  }

  private async transitionTo(layout: Layout<TMeta>, options: TransitionOptions = {}): Promise<boolean> {
    return (await this.transitionToResult(layout, options)).completed
  }

  private transitionToResult(
    layout: Layout<TMeta>,
    options: TransitionOptions = {},
  ): Promise<StageTransitionResult> {
    if (options.signal?.aborted) {
      return Promise.resolve(this.motionController.settle(layout.name, 'aborted'))
    }
    this.events.emit('transitionstart', { layout: layout.name })
    const now = performance.now()
    const visualState = this.resolveCurrentVisualState(now)
    this.contentState.transforms = new TransformBuffer().copyFromBuffer(
      this.resolveCurrentTransformBuffer(now),
    )
    this.effectController.deactivate()
    this.motionController.cancel('interrupted')
    const from = this.contentState.transforms
    const calculationStartedAt = performance.now()
    const target = calculateLayoutInto(
      layout,
      this.contentState.items.length,
      this.context(),
      new TransformBuffer(),
    )
    this.transformCalculationMs += performance.now() - calculationStartedAt
    this.transformCalculations += 1
    const targetOrientation = layout.orientation ?? 'surface'
    const targetHideBackHemisphere = layout.hideBackHemisphere ?? false
    const targetHemisphereEdgeFade = layout.hemisphereEdgeFade ?? 0
    const targetBillboard = targetOrientation === 'camera' ? 1 : 0
    const targetHideBack = targetHideBackHemisphere ? 1 : 0
    this.contentState.setVisual(
      targetOrientation,
      targetHideBackHemisphere,
      targetHemisphereEdgeFade,
    )
    const duration = this.reducedMotion
      ? 0
      : Math.max(0, options.duration ?? this.options.transition?.duration ?? 1200)
    const ease = options.easing ?? this.options.transition?.easing ?? easing.sineInOut
    if (duration === 0) {
      this.contentState.transforms = target
      this.contentRenderer.setVisualState({
        billboard: targetBillboard,
        hideBackHemisphere: targetHideBack,
        hemisphereEdgeFade: targetHemisphereEdgeFade,
      })
      this.contentRenderer.setTransforms(target)
      const result = this.motionController.settle(layout.name, 'completed')
      this.events.emit('transitionend', { layout: layout.name, result })
      return Promise.resolve(result)
    }
    this.contentRenderer.prepareTransition(from, target)
    this.contentRenderer.prepareVisualTransition(visualState, {
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
    }).then((result) => {
      this.events.emit('transitionend', { layout: layout.name, result })
      return result
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
    const target = this.effectController.prepare(
      effect,
      this.contentState.items.length,
      this.qualityController.getProfile().maxActiveEffectItems,
    )
    const entered = await this.transitionTo(
      {
        name: `${effect.name}-entry`,
        orientation: 'camera',
        hideBackHemisphere: false,
        hemisphereEdgeFade: 0,
        calculate: () => target,
        calculateInto: (_count, _context, buffer) => {
          buffer.copyFrom(target)
        },
      },
      options,
    )
    if (!entered) return false
    if (this.reducedMotion) {
      this.contentState.transforms = new TransformBuffer().copyFrom(target)
      this.contentRenderer.setTransforms(this.contentState.transforms)
      return true
    }
    if (!await this.effectController.activate(effect, performance.now())) {
      this.contentState.transforms = new TransformBuffer().copyFrom(target)
      this.contentRenderer.setTransforms(this.contentState.transforms)
      return true
    }
    return true
  }

  updateItems(
    items: readonly MotionItem<TMeta>[],
    options: UpdateItemsOptions<TMeta> = {},
  ): Promise<boolean> {
    this.assertActive()
    this.contentCoordinator.validateItems(items)
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
    this.contentCoordinator.validateUpdates(updates)
    return this.contentCoordinator.updateItemsById(updates, options)
  }

  focusItems(ids: string[], options: FocusItemsOptions = {}): Promise<boolean> {
    this.assertActive()
    return this.focusItemsInternal(ids, options)
  }

  private async focusItemsInternal(ids: string[], options: FocusItemsOptions): Promise<boolean> {
    const selected = new Set(ids)
    const items = this.contentState.items
    if (!items.some((item) => selected.has(item.id))) return false
    const { createFocusLayout } = await import('./FocusLayout.js')
    if (this.destroyed || items !== this.contentState.items) return false
    const current = new TransformBuffer().copyFromBuffer(
      this.resolveCurrentTransformBuffer(performance.now()),
    )
    return this.transitionTo(createFocusLayout(items, ids, current, options), options)
  }

  restoreLayout(options: TransitionOptions = {}): Promise<boolean> {
    this.assertActive()
    if (!this.contentState.lastLayout) return Promise.resolve(false)
    return this.transitionTo(this.contentState.lastLayout, options)
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
    return this.extensionHost.add(extension)
  }

  resize(): void {
    this.assertActive()
    this.resizeInternal()
  }

  private resizeInternal(): void {
    const { clientWidth: width, clientHeight: height } = this.options.container
    if (!width || !height) return
    this.host.resize(width, height)
    if (
      this.contentState.lastLayout
      && this.contentState.items.length
      && !this.motionController.hasActiveTransition()
      && !this.effectController.hasActive()
    ) {
      this.contentState.transforms = calculateLayoutInto(
        this.contentState.lastLayout,
        this.contentState.items.length,
        this.context(),
        new TransformBuffer(),
      )
      this.contentRenderer.setTransforms(this.contentState.transforms)
    }
    const viewport = this.extensionViewport()
    this.contentRenderer.resize(viewport)
    this.extensionHost.resize(viewport)
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.contentCoordinator.invalidate()
    this.motionController.cancel('destroyed')
    this.runtime.dispose()
    this.resizeObserver.disconnect()
    this.cleanupCanvasAndListeners()
    this.stageClock.dispose()
    this.extensionHost.dispose()
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
    const performanceStats = this.qualityController.getStats()
    const rendererStats = normalizeRendererStats(this.contentRenderer.getStats())
    const interactionStats = this.interaction.getStats()
    const activeEffectItems = this.effectController.getActiveCount()
    return {
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
      transformCalculationMs: this.transformCalculationMs,
      transformCalculations: this.transformCalculations,
      pickingMs: interactionStats.pickingMs,
      pickOperations: interactionStats.pickOperations,
      extensions: this.extensionHost.getCount(),
      extensionUpdateMs: this.extensionHost.getUpdateDuration(),
      extensionRenderMs: this.extensionHost.getRenderDuration(),
    }
  }

  getExtensionStats(): StageExtensionStats[] {
    this.assertActive()
    return this.extensionHost.getStats()
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

  private resolveCurrentTransformBuffer(now: number): TransformBufferView {
    const effectTransforms = this.effectController.resolveTransforms(
      this.contentState.items.length,
      now,
      this.runtime.isPaused(),
    )
    if (effectTransforms) return this.effectTransformBuffer.copyFrom(effectTransforms)
    return this.motionController.resolveBuffer(
      this.contentState.transforms,
      now,
      this.runtime.isPaused(),
    )
  }

  private resolveCurrentVisualState(now: number): MotionRendererVisualState {
    if (this.effectController.hasActive()) {
      return { billboard: 1, hideBackHemisphere: 0, hemisphereEdgeFade: 0 }
    }
    return this.motionController.resolveVisualState(
      this.currentRendererVisualState(),
      now,
      this.runtime.isPaused(),
    )
  }

  private currentRendererVisualState(): MotionRendererVisualState {
    return this.contentState.getVisualState()
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
    this.extensionHost.update(delta)
    this.frameCpuMs = performance.now() - frameCpuStartedAt
    this.extensionHost.beforeRender()
    const renderStartedAt = performance.now()
    this.host.render()
    this.renderSubmitMs = performance.now() - renderStartedAt
    this.extensionHost.afterRender()
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
    this.extensionHost.qualityChange(quality)
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
    this.extensionHost.reducedMotionChange(this.reducedMotion)
    if (!this.reducedMotion) return
    this.stopRotation()
    const transforms = this.effectController.settleReducedMotion(this.contentState.items.length)
    if (!transforms) return
    this.contentState.transforms = new TransformBuffer().copyFrom(transforms)
    this.contentRenderer.setTransforms(this.contentState.transforms)
  }

  private assertActive(): void {
    if (this.destroyed) throw new Error('MotionStage has been destroyed')
  }

}
