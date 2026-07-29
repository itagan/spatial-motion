import type { StreamingEffectGpuData } from '../effects/types.js'
import type {
  MotionRenderer,
  MotionRendererDescriptor,
  MotionRendererStats,
  MotionRendererStreamingEffectsCapability,
  MotionRendererViewport,
  MotionRendererVisualState,
} from '../renderers/MotionRenderer.js'
import type { MotionItem, Transform } from './types.js'
import { assertMotionRenderer } from './MotionRendererSupport.js'

export interface CompiledRendererFeatures {
  readonly patch: boolean
  readonly visual: boolean
  readonly highlight: boolean
  readonly viewport: boolean
  readonly resourceRecovery: boolean
  readonly streamingEffects: boolean
  readonly frame: boolean
}

const noop = (): void => {}

/**
 * Fixed renderer dispatch table compiled once during Stage construction.
 * Optional public capabilities never leak into Stage hot paths.
 */
export class CompiledRendererRuntime<TMeta = unknown> {
  readonly descriptor: MotionRendererDescriptor
  readonly features: CompiledRendererFeatures
  readonly streamingEffects: MotionRendererStreamingEffectsCapability | undefined
  readonly setVisualState: (state: MotionRendererVisualState) => void
  readonly prepareVisualTransition: (
    from: MotionRendererVisualState,
    to: MotionRendererVisualState,
  ) => void
  readonly setHighlightIndex: (index: number | null) => void
  readonly resize: (viewport: MotionRendererViewport) => void
  readonly refreshResources: () => void
  readonly updateFrame: (deltaSeconds: number) => void

  private readonly updateItemsImpl: (
    items: readonly MotionItem<TMeta>[],
    changedIndices: readonly number[],
  ) => Promise<boolean>

  constructor(private readonly renderer: MotionRenderer<TMeta>) {
    assertMotionRenderer(renderer)
    const capabilities = renderer.capabilities
    const patch = capabilities.patch
    const visual = capabilities.visual
    const highlight = capabilities.highlight
    const viewport = capabilities.viewport
    const recovery = capabilities.resourceRecovery
    const effects = capabilities.streamingEffects
    const frame = capabilities.frame
    this.descriptor = renderer.descriptor
    this.features = Object.freeze({
      patch: Boolean(patch),
      visual: Boolean(visual),
      highlight: Boolean(highlight),
      viewport: Boolean(viewport),
      resourceRecovery: Boolean(recovery),
      streamingEffects: Boolean(effects),
      frame: Boolean(frame),
    })
    this.updateItemsImpl = patch
      ? (items, changedIndices) => patch.updateItems(items, changedIndices)
      : (items) => renderer.setItems(items)
    this.setVisualState = visual
      ? (state) => visual.setVisualState(state)
      : noop
    this.prepareVisualTransition = visual
      ? (from, to) => visual.prepareVisualTransition(from, to)
      : noop
    this.setHighlightIndex = highlight
      ? (index) => highlight.setHighlightIndex(index)
      : noop
    this.resize = viewport
      ? (nextViewport) => viewport.resize(nextViewport)
      : noop
    this.refreshResources = recovery
      ? () => recovery.refreshResources()
      : noop
    this.updateFrame = frame
      ? (deltaSeconds) => frame.update(deltaSeconds)
      : noop
    this.streamingEffects = effects
      ? {
          enable: (data: StreamingEffectGpuData) => effects.enable(data),
          disable: () => effects.disable(),
          setTime: (elapsedSeconds: number) => effects.setTime(elapsedSeconds),
        }
      : undefined
  }

  setItems(items: readonly MotionItem<TMeta>[]): Promise<boolean> {
    return this.renderer.setItems(items)
  }

  updateItems(
    items: readonly MotionItem<TMeta>[],
    changedIndices: readonly number[],
  ): Promise<boolean> {
    return this.updateItemsImpl(items, changedIndices)
  }

  setTransforms(transforms: readonly Transform[]): void {
    this.renderer.setTransforms(transforms)
  }

  prepareTransition(from: readonly Transform[], to: readonly Transform[]): void {
    this.renderer.prepareTransition(from, to)
  }

  setProgress(progress: number): void {
    this.renderer.setProgress(progress)
  }

  setVisibleRatio(ratio: number): void {
    this.renderer.setVisibleRatio(ratio)
  }

  getStats(): MotionRendererStats {
    return this.renderer.getStats()
  }

  dispose(): void {
    this.renderer.dispose()
  }
}

export function compileRendererRuntime<TMeta = unknown>(
  renderer: MotionRenderer<TMeta>,
): CompiledRendererRuntime<TMeta> {
  return new CompiledRendererRuntime(renderer)
}
