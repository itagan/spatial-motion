import type {
  Layout,
  LayoutContext,
  MotionItem,
  TransitionOptions,
} from './types.js'
import type { CompiledRendererRuntime } from './CompiledRendererRuntime.js'
import {
  calculateLayoutInto,
  TransformBuffer,
  type TransformBufferView,
} from './TransformBuffer.js'
import {
  ItemCoordinator,
  type CoordinatedItemUpdate,
} from './ItemCoordinator.js'
import type { MotionController } from './MotionController.js'
import type { EffectController } from './EffectController.js'
import type { InteractionController } from './InteractionController.js'
import type { QualityController } from './QualityController.js'
import type { RendererStateCoordinator } from './RendererStateCoordinator.js'
import type { StageContentState } from './StageContentState.js'
import {
  ContentTransformPool,
  type ContentTransformPoolStats,
} from './ContentTransformPool.js'

export interface StageContentUpdateOptions<TMeta = unknown> extends TransitionOptions {
  layout?: Layout<TMeta>
}

interface StageContentCoordinatorOptions<TMeta> {
  state: StageContentState<TMeta>
  renderer: CompiledRendererRuntime<TMeta>
  motion: MotionController
  effects: EffectController
  interaction: InteractionController<TMeta>
  quality: QualityController
  rendererState: RendererStateCoordinator<TMeta>
  resolveTransformBuffer: (now: number) => TransformBufferView
  getLayoutContext: () => LayoutContext<TMeta>
  transitionTo: (layout: Layout<TMeta>, options: TransitionOptions) => Promise<boolean>
  isPaused: () => boolean
  isDestroyed: () => boolean
}

export class StageContentCoordinator<TMeta = unknown> {
  readonly items: ItemCoordinator<TMeta>
  private readonly transformPool = new ContentTransformPool()
  private retainedTransforms: TransformBuffer | null = null

  constructor(private readonly options: StageContentCoordinatorOptions<TMeta>) {
    this.items = new ItemCoordinator({
      applyPatches: (updates) => this.updateItemsByIdInternal(updates, {}),
      isDestroyed: options.isDestroyed,
    })
  }

  validateItems(items: readonly MotionItem<TMeta>[]): void {
    this.items.validateItems(items)
  }

  validateUpdates(updates: readonly CoordinatedItemUpdate<TMeta>[]): void {
    this.items.validateUpdates(updates)
  }

  invalidate(): void {
    this.items.invalidate()
    this.retainedTransforms = null
    this.transformPool.dispose()
  }

  getTransformPoolStats(): ContentTransformPoolStats {
    return this.transformPool.getStats()
  }

  async setItems(items: readonly MotionItem<TMeta>[]): Promise<void> {
    await this.items.flushPatches()
    if (this.options.isDestroyed()) return
    return this.setItemsInternal(items)
  }

  async setItemsInternal(items: readonly MotionItem<TMeta>[]): Promise<void> {
    const revision = this.items.beginOperation()
    this.options.motion.cancel('interrupted')
    this.options.effects.deactivate()
    const prepared = this.items.prepareItems(
      items,
      this.options.quality.getProfile().maxVisibleItems,
    )
    const nextTransforms = this.acquireIdentityBuffer(prepared.visibleItems.length)
    let applied: boolean
    try {
      applied = await this.options.renderer.setItems(prepared.visibleItems)
    } catch (error) {
      this.transformPool.release(nextTransforms)
      throw error
    }
    if (!applied || !this.items.isCurrent(revision)) {
      this.transformPool.release(nextTransforms)
      return
    }
    this.commitItems(prepared.sourceItems, prepared.visibleItems, nextTransforms)
  }

  async updateItems(
    items: readonly MotionItem<TMeta>[],
    options: StageContentUpdateOptions<TMeta>,
  ): Promise<boolean> {
    await this.items.flushPatches()
    if (this.options.isDestroyed()) return false
    return this.updateItemsInternal(items, options)
  }

  updateItemsById(
    updates: CoordinatedItemUpdate<TMeta>[],
    options: StageContentUpdateOptions<TMeta>,
  ): Promise<boolean> {
    if (!updates.length) return Promise.resolve(true)
    if (!isBatchableItemUpdate(options)) {
      return this.updateItemsByIdAfterPendingUpdates(updates, options)
    }
    return this.items.queuePatches(updates)
  }

