import { Euler, Group, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three'
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
import type {
  StageExtension,
  StageExtensionContext,
  StageExtensionHandle,
  StageExtensionStats,
  StageViewport,
} from './extensions.js'
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
  onItemFocus?: (item: MotionItem | null, index: number | null) => void
  hoverEffect?: 'none' | 'highlight'
  keyboardNavigation?: boolean
  ariaLabel?: string
  cardStyle?: CardStyle
  drawCard?: DrawCard
  /** Atlas pixels per card before GPU texture-size clamping. */
  cardResolution?: number
  /** Maximum time to wait for each image before drawing the fallback card. */
  imageTimeout?: number
  /** Maximum concurrent image requests per Stage. Defaults to 6. */
  imageConcurrency?: number
  /** Completed images retained per Stage for atlas redraws. Defaults to 128; 0 disables caching. */
  imageCacheSize?: number
  /** Defaults used when an individual transition omits duration or easing. */
  transition?: TransitionOptions
  onContextChange?: (state: 'lost' | 'restored') => void
  onExtensionError?: (error: unknown, extension: StageExtension) => void
}

export interface UpdateItemsOptions extends TransitionOptions {
  layout?: Layout
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
  renderedItems: number
  submittedItems: number
  visibleItems: number
  drawCalls: number
  triangles: number
  textureBytes: number
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
  atlasBuilds: number
  atlasPatches: number
  atlasDiscardedBuilds: number
  atlasDiscardedPatches: number
  atlasCellsUpdated: number
  atlasBuildMs: number
  atlasPatchMs: number
  atlasDrawMs: number
  imageLoadMs: number
  imageRequests: number
  imageFailures: number
  estimatedTextureUploadBytes: number
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

interface StageExtensionRecord {
  id: number
  order: number
  sequence: number
  extension: StageExtension
  root: Group
  abortController: AbortController
  active: boolean
  enabled: boolean
  mounted: boolean
  disposed: boolean
  archived: boolean
  paused: boolean
  hasUpdated: boolean
  elapsed: number
  updateCalls: number
  updateTotalMs: number
  updateSamples: number[]
  maximumUpdateMs: number
  slowFrames: number
  errorCount: number
  lastError: string | null
}

interface ActiveTransition {
  from: Transform[]
  to: Transform[]
  elapsedMs: number
  lastUpdatedAt: number
  duration: number
  easing: (value: number) => number
  fromBillboard: number
  toBillboard: number
  fromHideBackHemisphere: number
  toHideBackHemisphere: number
  layout: string
  resolve: (result: StageTransitionResult) => void
  removeAbortListener: () => void
}

interface ActiveEffect {
  effect: StreamingEffect
  gpuData: StreamingEffectGpuData
  elapsedSeconds: number
  lastUpdatedAt: number
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
  private activeTransition: ActiveTransition | null = null
  private activeEffect: ActiveEffect | null = null
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
  private pausedByContext = false
  private readonly motionPreference: MotionPreference
  private readonly motionQuery: MediaQueryList | null
  private reducedMotion = false
  private hoveredIndex: number | null = null
  private focusedItemId: string | null = null
  private readonly hoverEnabled: boolean
  private readonly keyboardNavigation: boolean
  private readonly baseAriaLabel: string
  private lastTransitionStatus: StageTransitionStatus | null = null
  private lastTransitionLayout: string | null = null
  private readonly stageWaits = new Set<{
    remainingMs: number
    complete: (result?: boolean) => void
  }>()
  private frameCpuMs = 0
  private renderSubmitMs = 0
  private transformCalculationMs = 0
  private transformCalculations = 0
  private pickingMs = 0
  private pickOperations = 0
  private pendingItemUpdateBatch: {
    updates: MotionItemUpdate[]
    resolve: Array<(applied: boolean) => void>
    reject: Array<(reason: unknown) => void>
  } | null = null
  private itemUpdateChain: Promise<unknown> = Promise.resolve()
  private readonly extensions = new Set<StageExtensionRecord>()
  private readonly extensionHistory: StageExtensionStats[] = []
  private extensionUpdateMs = 0
  private extensionSequence = 0

