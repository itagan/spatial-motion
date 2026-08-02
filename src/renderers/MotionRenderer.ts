import type { BufferGeometry, Group, Material, Texture } from 'three'
import type { StreamingEffectGpuData } from '../effects/types.js'
import type { MotionItem } from '../core/types.js'
import type { TransformBufferView } from '../core/TransformBuffer.js'

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
  updateItems(
    items: readonly MotionItem<TMeta>[],
    changedIndices: readonly number[],
  ): Promise<boolean>
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

export interface MotionRendererPrewarmRequest {
  /** Prepare renderer-owned textures that are already resident. */
  readonly textures?: boolean
  /** Renderer-specific lazy Program kinds to load and compile. */
  readonly programs?: readonly string[]
}

export interface MotionRendererResourcePreparationCapability {
  prewarm(request: MotionRendererPrewarmRequest): boolean | void | Promise<boolean | void>
}

export interface MotionRendererStreamingEffectsCapability {
  /** Return false to reject an effect key and make Stage use its static CPU frame. */
  enable(data: StreamingEffectGpuData): boolean | void | Promise<boolean | void>
  disable(): void
  setTime(elapsedSeconds: number): void
}

export interface MotionRendererFrameCapability {
  update(deltaSeconds: number): void
  /**
   * Return false once renderer-owned frame work is drained. Renderers that omit
   * this hook retain continuous rendering for backward compatibility.
   */
  needsUpdate?(): boolean
}

export interface MotionRendererCapabilities<TMeta = unknown> {
  readonly patch?: MotionRendererPatchCapability<TMeta>
  readonly visual?: MotionRendererVisualCapability
  readonly highlight?: MotionRendererHighlightCapability
  readonly viewport?: MotionRendererViewportCapability
  readonly resourceRecovery?: MotionRendererResourceRecoveryCapability
  readonly resourcePreparation?: MotionRendererResourcePreparationCapability
  readonly streamingEffects?: MotionRendererStreamingEffectsCapability
  readonly frame?: MotionRendererFrameCapability
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
  setItems(items: readonly MotionItem<TMeta>[]): Promise<boolean>
  /**
   * Buffer views remain valid only until the next Stage transform submission
   * and must be consumed synchronously.
   */
  setTransforms(buffer: TransformBufferView): void
  prepareTransition(from: TransformBufferView, to: TransformBufferView): void
  setProgress(progress: number): void
  setVisibleRatio(ratio: number): void
  getStats(): MotionRendererStats
  dispose(): void
}

export interface MotionRendererFactoryContext {
  readonly root: Group
  readonly maxTextureSize: number
  readonly maxTextureLayers: number
  readonly maxAnisotropy: number
  readonly signal: AbortSignal
  readonly prepareTexture: (texture: Texture) => number
  readonly prepareProgram?: (
    material: Material,
    geometry: BufferGeometry,
  ) => Promise<number>
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
