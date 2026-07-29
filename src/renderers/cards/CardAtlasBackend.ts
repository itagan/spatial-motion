import type { ShaderMaterial } from 'three'
import type { MotionItem } from '../../core/types.js'
import type {
  TextureAtlasPatch,
  TextureAtlasResult,
} from '../textureAtlas.js'

export interface PreparedCardAtlas {
  readonly atlas: TextureAtlasResult
  readonly configureMaterial?: (material: ShaderMaterial) => void
}

export interface CardAtlasBackend<TMeta = unknown> {
  prepare(): Promise<void>
  build(
    items: readonly MotionItem<TMeta>[],
    resolution: number,
    signal: AbortSignal,
  ): Promise<PreparedCardAtlas>
  patch(
    items: readonly MotionItem<TMeta>[],
    changedIndices: readonly number[],
    atlas: TextureAtlasResult,
    signal: AbortSignal,
  ): Promise<TextureAtlasPatch>
  applyPatch(
    atlas: TextureAtlasResult,
    patch: TextureAtlasPatch,
    visibleLayers?: number,
  ): number
  advanceUploads(
    atlas: TextureAtlasResult,
    nextLayer: number,
    layerBudget: number,
  ): readonly [nextLayer: number, uploaded: boolean]
  clearPatchQueue(atlas: TextureAtlasResult): void
  dispose(): void
}
