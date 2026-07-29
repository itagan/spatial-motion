import type { ShaderMaterial } from 'three'
import type { MotionItem } from '../../core/types.js'
import type {
  TextureAtlasImageCache,
  TextureAtlasOptions,
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

/**
 * Default lazy Canvas/Worker raster, single/array storage and upload backend.
 */
export class DefaultCardAtlasBackend<TMeta = unknown>
implements CardAtlasBackend<TMeta> {
  private api: typeof import('../textureAtlas.js') | null = null
  private apiPromise: Promise<typeof import('../textureAtlas.js')> | null = null
  private imageCache: TextureAtlasImageCache | null = null

  constructor(private readonly options: TextureAtlasOptions<TMeta>) {}

  async prepare(): Promise<void> {
    await this.load()
  }

  async build(
    items: readonly MotionItem<TMeta>[],
    resolution: number,
    signal: AbortSignal,
  ): Promise<PreparedCardAtlas> {
    const api = this.api ?? await this.load()
    signal.throwIfAborted()
    const atlas = await api.createTextureAtlas(
      items,
      resolution,
      this.operationOptions(api, signal),
    )
    try {
      return {
        atlas,
        configureMaterial: atlas.mode === 'array'
          ? (await import('../ArrayCardShader.js')).configureArrayCardMaterial
          : undefined,
      }
    } catch (error) {
      atlas.texture.dispose()
      throw error
    }
  }

  async patch(
    items: readonly MotionItem<TMeta>[],
    changedIndices: readonly number[],
    atlas: TextureAtlasResult,
    signal: AbortSignal,
  ): Promise<TextureAtlasPatch> {
    const api = this.api ?? await this.load()
    signal.throwIfAborted()
    return api.createTextureAtlasPatch(
      items,
      changedIndices,
      atlas.cellSize,
      this.operationOptions(api, signal),
    )
  }

  applyPatch(
    atlas: TextureAtlasResult,
    patch: TextureAtlasPatch,
    visibleLayers?: number,
  ): number {
    if (!this.api) throw new Error('Cards Atlas backend is not prepared')
    return this.api.applyTextureAtlasPatch(atlas, patch, visibleLayers)
  }

  advanceUploads(
    atlas: TextureAtlasResult,
    nextLayer: number,
    layerBudget: number,
  ): readonly [nextLayer: number, uploaded: boolean] {
    if (!this.api) return [nextLayer, false]
    return this.api.advanceTextureAtlasUploads(atlas, nextLayer, layerBudget)
  }

  clearPatchQueue(atlas: TextureAtlasResult): void {
    this.api?.clearTextureAtlasPatchQueue(atlas)
  }

  dispose(): void {
    this.imageCache?.clear()
    this.imageCache = null
  }

  private async load(): Promise<typeof import('../textureAtlas.js')> {
    if (this.api) return this.api
    this.apiPromise ??= import('../textureAtlas.js')
    this.api = await this.apiPromise
    return this.api
  }

  private operationOptions(
    api: typeof import('../textureAtlas.js'),
    signal: AbortSignal,
  ): TextureAtlasOptions<TMeta> {
    this.imageCache ??= new api.TextureAtlasImageCache(
      normalizeImageCacheSize(this.options.imageCacheSize),
    )
    return {
      ...this.options,
      imageCache: this.imageCache,
      signal,
    }
  }
}

function normalizeImageCacheSize(value: number | undefined): number {
  return Math.min(1024, Math.max(0, Math.floor(Number.isFinite(value) ? value as number : 128)))
}
