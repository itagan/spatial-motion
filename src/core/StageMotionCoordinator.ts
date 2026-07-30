import type { StreamingEffect } from '../effects/types.js'
import type {
  MotionRendererVisualState,
} from '../renderers/MotionRenderer.js'
import type { CompiledRendererRuntime } from './CompiledRendererRuntime.js'
import type { EffectController } from './EffectController.js'
import { easing } from './math.js'
import type {
  MotionController,
  MotionTransitionResult,
} from './MotionController.js'
import type { QualityController } from './QualityController.js'
import type { StageContentState } from './StageContentState.js'
import {
  calculateLayoutInto,
  TransformBuffer,
  type TransformBufferView,
} from './TransformBuffer.js'
import type {
  Layout,
  LayoutContext,
  TransitionOptions,
} from './types.js'

interface FocusOptions extends TransitionOptions {
  columns?: number
  gap?: number
  scale?: number
  z?: number
  dimOpacity?: number
}

interface StageMotionCoordinatorOptions<TMeta> {
  state: StageContentState<TMeta>
  renderer: CompiledRendererRuntime<TMeta>
  motion: MotionController
  effects: EffectController
  quality: QualityController
  defaultTransition?: TransitionOptions
  getLayoutContext: () => LayoutContext<TMeta>
  isPaused: () => boolean
  isReducedMotion: () => boolean
  isDestroyed: () => boolean
  onTransitionStart: (layout: string) => void
  onTransitionEnd: (layout: string, result: MotionTransitionResult) => void
}

export class StageMotionCoordinator<TMeta = unknown> {
  transformCalculationMs = 0
  transformCalculations = 0
  private lazyEntryGeneration = 0
  private readonly fromTransforms = new TransformBuffer()
  private readonly targetTransforms = new TransformBuffer()

  constructor(private readonly options: StageMotionCoordinatorOptions<TMeta>) {}

  async transitionAndRemember(
    layout: Layout<TMeta>,
    options: TransitionOptions,
  ): Promise<boolean> {
    const completed = await this.transition(layout, options)
    if (completed) this.options.state.lastLayout = layout
    return completed
  }

  async transition(
    layout: Layout<TMeta>,
    options: TransitionOptions = {},
  ): Promise<boolean> {
    return (await this.transitionResult(layout, options)).completed
  }

  transitionResult(
    layout: Layout<TMeta>,
    options: TransitionOptions = {},
  ): Promise<MotionTransitionResult> {
    this.invalidate()
    return this.runTransitionResult(layout, options)
  }

  private runTransitionResult(
    layout: Layout<TMeta>,
    options: TransitionOptions,
  ): Promise<MotionTransitionResult> {
    const {
      state,
      renderer,
      motion,
      effects,
    } = this.options
    if (options.signal?.aborted) {
      return Promise.resolve(motion.settle(layout.name, 'aborted'))
    }
    this.options.onTransitionStart(layout.name)
    const now = performance.now()
    const visualState = this.resolveVisualState(now)
    state.transforms = this.fromTransforms.copyFromBuffer(
      this.resolveTransformBuffer(now),
    )
    effects.deactivate()
    motion.cancel('interrupted')
    const from = state.transforms
    const calculationStartedAt = performance.now()
    const target = calculateLayoutInto(
      layout,
      state.items.length,
      this.options.getLayoutContext(),
      this.targetTransforms,
    )
    this.transformCalculationMs += performance.now() - calculationStartedAt
    this.transformCalculations += 1
    const targetOrientation = layout.orientation ?? 'surface'
    const targetHideBackHemisphere = layout.hideBackHemisphere ?? false
    const targetHemisphereEdgeFade = layout.hemisphereEdgeFade ?? 0
    const targetVisualState = {
      billboard: targetOrientation === 'camera' ? 1 : 0,
      hideBackHemisphere: targetHideBackHemisphere ? 1 : 0,
      hemisphereEdgeFade: targetHemisphereEdgeFade,
    }
    state.setVisual(
      targetOrientation,
      targetHideBackHemisphere,
      targetHemisphereEdgeFade,
    )
    const duration = this.options.isReducedMotion()
      ? 0
      : Math.max(
          0,
          options.duration
            ?? this.options.defaultTransition?.duration
            ?? 1200,
        )
    const ease = options.easing
      ?? this.options.defaultTransition?.easing
      ?? easing.sineInOut
    if (duration === 0) {
      state.transforms = target
      renderer.setVisualState(targetVisualState)
      renderer.setTransforms(target)
      const result = motion.settle(layout.name, 'completed')
      this.options.onTransitionEnd(layout.name, result)
      return Promise.resolve(result)
    }
    renderer.prepareTransition(from, target)
    renderer.prepareVisualTransition(visualState, targetVisualState)
    return motion.start({
      from,
      to: target,
      fromVisual: visualState,
      toVisual: targetVisualState,
      targetLayout: layout,
      duration,
      easing: ease,
      now,
      signal: options.signal,
    }).then((result) => {
      this.options.onTransitionEnd(layout.name, result)
      return result
    })
  }