  constructor(private readonly options: MotionStageOptions) {
    this.motionPreference = options.motionPreference ?? 'auto'
    this.motionQuery = typeof matchMedia === 'function'
      ? matchMedia('(prefers-reduced-motion: reduce)')
      : null
    this.reducedMotion = this.motionPreference === 'reduced'
      || (this.motionPreference === 'auto' && Boolean(this.motionQuery?.matches))
    this.hoverEnabled = Boolean(options.onItemHover) || options.hoverEffect === 'highlight'
    this.keyboardNavigation = options.keyboardNavigation !== false
    this.baseAriaLabel = options.ariaLabel ?? 'Spatial Motion'
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
    canvas.addEventListener('pointerup', this.handlePointerUp)
    if (this.keyboardNavigation) {
      canvas.tabIndex = 0
      canvas.setAttribute('role', 'region')
      canvas.setAttribute('aria-label', this.baseAriaLabel)
      canvas.addEventListener('keydown', this.handleKeyDown)
      canvas.addEventListener('focus', this.handleCanvasFocus)
      canvas.addEventListener('blur', this.handleCanvasBlur)
    }
    if (this.hoverEnabled) {
      canvas.addEventListener('pointermove', this.handlePointerMove)
      canvas.addEventListener('pointerleave', this.handlePointerLeave)
    }
    if (this.motionPreference === 'auto') {
      this.motionQuery?.addEventListener('change', this.handleMotionPreferenceChange)
    }
    document.addEventListener('visibilitychange', this.handleVisibilityChange)
    this.cards = new InstancedCardRenderer(this.scene, {
      cardStyle: options.cardStyle,
      drawCard: options.drawCard,
      cellSize: options.cardResolution,
      imageTimeout: options.imageTimeout,
      imageConcurrency: options.imageConcurrency,
      imageCacheSize: options.imageCacheSize,
      maxTextureSize: this.renderer.capabilities.maxTextureSize,
      anisotropy: Math.min(4, this.renderer.capabilities.getMaxAnisotropy()),
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
  }

  setItems(items: MotionItem[]): Promise<void> {
    this.assertActive()
    validateItems(items)
    return this.setItemsAfterPendingUpdates(items)
  }

  private async setItemsAfterPendingUpdates(items: MotionItem[]): Promise<void> {
    await this.flushPendingItemUpdates()
    return this.setItemsInternal(items)
  }

  private async setItemsInternal(items: MotionItem[]): Promise<void> {
    const token = ++this.itemsToken
    this.cancelActiveTransition('interrupted')
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
    this.cards.setOrientation(this.currentOrientation)
    this.cards.setHideBackHemisphere(this.hideBackHemisphere)
    this.cards.setTransforms(nextTransforms)
    this.visibleRatio = visibleRatios[this.quality]
    this.cards.setVisibleRatio(this.visibleRatio)
    this.syncFocusedItem()
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
    const transition = this.activeTransition
    return transition
      ? {
          active: true,
          status: 'running',
          layout: transition.layout,
          progress: this.transitionProgress(transition, performance.now()),
        }
      : {
          active: false,
          status: this.lastTransitionStatus,
          layout: this.lastTransitionLayout,
          progress: this.lastTransitionStatus === 'completed' ? 1 : 0,
        }
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
      this.lastTransitionStatus = 'aborted'
      this.lastTransitionLayout = layout.name
      return Promise.resolve({ completed: false, status: 'aborted' })
    }
    const now = performance.now()
    const visualState = this.resolveCurrentVisualState(now)
    this.transforms = this.resolveCurrentTransforms(now)
    if (this.activeEffect) {
      this.activeEffect = null
      this.cards.disableEffect()
    }
    this.cancelActiveTransition('interrupted')
    const from = this.transforms
    const calculationStartedAt = performance.now()
    const target = layout.calculate(this.items.length, this.context())
    this.transformCalculationMs += performance.now() - calculationStartedAt
    this.transformCalculations += 1
    const targetOrientation = layout.orientation ?? 'surface'
    const targetHideBackHemisphere = layout.hideBackHemisphere ?? false
    const targetBillboard = targetOrientation === 'camera' ? 1 : 0
    const targetHideBack = targetHideBackHemisphere ? 1 : 0
    this.currentOrientation = targetOrientation
    this.hideBackHemisphere = targetHideBackHemisphere
    const duration = this.reducedMotion
      ? 0
      : Math.max(0, options.duration ?? this.options.transition?.duration ?? 1200)
    const ease = options.easing ?? this.options.transition?.easing ?? easing.sineInOut
    if (duration === 0) {
      this.transforms = target
      this.activeTransition = null
      this.cards.setOrientation(targetOrientation)
      this.cards.setHideBackHemisphere(targetHideBackHemisphere)
      this.cards.setTransforms(target)
      this.lastTransitionStatus = 'completed'
      this.lastTransitionLayout = layout.name
      return Promise.resolve({ completed: true, status: 'completed' })
    }
    this.cards.prepareTransition(
      from,
      target,
      visualState.billboard,
      targetBillboard,
      visualState.hideBackHemisphere,
      targetHideBack,
    )
    return new Promise<StageTransitionResult>((resolve) => {
      const transition: ActiveTransition = {
        from,
        to: target,
        elapsedMs: 0,
        lastUpdatedAt: now,
        duration,
        easing: ease,
        fromBillboard: visualState.billboard,
        toBillboard: targetBillboard,
        fromHideBackHemisphere: visualState.hideBackHemisphere,
        toHideBackHemisphere: targetHideBack,
        layout: layout.name,
        resolve,
        removeAbortListener: () => {},
      }
      const handleAbort = () => {
        if (this.activeTransition === transition) this.cancelActiveTransition('aborted')
      }
      options.signal?.addEventListener('abort', handleAbort, { once: true })
      transition.removeAbortListener = () => options.signal?.removeEventListener('abort', handleAbort)
      this.activeTransition = transition
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
    this.activeEffect = { effect, gpuData, elapsedSeconds: 0, lastUpdatedAt: performance.now() }
    return true
  }

  updateItems(items: MotionItem[], options: UpdateItemsOptions = {}): Promise<boolean> {
    this.assertActive()
    validateItems(items)
    return this.updateItemsAfterPendingUpdates(items, options)
  }

  private async updateItemsAfterPendingUpdates(
    items: MotionItem[],
    options: UpdateItemsOptions,
  ): Promise<boolean> {
    await this.flushPendingItemUpdates()
    return this.updateItemsInternal(items, options)
  }

  updateItem(id: string, patch: MotionItemPatch, options: UpdateItemsOptions = {}): Promise<boolean> {
    return this.updateItemsById([{ id, patch }], options)
  }

  updateItemsById(updates: MotionItemUpdate[], options: UpdateItemsOptions = {}): Promise<boolean> {
    this.assertActive()
    validateItemUpdates(updates)
    if (!updates.length) return Promise.resolve(true)
    if (!isBatchableItemUpdate(options)) {
      return this.updateItemsByIdAfterPendingUpdates(updates, options)
    }
    return this.queueItemUpdates(updates)
  }

  private async updateItemsByIdAfterPendingUpdates(
    updates: MotionItemUpdate[],
    options: UpdateItemsOptions,
  ): Promise<boolean> {
    await this.flushPendingItemUpdates()
    return this.updateItemsByIdInternal(updates, options)
  }

  private queueItemUpdates(updates: MotionItemUpdate[]): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      if (!this.pendingItemUpdateBatch) {
        this.pendingItemUpdateBatch = { updates: [], resolve: [], reject: [] }
        queueMicrotask(() => { void this.flushPendingItemUpdates() })
      }
      this.pendingItemUpdateBatch.updates.push(...updates)
      this.pendingItemUpdateBatch.resolve.push(resolve)
      this.pendingItemUpdateBatch.reject.push(reject)
    })
  }

