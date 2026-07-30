import type {
  Layout,
  MotionItem,
} from './types.js'
import type { MotionRendererVisualState } from '../renderers/MotionRenderer.js'
import { TransformBuffer } from './TransformBuffer.js'

export class StageContentState<TMeta = unknown> {
  items: MotionItem<TMeta>[] = []
  sourceItems: MotionItem<TMeta>[] = []
  transforms = new TransformBuffer()
  lastLayout: Layout<TMeta> | null = null
  visibleRatio = 1
  inputItemCount = 0
  orientation: 'surface' | 'camera' = 'surface'
  hideBackHemisphere = false
  hemisphereEdgeFade = 0

  setVisual(
    orientation: 'surface' | 'camera',
    hideBackHemisphere: boolean,
    hemisphereEdgeFade: number,
  ): void {
    this.orientation = orientation
    this.hideBackHemisphere = hideBackHemisphere
    this.hemisphereEdgeFade = hemisphereEdgeFade
  }

  getVisualState(): MotionRendererVisualState {
    return {
      billboard: this.orientation === 'camera' ? 1 : 0,
      hideBackHemisphere: this.hideBackHemisphere ? 1 : 0,
      hemisphereEdgeFade: this.hemisphereEdgeFade,
    }
  }
}