  async enterEffect(
    effect: StreamingEffect,
    options: TransitionOptions,
  ): Promise<boolean> {
    const generation = ++this.lazyEntryGeneration
    const { enterEffect } = await import('./StageEffectEntry.js')
    if (
      generation !== this.lazyEntryGeneration
      || this.options.isDestroyed()
    ) return false
    const { state, effects, quality } = this.options
    return enterEffect(
      effect,
      options,
      state.items.length,
      effects,
      quality,
      this.options.isReducedMotion,
      (layout, transitionOptions) =>
        this.transitionEffectEntry(layout, transitionOptions),
      () =>
        generation === this.lazyEntryGeneration
        && !this.options.isDestroyed(),
    )
  }

  async focusItems(ids: string[], options: FocusOptions): Promise<boolean> {
    this.invalidate()
    const items = this.options.state.items
    const { focusItems } = await import('./FocusLayout.js')
    return focusItems(
      items,
      this.options.state,
      ids,
      options,
      this.options.isDestroyed,
      this,
    )
  }

  restoreLayout(options: TransitionOptions): Promise<boolean> {
    const layout = this.options.state.lastLayout
    return layout
      ? this.transition(layout, options)
      : Promise.resolve(false)
  }

  resolveTransformBuffer(now: number): TransformBufferView {
    const { state, effects, motion } = this.options
    const effectTransforms = effects.resolveBuffer(
      state.items.length,
      now,
      this.options.isPaused(),
    )
    return effectTransforms ?? motion.resolveBuffer(
      state.transforms,
      now,
      this.options.isPaused(),
    )
  }

  recalculateSettledLayout(): void {
    const { state, motion, effects, renderer } = this.options
    if (
      !state.lastLayout
      || !state.items.length
      || motion.hasActiveTransition()
      || effects.hasActive()
    ) return
    state.transforms = calculateLayoutInto(
      state.lastLayout,
      state.items.length,
      this.options.getLayoutContext(),
      this.targetTransforms,
    )
    renderer.setTransforms(state.transforms)
  }

  settleReducedMotion(): boolean {
    const { state, renderer, effects } = this.options
    const transforms = effects.settleReducedMotion(state.items.length)
    if (!transforms) return false
    state.transforms = this.targetTransforms.copyFromBuffer(transforms)
    renderer.setTransforms(state.transforms)
    return true
  }

  invalidate(): void {
    this.lazyEntryGeneration += 1
  }

  private async transitionEffectEntry(
    layout: Layout<TMeta>,
    options: TransitionOptions,
  ): Promise<boolean> {
    return (await this.runTransitionResult(layout, options)).completed
  }

  private resolveVisualState(now: number): MotionRendererVisualState {
    if (this.options.effects.hasActive()) {
      return { billboard: 1, hideBackHemisphere: 0, hemisphereEdgeFade: 0 }
    }
    return this.options.motion.resolveVisualState(
      this.options.state.getVisualState(),
      now,
      this.options.isPaused(),
    )
  }
}