  async updateItemsInternal(
    items: readonly MotionItem<TMeta>[],
    options: StageContentUpdateOptions<TMeta>,
    preserveEffect = false,
  ): Promise<boolean> {
    const state = this.options.state
    const now = performance.now()
    const current = this.options.resolveTransformBuffer(now)
    const currentEffect = preserveEffect ? this.options.effects.getToken() : null
    const revision = this.items.beginOperation()
    this.options.motion.cancel('interrupted')
    if (!preserveEffect) this.options.effects.deactivate()
    const snapshot = this.transformPool.acquire(current.count).copyFromBuffer(current)
    state.transforms = snapshot
    this.releaseRetainedTransforms()
    this.options.renderer.setTransforms(state.transforms)

    const prepared = this.items.prepareItems(
      items,
      this.options.quality.getProfile().maxVisibleItems,
    )
    const nextTransforms = this.acquireIdentityBuffer(prepared.visibleItems.length)
    prepared.visibleItems.forEach((item, index) => {
      const previous = state.getItemIndex(item.id)
      if (previous !== undefined && previous < snapshot.count) {
        nextTransforms.setFromBuffer(index, snapshot, previous)
      }
    })
    let applied: boolean
    try {
      applied = await this.options.renderer.setItems(prepared.visibleItems)
    } catch (error) {
      this.finishRejectedUpdate(revision, snapshot, nextTransforms)
      throw error
    }
    if (!applied || !this.items.isCurrent(revision)) {
      this.finishRejectedUpdate(revision, snapshot, nextTransforms)
      return false
    }
    this.transformPool.release(snapshot)
    this.commitItems(prepared.sourceItems, prepared.visibleItems, nextTransforms)

    const targetLayout = options.layout ?? state.lastLayout
    if (this.options.effects.isTokenActive(currentEffect)) {
      if (targetLayout) {
        state.transforms = calculateLayoutInto(
          targetLayout,
          state.items.length,
          this.options.getLayoutContext(),
          nextTransforms,
        )
        this.options.renderer.setTransforms(state.transforms)
        if (options.layout) state.lastLayout = options.layout
      }
      const profile = this.options.quality.getProfile()
      await this.options.effects.reconfigure(
        state.items.length,
        profile.maxActiveEffectItems,
        performance.now(),
        this.options.isPaused(),
      )
      return true
    }
    if (!targetLayout) return true
    const completed = await this.options.transitionTo(targetLayout, {
      duration: options.duration ?? 800,
      easing: options.easing,
    })
    if (completed && options.layout) state.lastLayout = options.layout
    return completed
  }

  private async updateItemsByIdAfterPendingUpdates(
    updates: CoordinatedItemUpdate<TMeta>[],
    options: StageContentUpdateOptions<TMeta>,
  ): Promise<boolean> {
    await this.items.flushPatches()
    return this.updateItemsByIdInternal(updates, options)
  }

  private async updateItemsByIdInternal(
    updates: CoordinatedItemUpdate<TMeta>[],
    options: StageContentUpdateOptions<TMeta>,
  ): Promise<boolean> {
    if (!updates.length) return true
    const state = this.options.state
    const maxItems = Math.max(
      state.items.length,
      this.options.quality.getProfile().maxVisibleItems,
    )
    const prepared = this.items.preparePatch(state.sourceItems, updates, maxItems)
    const revision = this.items.beginOperation()
    const applied = await this.options.renderer.updateItems(
      prepared.visibleItems,
      prepared.changedIndices,
    )
    if (!applied || !this.items.isCurrent(revision)) return false
    state.sourceItems = prepared.sourceItems
    state.setItems(prepared.visibleItems)
    state.inputItemCount = prepared.sourceItems.length
    state.visibleRatio = state.items.length
      ? Math.min(1, this.options.quality.getProfile().maxVisibleItems / state.items.length)
      : 1
    if (!this.options.renderer.supportsPatch) {
      this.options.rendererState.restoreAfterItems({
        transforms: state.transforms,
        visual: state.getVisualState(),
        visibleRatio: state.visibleRatio,
        now: performance.now(),
        paused: this.options.isPaused(),
      })
    }
    this.options.renderer.setVisibleRatio(state.visibleRatio)
    this.options.interaction.syncItems()

    if (!options.layout) return true
    const completed = await this.options.transitionTo(options.layout, {
      duration: options.duration ?? 800,
      easing: options.easing,
    })
    if (completed) state.lastLayout = options.layout
    return completed
  }

  private commitItems(
    sourceItems: MotionItem<TMeta>[],
    items: MotionItem<TMeta>[],
    transforms: TransformBuffer,
  ): void {
    const state = this.options.state
    state.sourceItems = sourceItems
    state.setItems(items)
    state.inputItemCount = sourceItems.length
    state.transforms = transforms
    this.retainTransforms(transforms)
    this.options.renderer.setVisualState(state.getVisualState())
    this.options.renderer.setTransforms(transforms)
    state.visibleRatio = 1
    this.options.renderer.setVisibleRatio(1)
    this.options.interaction.syncItems()
  }

  private acquireIdentityBuffer(count: number): TransformBuffer {
    const buffer = this.transformPool.acquire(count)
    buffer.positions.fill(0, 0, count * 3)
    buffer.rotations.fill(0, 0, count * 3)
    buffer.scales.fill(0.01, 0, count)
    buffer.opacities.fill(1, 0, count)
    return buffer
  }

  private finishRejectedUpdate(
    revision: number,
    snapshot: TransformBuffer,
    next: TransformBuffer,
  ): void {
    this.transformPool.release(next)
    if (this.items.isCurrent(revision)) this.retainTransforms(snapshot)
    else this.transformPool.release(snapshot)
  }

  private retainTransforms(buffer: TransformBuffer): void {
    if (this.retainedTransforms === buffer) return
    this.releaseRetainedTransforms()
    this.retainedTransforms = buffer
  }

  private releaseRetainedTransforms(): void {
    if (!this.retainedTransforms) return
    this.transformPool.release(this.retainedTransforms)
    this.retainedTransforms = null
  }
}

function isBatchableItemUpdate(options: StageContentUpdateOptions): boolean {
  return options.layout === undefined
    && options.duration === undefined
    && options.easing === undefined
}