  private flushPendingItemUpdates(): Promise<unknown> {
    const batch = this.pendingItemUpdateBatch
    if (!batch) return this.itemUpdateChain
    this.pendingItemUpdateBatch = null
    const mergedPatches = new Map<string, MotionItemPatch>()
    batch.updates.forEach(({ id, patch }) => {
      mergedPatches.set(id, { ...mergedPatches.get(id), ...patch })
    })
    const updates = [...mergedPatches].map(([id, patch]) => ({ id, patch }))
    const operation = this.itemUpdateChain.then(() => this.destroyed
      ? false
      : this.updateItemsByIdInternal(updates, {}))
    this.itemUpdateChain = operation.then(
      (applied) => {
        batch.resolve.forEach((resolve) => resolve(applied))
      },
      (error) => {
        batch.reject.forEach((reject) => reject(error))
      },
    )
    return operation
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
    this.syncFocusedItem()

    if (!options.layout) return true
    const completed = await this.transitionTo(options.layout, {
      duration: options.duration ?? 800,
      easing: options.easing,
    })
    if (completed) this.lastLayout = options.layout
    return completed
  }

  private async updateItemsInternal(items: MotionItem[], options: UpdateItemsOptions): Promise<boolean> {
    const now = performance.now()
    const current = this.resolveCurrentTransforms(now)
    const previousById = new Map(this.items.map((item, index) => [item.id, current[index]]))
    const token = ++this.itemsToken
    this.cancelActiveTransition('interrupted')
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
    this.cards.setOrientation(this.currentOrientation)
    this.cards.setHideBackHemisphere(this.hideBackHemisphere)
    this.cards.setTransforms(nextTransforms)
    this.cards.setVisibleRatio(this.visibleRatio)
    this.syncFocusedItem()

    const targetLayout = options.layout ?? this.lastLayout
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

  pick(clientX: number, clientY: number, options: number | PickOptions = {}): PickResult | null {
    this.assertActive()
    const startedAt = performance.now()
    try {
      return this.pickInternal(clientX, clientY, options)
    } finally {
      this.pickingMs += performance.now() - startedAt
      this.pickOperations += 1
    }
  }

  focusItem(id: string): boolean {
    this.assertActive()
    const index = this.items.findIndex((item) => item.id === id)
    if (index < 0 || visibilityRank(index) > this.visibleRatio) return false
    this.setFocusedIndex(index)
    this.renderer.domElement.focus()
    return true
  }

  getFocusedItem(): MotionItem | null {
    this.assertActive()
    const index = this.focusedIndex()
    return index === null ? null : this.items[index]
  }

  private pickInternal(clientX: number, clientY: number, options: number | PickOptions): PickResult | null {
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
    return new Timeline((duration) => this.waitOnStageClock(duration))
  }

  async addExtension(extension: StageExtension): Promise<StageExtensionHandle> {
    this.assertActive()
    if (!extension || typeof extension.mount !== 'function') {
      throw new TypeError('Stage extension must provide a mount(context) function')
    }

    const root = new Group()
    root.name = `SpatialMotionExtension:${extension.name ?? 'anonymous'}`
    const sequence = this.extensionSequence++
    const record: StageExtensionRecord = {
      id: sequence + 1,
      order: Number.isFinite(extension.order) ? extension.order as number : 0,
      sequence,
      extension,
      root,
      abortController: new AbortController(),
      active: true,
      enabled: true,
      mounted: false,
      disposed: false,
      archived: false,
      paused: false,
      hasUpdated: false,
      elapsed: 0,
      updateCalls: 0,
      updateTotalMs: 0,
      updateSamples: [],
      maximumUpdateMs: 0,
      slowFrames: 0,
      errorCount: 0,
      lastError: null,
    }
    this.extensions.add(record)
    this.scene.add(root)

    const context: StageExtensionContext = {
      root,
      camera: this.camera,
      signal: record.abortController.signal,
    }

    try {
      await extension.mount(context)
      record.mounted = true
      if (!record.active || this.destroyed) {
        this.disposeExtensionRecord(record)
        throw new Error('MotionStage was destroyed or the extension was removed during mount')
      }
      extension.qualityChange?.(this.quality)
      extension.reducedMotionChange?.(this.reducedMotion)
      extension.resize?.(this.extensionViewport())
      this.syncExtensionPaused(record)
    } catch (error) {
      const cancelled = !record.active || this.destroyed
      if (!cancelled) this.recordExtensionError(record, error)
      record.mounted = true
      if (record.active) this.removeExtensionRecord(record)
      else this.disposeExtensionRecord(record)
      if (!cancelled) this.reportExtensionError(error, extension)
      throw error
    }

    return {
      get active() { return record.active },
      get enabled() { return record.active && record.enabled },
      enable: () => this.setExtensionEnabled(record, true),
      disable: () => this.setExtensionEnabled(record, false),
      remove: () => this.removeExtensionRecord(record),
    }
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
    const viewport = this.extensionViewport()
    for (const record of this.orderedExtensions()) {
      if (!record.active || !record.mounted || !record.enabled || !record.extension.resize) continue
      try {
        record.extension.resize(viewport)
      } catch (error) {
        this.failExtension(record, error)
      }
    }
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.itemsToken += 1
    this.cancelActiveTransition('destroyed')
    cancelAnimationFrame(this.frameId)
    this.frameId = 0
    this.resizeObserver.disconnect()
    this.renderer.domElement.removeEventListener('pointerup', this.handlePointerUp)
    this.renderer.domElement.removeEventListener('webglcontextlost', this.handleContextLost)
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.handleContextRestored)
    this.renderer.domElement.removeEventListener('pointermove', this.handlePointerMove)
    this.renderer.domElement.removeEventListener('pointerleave', this.handlePointerLeave)
    this.motionQuery?.removeEventListener('change', this.handleMotionPreferenceChange)
    document.removeEventListener('visibilitychange', this.handleVisibilityChange)
    this.renderer.domElement.removeEventListener('keydown', this.handleKeyDown)
    this.renderer.domElement.removeEventListener('focus', this.handleCanvasFocus)
    this.renderer.domElement.removeEventListener('blur', this.handleCanvasBlur)
    for (const wait of this.stageWaits) wait.complete(false)
    this.stageWaits.clear()
    for (const extension of this.orderedExtensions()) this.removeExtensionRecord(extension)
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
      submittedItems: cardStats.submittedInstanceCount,
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
      contextLost: this.pausedByContext,
      frameCpuMs: this.frameCpuMs,
      renderSubmitMs: this.renderSubmitMs,
      transformCalculationMs: this.transformCalculationMs,
      transformCalculations: this.transformCalculations,
      pickingMs: this.pickingMs,
      pickOperations: this.pickOperations,
      atlasBuilds: cardStats.atlasBuilds,
      atlasPatches: cardStats.atlasPatches,
      atlasDiscardedBuilds: cardStats.atlasDiscardedBuilds,
      atlasDiscardedPatches: cardStats.atlasDiscardedPatches,
      atlasCellsUpdated: cardStats.atlasCellsUpdated,
      atlasBuildMs: cardStats.atlasBuildMs,
      atlasPatchMs: cardStats.atlasPatchMs,
      atlasDrawMs: cardStats.atlasDrawMs,
      imageLoadMs: cardStats.imageLoadMs,
      imageRequests: cardStats.imageRequests,
      imageFailures: cardStats.imageFailures,
      estimatedTextureUploadBytes: cardStats.estimatedTextureUploadBytes,
      extensions: this.extensions.size,
      extensionUpdateMs: this.extensionUpdateMs,
    }
  }

