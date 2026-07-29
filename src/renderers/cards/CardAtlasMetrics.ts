import type {
  TextureAtlasMetrics,
  TextureAtlasResult,
} from '../textureAtlas.js'

export class CardAtlasMetrics {
  textureBytes = 0
  private atlasBuilds = 0
  private atlasPatches = 0
  private atlasDiscardedBuilds = 0
  private atlasDiscardedPatches = 0
  private atlasCellsUpdated = 0
  private atlasBuildMs = 0
  private atlasPatchMs = 0
  private atlasDrawMs = 0
  private atlasPrepareMs = 0
  private atlasImageLoadWallMs = 0
  private atlasCellRenderMs = 0
  private atlasReadbackMs = 0
  private atlasWorkerRenders = 0
  private atlasImageBitmapDecodeMs = 0
  private atlasTexturePrewarms = 0
  private atlasTexturePrewarmMs = 0
  private atlasTexturePrewarmFailures = 0
  private atlasTexturePrewarmSkips = 0
  private imageLoadMs = 0
  private imageRequests = 0
  private imageFailures = 0
  private estimatedTextureUploadBytes = 0
  private atlasUploadRanges = 0

  discardBuild(): void {
    this.atlasDiscardedBuilds += 1
  }

  discardPatch(): void {
    this.atlasDiscardedPatches += 1
  }

  recordBuild(atlas: TextureAtlasResult): void {
    this.textureBytes = Math.ceil(
      atlas.width * atlas.height * atlas.depth * 4 * (atlas.mipmaps ? 4 / 3 : 1),
    )
    this.atlasBuilds += 1
    this.recordCommon(atlas.metrics)
    this.atlasBuildMs += atlas.metrics.renderMs
    this.atlasDrawMs += atlas.metrics.applyMs
    this.atlasReadbackMs += atlas.metrics.readbackMs
    this.atlasWorkerRenders += atlas.metrics.workerRenders ?? 0
    this.atlasImageBitmapDecodeMs += atlas.metrics.imageBitmapDecodeMs ?? 0
  }

  recordPatch(metrics: TextureAtlasMetrics, applyMs: number): void {
    this.atlasPatches += 1
    this.recordCommon(metrics)
    this.atlasPatchMs += metrics.renderMs + applyMs
    this.atlasDrawMs += applyMs
  }

  recordUpload(byteLength: number): void {
    this.estimatedTextureUploadBytes += byteLength
  }

  recordPrewarmSkipped(): void {
    this.atlasTexturePrewarmSkips += 1
  }

  recordPrewarm(durationMs: number): void {
    this.atlasTexturePrewarmMs += Math.max(0, durationMs)
    this.atlasTexturePrewarms += 1
  }

  recordPrewarmFailure(): void {
    this.atlasTexturePrewarmFailures += 1
  }

  resetTexture(): void {
    this.textureBytes = 0
  }

  snapshot(): Readonly<Record<string, number>> {
    return {
      atlasBuilds: this.atlasBuilds,
      atlasPatches: this.atlasPatches,
      atlasDiscardedBuilds: this.atlasDiscardedBuilds,
      atlasDiscardedPatches: this.atlasDiscardedPatches,
      atlasCellsUpdated: this.atlasCellsUpdated,
      atlasBuildMs: this.atlasBuildMs,
      atlasPatchMs: this.atlasPatchMs,
      atlasDrawMs: this.atlasDrawMs,
      atlasPrepareMs: this.atlasPrepareMs,
      atlasImageLoadWallMs: this.atlasImageLoadWallMs,
      atlasCellRenderMs: this.atlasCellRenderMs,
      atlasReadbackMs: this.atlasReadbackMs,
      atlasWorkerRenders: this.atlasWorkerRenders,
      atlasImageBitmapDecodeMs: this.atlasImageBitmapDecodeMs,
      atlasTexturePrewarms: this.atlasTexturePrewarms,
      atlasTexturePrewarmMs: this.atlasTexturePrewarmMs,
      atlasTexturePrewarmFailures: this.atlasTexturePrewarmFailures,
      atlasTexturePrewarmSkips: this.atlasTexturePrewarmSkips,
      imageLoadMs: this.imageLoadMs,
      imageRequests: this.imageRequests,
      imageFailures: this.imageFailures,
      estimatedTextureUploadBytes: this.estimatedTextureUploadBytes,
      atlasUploadRanges: this.atlasUploadRanges,
    }
  }

  private recordCommon(metrics: TextureAtlasMetrics): void {
    this.atlasCellsUpdated += metrics.cells
    this.atlasPrepareMs += metrics.prepareMs
    this.atlasImageLoadWallMs += metrics.imageLoadWallMs
    this.atlasCellRenderMs += metrics.cellRenderMs
    this.imageLoadMs += metrics.imageLoadMs
    this.imageRequests += metrics.imageRequests
    this.imageFailures += metrics.imageFailures
    this.estimatedTextureUploadBytes += metrics.uploadBytes
    this.atlasUploadRanges += metrics.uploadRanges ?? 0
  }
}
