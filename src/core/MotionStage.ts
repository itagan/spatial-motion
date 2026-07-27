import type {
  Layout,
  MotionItem,
  QualityLevel,
  QualityMode,
  QualityProfile,
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
import {
  InteractionController,
  visibilityRank,
} from './InteractionController.js'
import { ItemCoordinator } from './ItemCoordinator.js'
import { MotionController } from './MotionController.js'
import { ExtensionHost } from './ExtensionHost.js'
import { StageRuntime } from './StageRuntime.js'
import { QualityController } from './QualityController.js'
import { StageEventHub, type StageEventListener } from './StageEventHub.js'
import { EffectController } from './EffectController.js'
import { StageRenderHost } from './StageRenderHost.js'
import { RendererStateCoordinator } from './RendererStateCoordinator.js'

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
  private readonly contentRenderer: MotionRenderer<TMeta>
  private readonly interaction: InteractionController<TMeta>
  private readonly itemCoordinator: ItemCoordinator<TMeta>
  private readonly motionController = new MotionController()
  private readonly extensionHost: ExtensionHost
  private readonly runtime: StageRuntime
  private readonly qualityController: QualityController
  private readonly effectController: EffectController
  private readonly rendererState: RendererStateCoordinator<TMeta>
  private readonly events = new StageEventHub<MotionStageEventMap<TMeta>>()
  private readonly itemWidth: number
  private readonly itemHeight: number
  private readonly resizeObserver: ResizeObserver
  private items: MotionItem<TMeta>[] = []
  private sourceItems: MotionItem<TMeta>[] = []
  private transforms: Transform[] = []
  private rotateX = 0
  private rotateY = 0
  private rotateSpeedX = 0
  private rotateSpeedY = 0
  private lastLayout: Layout<TMeta> | null = null
  private visibleRatio = 1
  private currentOrientation: 'surface' | 'camera' = 'surface'
  private hideBackHemisphere = false
  private hemisphereEdgeFade = 0
  private inputItemCount = 0
  private destroyed = false
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
    const canvas = this.host.canvas
    if (this.motionPreference === 'auto') {
      this.motionQuery?.addEventListener('change', this.handleMotionPreferenceChange)
    }
    let contentRenderer: MotionRenderer<TMeta> | null = null
    try {
      contentRenderer = options.renderer(this.host.createRendererFactoryContext())
      assertMotionRenderer(contentRenderer)
    } catch (error) {
      contentRenderer?.dispose?.()
      this.cleanupCanvasAndListeners()
      this.host.dispose()
      throw error
    }
    this.contentRenderer = contentRenderer
    this.effectController = new EffectController(
      contentRenderer.capabilities.streamingEffects,
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
      onFrame: (frame) => this.renderFrame(frame.now, frame.rawFrameMs, frame.deltaSeconds),
      onPauseChange: (paused) => this.extensionHost.setPaused(paused),
      onResume: (now) => {
        this.motionController.rebaseClock(now)
        this.effectController.rebaseClock(now)
      },
      onContextLost: () => {},
      onContextRestored: () => {
        this.host.restoreBaseState()
        this.contentRenderer.capabilities.resourceRecovery?.refreshResources()
        void this.effectController.restoreRendererState()
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
        items: this.items,
        visibleRatio: this.visibleRatio,
        rotationX: this.rotateX,
        rotationY: this.rotateY,
        orientation: this.currentOrientation,
        hideBackHemisphere: this.hideBackHemisphere,
        effectActive: this.effectController.hasActive(),
      }),
      resolveTransforms: (now) => this.resolveCurrentTransforms(now),
      hasScheduledFrame: () => this.runtime.hasScheduledFrame(),
      isDestroyed: () => this.destroyed,
      setHighlightIndex: (index) =>
        this.contentRenderer.capabilities.highlight?.setHighlightIndex(index),
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
    this.resizeObserver = new ResizeObserver(() => {
      if (!this.destroyed) this.resizeInternal()
    })
    this.resizeObserver.observe(this.options.container)
    this.resizeInternal()
    this.runtime.start()
    this.ready = options.items ? this.setItemsInternal(options.items) : Promise.resolve()
  }

  setItems(items: readonly MotionItem<TMeta>[]): Promise<void> {
    this.assertActive()
    this.itemCoordinator.validateItems(items)
    return this.setItemsAfterPendingUpdates(items)
  }

  on<TKey extends keyof MotionStageEventMap<TMeta>>(
    type: TKey,
    listener: StageEventListener<MotionStageEventMap<TMeta>[TKey]>,
  ): () => void {
    this.assertActive()
    return this.events.on(type, listener)
  }

  private async setItemsAfterPendingUpdates(items: readonly MotionItem<TMeta>[]): Promise<void> {
    await this.itemCoordinator.flushPatches()
    return this.setItemsInternal(items)
  }

  private async setItemsInternal(items: readonly MotionItem<TMeta>[]): Promise<void> {
    const revision = this.itemCoordinator.beginOperation()
    this.motionController.cancel('interrupted')
    this.effectController.deactivate()
    const maxItems = this.qualityController.getProfile().maxVisibleItems
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
    return this.motionController.getState(performance.now(), this.runtime.isPaused())
  }

  private async toInternal(layout: Layout<TMeta>, options: TransitionOptions): Promise<boolean> {
    const completed = await this.transitionTo(layout, options)
    if (completed) this.lastLayout = layout
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
    this.transforms = this.resolveCurrentTransforms(now)
    this.effectController.deactivate()
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
      const result = this.motionController.settle(layout.name, 'completed')
      this.events.emit('transitionend', { layout: layout.name, result })
      return Promise.resolve(result)
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
      this.items.length,
      this.qualityController.getProfile().maxActiveEffectItems,
    )
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
    if (!await this.effectController.activate(effect, performance.now())) {
      this.transforms = target
      this.contentRenderer.setTransforms(target)
      return true
    }
    return true
  }

  updateItems(
    items: readonly MotionItem<TMeta>[],
    options: UpdateItemsOptions<TMeta> = {},
  ): Promise<boolean> {
    this.assertActive()
    this.itemCoordinator.validateItems(items)
    return this.updateItemsAfterPendingUpdates(items, options)
  }

  private async updateItemsAfterPendingUpdates(
    items: readonly MotionItem<TMeta>[],
    options: UpdateItemsOptions<TMeta>,
  ): Promise<boolean> {
    await this.itemCoordinator.flushPatches()
    return this.updateItemsInternal(items, options)
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
    this.itemCoordinator.validateUpdates(updates)
    if (!updates.length) return Promise.resolve(true)
    if (!isBatchableItemUpdate(options)) {
      return this.updateItemsByIdAfterPendingUpdates(updates, options)
    }
    return this.itemCoordinator.queuePatches(updates)
  }

  private async updateItemsByIdAfterPendingUpdates(
    updates: MotionItemUpdate<TMeta>[],
    options: UpdateItemsOptions<TMeta>,
  ): Promise<boolean> {
    await this.itemCoordinator.flushPatches()
    return this.updateItemsByIdInternal(updates, options)
  }

  private async updateItemsByIdInternal(
    updates: MotionItemUpdate<TMeta>[],
    options: UpdateItemsOptions<TMeta>,
  ): Promise<boolean> {
    if (!updates.length) return true
    const maxItems = Math.max(
      this.items.length,
      this.qualityController.getProfile().maxVisibleItems,
    )
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
    this.visibleRatio = nextItems.length
      ? Math.min(1, this.qualityController.getProfile().maxVisibleItems / nextItems.length)
      : 1
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
    options: UpdateItemsOptions<TMeta>,
    preserveEffect = false,
  ): Promise<boolean> {
    const now = performance.now()
    const current = this.resolveCurrentTransforms(now)
    const previousById = new Map(this.items.map((item, index) => [item.id, current[index]]))
    const currentEffect = preserveEffect ? this.effectController.getToken() : null
    const revision = this.itemCoordinator.beginOperation()
    this.motionController.cancel('interrupted')
    if (!preserveEffect) {
      this.effectController.deactivate()
    }
    this.transforms = current
    this.contentRenderer.setTransforms(current)

    const maxItems = this.qualityController.getProfile().maxVisibleItems
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
    if (this.effectController.isTokenActive(currentEffect)) {
      if (targetLayout) {
        this.transforms = [...targetLayout.calculate(this.items.length, this.context())]
        this.contentRenderer.setTransforms(this.transforms)
        if (options.layout) this.lastLayout = options.layout
      }
      const profile = this.qualityController.getProfile()
      await this.effectController.reconfigure(
        this.items.length,
        profile.maxActiveEffectItems,
        performance.now(),
        this.runtime.isPaused(),
      )
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
    this.rotateSpeedX = 0
    this.rotateSpeedY = 0
  }

  setRotation(x: number, y: number): void {
    this.assertActive()
    this.rotateX = x
    this.rotateY = y
    this.host.contentRoot.rotation.set(x, y, 0)
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
    this.host.resize(width, height)
    if (
      this.lastLayout
      && this.items.length
      && !this.motionController.hasActiveTransition()
      && !this.effectController.hasActive()
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
    this.runtime.dispose()
    this.resizeObserver.disconnect()
    this.cleanupCanvasAndListeners()
    for (const wait of this.stageWaits) wait.complete(false)
    this.stageWaits.clear()
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
      inputItems: this.inputItemCount,
      residentItems: rendererStats.instanceCount,
      submittedItems: rendererStats.submittedInstanceCount,
      visibleItems: activeEffectItems
        ? countVisibleItems(activeEffectItems, this.visibleRatio)
        : countVisibleItems(rendererStats.instanceCount, this.visibleRatio),
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
      items: this.items,
      quality: this.qualityController.getLevel(),
    }
  }

  private resolveCurrentTransforms(now: number): Transform[] {
    const effectTransforms = this.effectController.resolveTransforms(
      this.items.length,
      now,
      this.runtime.isPaused(),
    )
    if (effectTransforms) return effectTransforms
    return this.motionController.resolveTransforms(this.transforms, now, this.runtime.isPaused())
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
    return {
      billboard: this.currentOrientation === 'camera' ? 1 : 0,
      hideBackHemisphere: this.hideBackHemisphere ? 1 : 0,
      hemisphereEdgeFade: this.hemisphereEdgeFade,
    }
  }

  private restoreRendererStateAfterItems(): void {
    this.rendererState.restoreAfterItems({
      transforms: this.transforms,
      visual: this.currentRendererVisualState(),
      visibleRatio: this.visibleRatio,
      now: performance.now(),
      paused: this.runtime.isPaused(),
    })
  }

  private renderFrame(now: number, rawFrameMs: number, delta: number): void {
    const frameCpuStartedAt = performance.now()
    this.advanceStageWaits(rawFrameMs)
    const completedTransforms = this.motionController.advance(
      now,
      (progress) => this.contentRenderer.setProgress(progress),
    )
    if (completedTransforms) this.transforms = completedTransforms
    const nextQuality = this.qualityController.recordFrame(
      rawFrameMs,
      now,
      this.options.adaptivePerformance !== false,
    )
    if (nextQuality) this.applyQuality(nextQuality)
    this.rotateX += this.rotateSpeedX * delta
    this.rotateY += this.rotateSpeedY * delta
    this.host.contentRoot.rotation.set(this.rotateX, this.rotateY, 0)
    this.effectController.advance(now)
    this.contentRenderer.capabilities.frame?.update(delta)
    this.interaction.flushPendingPointerMove()
    this.extensionHost.update(delta)
    this.frameCpuMs = performance.now() - frameCpuStartedAt
    const renderStartedAt = performance.now()
    this.host.render()
    this.renderSubmitMs = performance.now() - renderStartedAt
  }

  private applyQuality(quality: QualityLevel): void {
    const targetLayout = this.motionController.getTargetLayout() ?? this.lastLayout
    const profile = this.qualityController.getProfile(quality)
    this.host.setPixelRatio(profile.maxPixelRatio)
    const targetCount = Math.min(this.sourceItems.length, profile.maxVisibleItems)
    this.visibleRatio = this.items.length
      ? Math.min(1, targetCount / this.items.length)
      : 1
    this.contentRenderer.setVisibleRatio(this.visibleRatio)
    this.interaction.syncItems()
    void this.effectController.reconfigure(
      this.items.length,
      profile.maxActiveEffectItems,
      performance.now(),
      this.runtime.isPaused(),
    )
    this.extensionHost.qualityChange(quality)
    this.resizeInternal()
    const stats = this.qualityController.getStats()
    this.events.emit('qualitychange', { quality, stats })
    if (this.sourceItems.length && targetCount > this.items.length) {
      void this.updateItemsInternal(this.sourceItems, {
        layout: targetLayout ?? undefined,
        duration: 0,
      }, true).catch((error) => console.error('Spatial Motion quality reconciliation failed', error))
    }
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
      pixelRatio: this.host.getViewport().pixelRatio,
    }
  }

  private readonly handleMotionPreferenceChange = (event: MediaQueryListEvent) => {
    if (this.destroyed || this.motionPreference !== 'auto') return
    this.reducedMotion = event.matches
    this.extensionHost.reducedMotionChange(this.reducedMotion)
    if (!this.reducedMotion) return
    this.stopRotation()
    const transforms = this.effectController.settleReducedMotion(this.items.length)
    if (!transforms) return
    this.transforms = transforms
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
  validateCapability(renderer.capabilities.frame, 'frame', ['update'])
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

function countVisibleItems(count: number, ratio: number): number {
  let visible = 0
  for (let index = 0; index < count; index += 1) {
    if (visibilityRank(index) <= ratio) visible += 1
  }
  return visible
}

function isBatchableItemUpdate(options: UpdateItemsOptions): boolean {
  return options.layout === undefined
    && options.duration === undefined
    && options.easing === undefined
}
