import type { MotionItem } from '../../core/types.js'
import type {
  TextureAtlasOptions,
  TextureAtlasPatch,
  TextureAtlasResult,
} from '../textureAtlas.js'
import type { CardAtlasBackend, PreparedCardAtlas } from './CardAtlasBackend.js'

export class LazyDefaultCardAtlasBackend<TMeta> implements CardAtlasBackend<TMeta> {
  private backend: CardAtlasBackend<TMeta> | null = null
  private pending: Promise<CardAtlasBackend<TMeta>> | null = null
  private disposed = false

  constructor(private readonly options: TextureAtlasOptions<TMeta>) {}

  async prepare(): Promise<void> {
    const backend = await this.load()
    await backend.prepare()
  }

  async build(
    items: readonly MotionItem<TMeta>[],
    resolution: number,
    signal: AbortSignal,
  ): Promise<PreparedCardAtlas> {
    const backend = this.backend ?? await this.load()
    return backend.build(items, resolution, signal)
  }

  async patch(
    items: readonly MotionItem<TMeta>[],
    changedIndices: readonly number[],
    atlas: TextureAtlasResult,
    signal: AbortSignal,
  ): Promise<TextureAtlasPatch> {
    const backend = this.backend ?? await this.load()
    return backend.patch(items, changedIndices, atlas, signal)
  }

  applyPatch(
    atlas: TextureAtlasResult,
    patch: TextureAtlasPatch,
    visibleLayers?: number,
  ): number {
    return this.backend!.applyPatch(atlas, patch, visibleLayers)
  }

  advanceUploads(
    atlas: TextureAtlasResult,
    nextLayer: number,
    layerBudget: number,
  ): readonly [nextLayer: number, uploaded: boolean] {
    return this.backend?.advanceUploads(atlas, nextLayer, layerBudget)
      ?? [nextLayer, false]
  }

  clearPatchQueue(atlas: TextureAtlasResult): void {
    this.backend?.clearPatchQueue(atlas)
  }

  dispose(): void {
    this.disposed = true
    this.backend?.dispose()
  }

  private async load(): Promise<CardAtlasBackend<TMeta>> {
    if (this.backend) return this.backend
    this.pending ??= import('./DefaultCardAtlasBackend.js')
      .then(({ DefaultCardAtlasBackend }) =>
        new DefaultCardAtlasBackend(this.options))
      .catch((error) => {
        this.pending = null
        throw error
      })
    const backend = await this.pending
    if (this.disposed) backend.dispose()
    else this.backend = backend
    return backend
  }
}
