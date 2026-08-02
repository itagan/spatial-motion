import type {
  MotionRenderer,
  MotionRendererDescriptor,
  MotionRendererStats,
  MotionRendererStreamingEffectsCapability,
  MotionRendererPrewarmRequest,
  MotionRendererViewport,
  MotionRendererVisualState,
} from '../renderers/MotionRenderer.js'
import type { MotionItem } from './types.js'
import type { TransformBufferView } from './TransformBuffer.js'
import { assertMotionRenderer } from './MotionRendererSupport.js'

export interface CompiledRendererRuntime<TMeta = unknown> {
  readonly descriptor: MotionRendererDescriptor
  readonly supportsPatch: boolean
  readonly streamingEffects: MotionRendererStreamingEffectsCapability | undefined
  setItems(items: readonly MotionItem<TMeta>[]): Promise<boolean>
  updateItems(
    items: readonly MotionItem<TMeta>[],
    changedIndices: readonly number[],
  ): Promise<boolean>
  setTransforms(buffer: TransformBufferView): void
  prepareTransition(from: TransformBufferView, to: TransformBufferView): void
  setProgress(progress: number): void
  setVisibleRatio(ratio: number): void
  setVisualState(state: MotionRendererVisualState): void
  prepareVisualTransition(
    from: MotionRendererVisualState,
    to: MotionRendererVisualState,
  ): void
  setHighlightIndex(index: number | null): void
  resize(viewport: MotionRendererViewport): void
  refreshResources(): void
  prewarm(request: MotionRendererPrewarmRequest): Promise<boolean>
  updateFrame(deltaSeconds: number): void
  needsFrame(): boolean
  getStats(): MotionRendererStats
  dispose(): void
}

const noop = (): void => {}

/**
 * Fixed renderer dispatch table compiled once during Stage construction.
 * Optional public capabilities never leak into Stage hot paths.
 */
export function compileRendererRuntime<TMeta = unknown>(
  renderer: MotionRenderer<TMeta>,
): CompiledRendererRuntime<TMeta> {
  assertMotionRenderer(renderer)
  const {
    patch,
    visual,
    highlight,
    viewport,
    resourceRecovery,
    resourcePreparation,
    streamingEffects,
    frame,
  } = renderer.capabilities
  return {
    descriptor: renderer.descriptor,
    supportsPatch: Boolean(patch),
    streamingEffects: streamingEffects && {
      enable: (data) => streamingEffects.enable(data),
      disable: () => streamingEffects.disable(),
      setTime: (elapsedSeconds) => streamingEffects.setTime(elapsedSeconds),
    },
    setItems: (items) => renderer.setItems(items),
    updateItems: patch
      ? (items, changedIndices) => patch.updateItems(items, changedIndices)
      : (items) => renderer.setItems(items),
    setTransforms: (transforms) => renderer.setTransforms(transforms),
    prepareTransition: (from, to) => renderer.prepareTransition(from, to),
    setProgress: (progress) => renderer.setProgress(progress),
    setVisibleRatio: (ratio) => renderer.setVisibleRatio(ratio),
    setVisualState: visual
      ? (state) => visual.setVisualState(state)
      : noop,
    prepareVisualTransition: visual
      ? (from, to) => visual.prepareVisualTransition(from, to)
      : noop,
    setHighlightIndex: highlight
      ? (index) => highlight.setHighlightIndex(index)
      : noop,
    resize: viewport
      ? (nextViewport) => viewport.resize(nextViewport)
      : noop,
    refreshResources: resourceRecovery
      ? () => resourceRecovery.refreshResources()
      : noop,
    prewarm: resourcePreparation
      ? async (request) => (await resourcePreparation.prewarm(request)) !== false
      : async () => false,
    updateFrame: frame
      ? (deltaSeconds) => frame.update(deltaSeconds)
      : noop,
    needsFrame: frame
      ? frame.needsUpdate
        ? () => frame.needsUpdate!()
        : () => true
      : () => false,
    getStats: () => renderer.getStats(),
    dispose: () => renderer.dispose(),
  }
}
