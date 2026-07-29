import type {
  Layout,
  LayoutContext,
  MotionItem,
  Transform,
  TransitionOptions,
} from './types.js'
import type { CompiledRendererRuntime } from './CompiledRendererRuntime.js'
import { identityTransform } from './math.js'
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
  resolveTransforms: (now: number) => Transform[]
  getLayoutContext: () => LayoutContext<TMeta>
  transitionTo: (layout: Layout<TMeta>, options: TransitionOptions) => Promise<boolean>
  isPaused: () => boolean
  isDestroyed: () => boolean
}

export class StageContentCoordinator<TMeta = unknown> {
  readonly items: ItemCoordinator<TMeta>

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
  }

  async setItems(items: readonly MotionItem<TMeta>[]): Promise<void> {
    await this.items.flushPatches()
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
    const nextTransforms = prepared.visibleItems.map(identityTransform)
    const applied = await this.options.renderer.setItems(prepared.visibleItems)
    if (!applied || !this.items.isCurrent(revision)) return
    this.commitItems(prepared.sourceItems, prepared.visibleItems, nextTransforms)
  }

  async updateItems(
    items: readonly MotionItem<TMeta>[],
    options: StageContentUpdateOptions<TMeta>,
  ): Promise<boolean> {
    await this.items.flushPatches()
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
    const current = this.options.resolveTransforms(now)
    const previousById = new Map(
      state.items.map((item, index) => [item.id, current[index]]),
    )
    const currentEffect = preserveEffect ? this.options.effects.getToken() : null
    const revision = this.items.beginOperation()
    this.options.motion.cancel('interrupted')
    if (!preserveEffect) this.options.effects.deactivate()
    state.transforms = current
    this.options.renderer.setTransforms(current)

    const prepared = this.items.prepareItems(
      items,
      this.options.quality.getProfile().maxVisibleItems,
    )
    const nextTransforms = prepared.visibleItems.map((item) => {
      const previous = previousById.get(item.id)
      return previous ? { ...previous } : identityTransform()
    })
    const applied = await this.options.renderer.setItems(prepared.visibleItems)
    if (!applied || !this.items.isCurrent(revision)) return false
    this.commitItems(prepared.sourceItems, prepared.visibleItems, nextTransforms)

    const targetLayout = options.layout ?? state.lastLayout
    if (this.options.effects.isTokenActive(currentEffect)) {
      if (targetLayout) {
        state.transforms = [...targetLayout.calculate(
          state.items.length,
          this.options.getLayoutContext(),
        )]
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
    state.items = prepared.visibleItems
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
    transforms: Transform[],
  ): void {
    const state = this.options.state
    state.sourceItems = sourceItems
    state.items = items
    state.inputItemCount = sourceItems.length
    state.transforms = transforms
    this.options.renderer.setVisualState(state.getVisualState())
    this.options.renderer.setTransforms(transforms)
    state.visibleRatio = 1
    this.options.renderer.setVisibleRatio(1)
    this.options.interaction.syncItems()
  }
}

function isBatchableItemUpdate(options: StageContentUpdateOptions): boolean {
  return options.layout === undefined
    && options.duration === undefined
    && options.easing === undefined
}
