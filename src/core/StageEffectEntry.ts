import type { StreamingEffect } from '../effects/types.js'
import type { CompiledRendererRuntime } from './CompiledRendererRuntime.js'
import type { EffectController } from './EffectController.js'
import type { QualityController } from './QualityController.js'
import type { StageContentState } from './StageContentState.js'
import { TransformBuffer } from './TransformBuffer.js'
import type {
  Layout,
  TransitionOptions,
} from './types.js'

export async function enterEffect<TMeta>(
  effect: StreamingEffect,
  options: TransitionOptions,
  state: StageContentState<TMeta>,
  renderer: CompiledRendererRuntime<TMeta>,
  effects: EffectController,
  quality: QualityController,
  isReducedMotion: () => boolean,
  transition: (
    layout: Layout<TMeta>,
    options: TransitionOptions,
  ) => Promise<boolean>,
  isCurrent: () => boolean,
): Promise<boolean> {
  const target = effects.prepare(
    effect,
    state.items.length,
    quality.getProfile().maxActiveEffectItems,
  )
  const entered = await transition(
    {
      name: `${effect.name}-entry`,
      orientation: 'camera',
      hideBackHemisphere: false,
      hemisphereEdgeFade: 0,
      calculate: () => [],
      calculateInto: (_count, _context, buffer) => {
        buffer.copyFromBuffer(target)
      },
    },
    options,
  )
  if (!entered || !isCurrent()) return false
  if (isReducedMotion()) {
    state.transforms = new TransformBuffer().copyFromBuffer(target)
    renderer.setTransforms(state.transforms)
    return true
  }
  const activated = await effects.activate(effect, performance.now())
  if (!isCurrent()) return false
  if (!activated) {
    state.transforms = new TransformBuffer().copyFromBuffer(target)
    renderer.setTransforms(state.transforms)
  }
  return true
}
