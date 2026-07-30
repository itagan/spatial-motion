import type {
  MotionRendererVisualState,
} from '../renderers/MotionRenderer.js'
import type { TransformBufferView } from './TransformBuffer.js'
import type { CompiledRendererRuntime } from './CompiledRendererRuntime.js'
import type { EffectController } from './EffectController.js'
import type { InteractionController } from './InteractionController.js'
import type { MotionController } from './MotionController.js'

export class RendererStateCoordinator<TMeta = unknown> {
  constructor(
    private readonly renderer: CompiledRendererRuntime<TMeta>,
    private readonly motion: MotionController,
    private readonly effects: EffectController,
    private readonly interaction: InteractionController<TMeta>,
  ) {}

  restoreAfterItems(state: {
    transforms: TransformBufferView
    visual: MotionRendererVisualState
    visibleRatio: number
    now: number
    paused: boolean
  }): void {
    const transition = this.motion.getSnapshot(state.now, state.paused)
    if (transition) {
      this.renderer.prepareTransition(transition.from, transition.to)
      this.renderer.prepareVisualTransition(transition.fromVisual, transition.toVisual)
      this.renderer.setProgress(transition.progress)
    } else {
      this.renderer.setVisualState(state.visual)
      this.renderer.setTransforms(state.transforms)
    }
    this.renderer.setVisibleRatio(state.visibleRatio)
    this.interaction.refreshHighlight()
    void this.effects.restoreRendererState()
  }
}
