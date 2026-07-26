import type { Group } from 'three'
import type { StreamingEffectGpuData } from '../effects/types.js'
import type { MotionItem, Transform } from '../core/types.js'

export interface MotionRendererVisualState {
  readonly billboard: number
  readonly hideBackHemisphere: number
  readonly hemisphereEdgeFade: number
}

export type MotionRendererPickShape =
  | {
      readonly kind: 'quad'
      readonly width: number
      readonly height: number
      readonly facing: 'layout' | 'camera'
    }
  | {
      readonly kind: 'disc'
      readonly diameter: number
      readonly facing: 'camera'
    }

export interface MotionRendererDescriptor {
  readonly itemBounds: MotionRendererPickShape | null
}

export interface MotionRendererViewport {
  readonly width: number
  readonly height: number
  readonly pixelRatio: number
}

export interface MotionRendererPatchCapability<TMeta = unknown> {
  updateItems(items: MotionItem<TMeta>[], changedIndices: number[]): Promise<boolean>
}

export interface MotionRendererVisualCapability {
  setVisualState(state: MotionRendererVisualState): void
  prepareVisualTransition(
    from: MotionRendererVisualState,
    to: MotionRendererVisualState,
  ): void
}

export interface MotionRendererHighlightCapability {
  setHighlightIndex(index: number | null): void
}

export interface MotionRendererViewportCapability {
  resize(viewport: MotionRendererViewport): void
}

export interface MotionRendererResourceRecoveryCapability {
  refreshResources(): void
}

export interface MotionRendererStreamingEffectsCapability {
  enable(data: StreamingEffectGpuData): void
  disable(): void
  setTime(elapsedSeconds: number): void
}

export interface MotionRendererCapabilities<TMeta = unknown> {
  readonly patch?: MotionRendererPatchCapability<TMeta>
  readonly visual?: MotionRendererVisualCapability
  readonly highlight?: MotionRendererHighlightCapability
  readonly viewport?: MotionRendererViewportCapability
  readonly resourceRecovery?: MotionRendererResourceRecoveryCapability
  readonly streamingEffects?: MotionRendererStreamingEffectsCapability
}

export interface MotionRendererStats {
  readonly instanceCount: number
  readonly submittedInstanceCount: number
  readonly gpuBytes?: number
  readonly metrics?: Readonly<Record<string, number>>
}

export interface MotionRenderer<TMeta = unknown> {
  readonly descriptor: MotionRendererDescriptor
  readonly capabilities: MotionRendererCapabilities<TMeta>
  setItems(items: MotionItem<TMeta>[]): Promise<boolean>
  setTransforms(transforms: Transform[]): void
  prepareTransition(from: Transform[], to: Transform[]): void
  setProgress(progress: number): void
  setVisibleRatio(ratio: number): void
  getStats(): MotionRendererStats
  dispose(): void
}

export interface MotionRendererFactoryContext {
  readonly root: Group
  readonly maxTextureSize: number
  readonly maxAnisotropy: number
  readonly signal: AbortSignal
}

export type MotionRendererFactory<TMeta = unknown> = (
  context: MotionRendererFactoryContext,
) => MotionRenderer<TMeta>

export function defineMotionRenderer<TMeta = unknown>(
  factory: MotionRendererFactory<TMeta>,
): MotionRendererFactory<TMeta> {
  if (typeof factory !== 'function') throw new TypeError('Motion renderer factory must be a function')
  return factory
}