  getExtensionStats(): StageExtensionStats[] {
    this.assertActive()
    return [
      ...this.orderedExtensions().map((record) => extensionStats(record)),
      ...this.extensionHistory.map((stats) => ({ ...stats })),
    ]
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
    }
  }

  private resolveCurrentTransforms(now: number): Transform[] {
    if (this.activeEffect) {
      return this.activeEffect.effect.calculateTransforms(
        this.items.length,
        this.effectElapsedSeconds(this.activeEffect, now),
      )
    }
    if (!this.activeTransition) return this.transforms.map((transform) => ({ ...transform }))
    const { from, to, easing: transitionEasing } = this.activeTransition
    const progress = transitionEasing(this.transitionProgress(this.activeTransition, now))
    return to.map((transform, index) =>
      interpolateTransform(from[index] ?? identityTransform(), transform, progress),
    )
  }

  private resolveCurrentVisualState(now: number): { billboard: number; hideBackHemisphere: number } {
    if (this.activeEffect) return { billboard: 1, hideBackHemisphere: 0 }
    if (!this.activeTransition) {
      return {
        billboard: this.currentOrientation === 'camera' ? 1 : 0,
        hideBackHemisphere: this.hideBackHemisphere ? 1 : 0,
      }
    }
    const transition = this.activeTransition
    const progress = transition.easing(this.transitionProgress(transition, now))
    return {
      billboard: transition.fromBillboard
        + (transition.toBillboard - transition.fromBillboard) * progress,
      hideBackHemisphere: transition.fromHideBackHemisphere
        + (transition.toHideBackHemisphere - transition.fromHideBackHemisphere) * progress,
    }
  }

  private transitionProgress(transition: ActiveTransition, now: number): number {
    const pendingMs = this.isPaused() ? 0 : Math.max(0, now - transition.lastUpdatedAt)
    return Math.min(1, (transition.elapsedMs + pendingMs) / transition.duration)
  }

  private effectElapsedSeconds(effect: ActiveEffect, now: number): number {
    const pendingSeconds = this.isPaused() ? 0 : Math.max(0, now - effect.lastUpdatedAt) / 1000
    return effect.elapsedSeconds + pendingSeconds
  }

  private advanceTransition(now: number): void {
    const transition = this.activeTransition
    if (!transition) return
    transition.elapsedMs += Math.max(0, now - transition.lastUpdatedAt)
    transition.lastUpdatedAt = now
    const progress = Math.min(1, transition.elapsedMs / transition.duration)
    this.cards.setProgress(transition.easing(progress))
    if (progress < 1) return
    this.transforms = transition.to
    this.activeTransition = null
    transition.removeAbortListener()
    this.lastTransitionStatus = 'completed'
    this.lastTransitionLayout = transition.layout
    transition.resolve({ completed: true, status: 'completed' })
  }

  private cancelActiveTransition(status: 'interrupted' | 'aborted' | 'destroyed'): void {
    const transition = this.activeTransition
    if (!transition) return
    this.activeTransition = null
    transition.removeAbortListener()
    this.lastTransitionStatus = status
    this.lastTransitionLayout = transition.layout
    transition.resolve({ completed: false, status })
  }

  private readonly render = (now: number) => {
    const frameCpuStartedAt = performance.now()
    const rawFrameMs = now - this.lastFrame || 0
    const delta = Math.min(0.05, rawFrameMs / 1000)
    this.lastFrame = now
    this.advanceStageWaits(rawFrameMs)
    this.advanceTransition(now)
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
      this.activeEffect.elapsedSeconds += Math.max(0, now - this.activeEffect.lastUpdatedAt) / 1000
      this.activeEffect.lastUpdatedAt = now
      this.cards.setEffectTime(this.activeEffect.elapsedSeconds)
    }
    this.updateExtensions(delta)
    this.frameCpuMs = performance.now() - frameCpuStartedAt
    const renderStartedAt = performance.now()
    this.renderer.render(this.scene, this.camera)
    this.renderSubmitMs = performance.now() - renderStartedAt
    if (!this.isPaused()) this.frameId = requestAnimationFrame(this.render)
  }

  private applyQuality(quality: QualityLevel): void {
    this.quality = quality
    const profile = qualityProfiles[quality]
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, profile.maxPixelRatio))
    this.cards.setVisibleRatio(visibleRatios[quality])
    this.visibleRatio = visibleRatios[quality]
    this.syncFocusedItem()
    if (this.activeEffect) {
      const now = performance.now()
      this.activeEffect.elapsedSeconds = this.effectElapsedSeconds(this.activeEffect, now)
      this.activeEffect.lastUpdatedAt = now
      this.activeEffect.effect.prepare(this.items.length, profile.maxActiveEffectItems)
      this.activeEffect.gpuData = this.activeEffect.effect.getGpuData()
      this.cards.enableEffect(this.activeEffect.gpuData)
      this.cards.setEffectTime(this.activeEffect.elapsedSeconds)
    }
    this.notifyExtensions('qualityChange', quality)
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
    this.setExtensionsPaused(false)
    const now = performance.now()
    this.lastFrame = now
    if (this.activeTransition) this.activeTransition.lastUpdatedAt = now
    if (this.activeEffect) this.activeEffect.lastUpdatedAt = now
    this.frameId = requestAnimationFrame(this.render)
  }

  private stopRenderLoop(): void {
    this.setExtensionsPaused(true)
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
    for (const wait of [...this.stageWaits]) {
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

  private orderedExtensions(): StageExtensionRecord[] {
    return [...this.extensions].sort((left, right) =>
      left.order - right.order || left.sequence - right.sequence)
  }

  private setExtensionEnabled(record: StageExtensionRecord, enabled: boolean): void {
    if (!record.active || record.enabled === enabled) return
    record.enabled = enabled
    record.root.visible = enabled
    if (enabled && record.mounted && record.extension.resize) {
      try {
        record.extension.resize(this.extensionViewport())
      } catch (error) {
        this.failExtension(record, error)
        return
      }
    }
    this.syncExtensionPaused(record)
  }

  private syncExtensionPaused(record: StageExtensionRecord, stagePaused = this.isPaused()): void {
    if (!record.active || !record.mounted) return
    const paused = stagePaused || !record.enabled
    if (record.paused === paused) return
    record.paused = paused
    const callback = paused ? record.extension.pause : record.extension.resume
    if (!callback) return
    try {
      callback.call(record.extension)
    } catch (error) {
      this.failExtension(record, error)
    }
  }

  private notifyExtensions(
    callbackName: 'qualityChange' | 'reducedMotionChange',
    value: QualityLevel | boolean,
  ): void {
    for (const record of this.orderedExtensions()) {
      if (!record.active || !record.mounted) continue
      try {
        if (callbackName === 'qualityChange') {
          record.extension.qualityChange?.(value as QualityLevel)
        } else {
          record.extension.reducedMotionChange?.(value as boolean)
        }
      } catch (error) {
        this.failExtension(record, error)
      }
    }
  }

  private recordExtensionUpdate(record: StageExtensionRecord, durationMs: number): void {
    const duration = Math.max(0, durationMs)
    record.updateCalls += 1
    record.updateTotalMs += duration
    record.maximumUpdateMs = Math.max(record.maximumUpdateMs, duration)
    if (duration > SLOW_EXTENSION_UPDATE_MS) record.slowFrames += 1
    record.updateSamples.push(duration)
    if (record.updateSamples.length > EXTENSION_SAMPLE_LIMIT) record.updateSamples.shift()
  }

  private recordExtensionError(record: StageExtensionRecord, error: unknown): void {
    record.errorCount += 1
    record.lastError = error instanceof Error ? error.message : String(error)
  }

  private updateExtensions(delta: number): void {
    const startedAt = performance.now()
    for (const record of this.orderedExtensions()) {
      if (!record.active || !record.mounted || !record.enabled || !record.extension.update) continue
      const extensionDelta = record.hasUpdated ? delta : 0
      record.hasUpdated = true
      record.elapsed += extensionDelta
      const extensionStartedAt = performance.now()
      try {
        record.extension.update({ elapsed: record.elapsed, delta: extensionDelta })
      } catch (error) {
        this.failExtension(record, error)
      } finally {
        this.recordExtensionUpdate(record, performance.now() - extensionStartedAt)
      }
    }
    this.extensionUpdateMs = performance.now() - startedAt
  }

  private setExtensionsPaused(paused: boolean): void {
    for (const record of this.orderedExtensions()) this.syncExtensionPaused(record, paused)
  }

  private failExtension(record: StageExtensionRecord, error: unknown): void {
    this.recordExtensionError(record, error)
    this.removeExtensionRecord(record)
    this.reportExtensionError(error, record.extension)
  }

  private removeExtensionRecord(record: StageExtensionRecord): void {
    if (!record.active) return
    record.active = false
    record.abortController.abort()
    this.extensions.delete(record)
    record.root.removeFromParent()
    if (record.mounted) this.disposeExtensionRecord(record)
  }

  private disposeExtensionRecord(record: StageExtensionRecord): void {
    if (record.disposed) return
    record.disposed = true
    try {
      record.extension.dispose?.()
    } catch (error) {
      this.recordExtensionError(record, error)
      this.reportExtensionError(error, record.extension)
    } finally {
      record.root.clear()
      this.archiveExtensionRecord(record)
    }
  }

  private archiveExtensionRecord(record: StageExtensionRecord): void {
    if (record.archived || record.active) return
    record.archived = true
    this.extensionHistory.unshift({ ...extensionStats(record), active: false, enabled: false })
    if (this.extensionHistory.length > EXTENSION_HISTORY_LIMIT) this.extensionHistory.pop()
  }

  private reportExtensionError(error: unknown, extension: StageExtension): void {
    try {
      this.options.onExtensionError?.(error, extension)
    } catch {
      // An error observer must not break the Stage render or cleanup path.
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
    this.cards.refreshTexture()
    this.startRenderLoop()
    this.options.onContextChange?.('restored')
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
    this.updateInteractionHighlight()
    this.options.onItemHover?.(result?.item ?? null, index)
  }

  private readonly handlePointerLeave = () => {
    if (this.destroyed || this.hoveredIndex === null) return
    this.hoveredIndex = null
    this.updateInteractionHighlight()
    this.options.onItemHover?.(null, null)
  }

  private readonly handleCanvasFocus = () => {
    if (this.destroyed || this.focusedIndex() !== null) return
    const first = this.visibleItemIndices()[0]
    if (first !== undefined) this.setFocusedIndex(first)
  }

  private readonly handleCanvasBlur = () => {
    if (this.destroyed) return
    this.setFocusedIndex(null)
  }

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (this.destroyed) return
    const visible = this.visibleItemIndices()
    if (!visible.length) return
    const current = this.focusedIndex()
    const position = current === null ? -1 : visible.indexOf(current)
    let next: number | undefined
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = visible[(position + 1 + visible.length) % visible.length]
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        next = visible[(position - 1 + visible.length) % visible.length]
        break
      case 'Home':
        next = visible[0]
        break
      case 'End':
        next = visible.at(-1)
        break
      case 'Enter':
      case ' ':
        if (current !== null) {
          event.preventDefault()
          this.options.onItemClick?.(this.items[current], current)
        }
        return
      default:
        return
    }
    event.preventDefault()
    if (next !== undefined) this.setFocusedIndex(next)
  }

  private focusedIndex(): number | null {
    if (this.focusedItemId === null) return null
    const index = this.items.findIndex((item) => item.id === this.focusedItemId)
    return index >= 0 ? index : null
  }

  private visibleItemIndices(): number[] {
    return this.items
      .map((_item, index) => visibilityRank(index) <= this.visibleRatio ? index : -1)
      .filter((index) => index >= 0)
  }

  private setFocusedIndex(index: number | null): void {
    const previousId = this.focusedItemId
    const item = index === null ? null : this.items[index] ?? null
    this.focusedItemId = item?.id ?? null
    this.updateInteractionHighlight()
    this.updateAriaLabel(item, index)
    if (previousId !== this.focusedItemId) this.options.onItemFocus?.(item, item ? index : null)
  }

  private syncFocusedItem(): void {
    const index = this.focusedIndex()
    if (this.focusedItemId !== null && (index === null || visibilityRank(index) > this.visibleRatio)) {
      this.setFocusedIndex(null)
    }
    else if (index !== null) {
      this.updateInteractionHighlight()
      this.updateAriaLabel(this.items[index], index)
    }
  }

  private updateInteractionHighlight(): void {
    const index = (this.options.hoverEffect === 'highlight' ? this.hoveredIndex : null) ?? this.focusedIndex()
    this.cards.setHoverIndex(index)
  }

  private updateAriaLabel(item: MotionItem | null, index: number | null): void {
    if (!this.keyboardNavigation) return
    const detail = item && index !== null
      ? `: ${item.title?.trim() || item.id} (${index + 1} of ${this.items.length})`
      : ''
    this.renderer.domElement.setAttribute('aria-label', `${this.baseAriaLabel}${detail}`)
  }

  private readonly handleMotionPreferenceChange = (event: MediaQueryListEvent) => {
    if (this.destroyed || this.motionPreference !== 'auto') return
    this.reducedMotion = event.matches
    this.notifyExtensions('reducedMotionChange', this.reducedMotion)
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

const EXTENSION_SAMPLE_LIMIT = 120
const EXTENSION_HISTORY_LIMIT = 20
const SLOW_EXTENSION_UPDATE_MS = 2

function extensionStats(record: StageExtensionRecord): StageExtensionStats {
  const orderedSamples = [...record.updateSamples].sort((left, right) => left - right)
  return {
    id: record.id,
    name: record.extension.name ?? 'anonymous',
    order: record.order,
    active: record.active,
    enabled: record.active && record.enabled,
    updateCalls: record.updateCalls,
    averageUpdateMs: record.updateCalls ? record.updateTotalMs / record.updateCalls : 0,
    updateTimeP95: percentile(orderedSamples, 0.95),
    updateTimeP99: percentile(orderedSamples, 0.99),
    maximumUpdateMs: record.maximumUpdateMs,
    slowFrames: record.slowFrames,
    errorCount: record.errorCount,
    lastError: record.lastError,
  }
}

function percentile(orderedValues: number[], fraction: number): number {
  if (!orderedValues.length) return 0
  return orderedValues[Math.min(orderedValues.length - 1, Math.floor(orderedValues.length * fraction))]
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

function isBatchableItemUpdate(options: UpdateItemsOptions): boolean {
  return options.layout === undefined
    && options.duration === undefined
    && options.easing === undefined
}
