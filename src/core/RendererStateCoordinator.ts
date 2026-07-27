import type {
  MotionRenderer,
  MotionRendererVisualState,
} from '../renderers/MotionRenderer.js'
import type { Transform } from './types.js'
import type { EffectController } from './EffectController.js'
import type { InteractionController } from './InteractionController.js'
import type { MotionController } from './MotionController.js'

export class RendererStateCoordinator<TMeta = unknown> {
  constructor(
    private readonly renderer: MotionRenderer<TMeta>,
    private readonly motion: MotionController,
    private readonly effects: EffectController,
    private readonly interaction: InteractionController<TMeta>,
  ) {}

  restoreAfterItems(state: {
    transforms: readonly Transform[]
    visual: MotionRendererVisualState
    visibleRatio: number
    now: number
    paused: boolean
  }): void {
    const visualCapability = this.renderer.capabilities.visual
    const transition = this.motion.getSnapshot(state.now, state.paused)
    if (transition) {
      this.renderer.prepareTransition(transition.from, transition.to)
      visualCapability?.prepareVisualTransition(transition.fromVisual, transition.toVisual)
      this.renderer.setProgress(transition.progress)
    } else {
      visualCapability?.setVisualState(state.visual)
      this.renderer.setTransforms(state.transforms)
    }
    this.renderer.setVisibleRatio(state.visibleRatio)
    this.interaction.refreshHighlight()
    void this.effects.restoreRendererState()
  }
}
