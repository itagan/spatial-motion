import type {
  TextureAtlasMetrics,
  TextureAtlasResult,
} from '../textureAtlas.js'
export { ArrayAtlasUploadPolicy } from './CardAtlasUploadPolicy.js'

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
  private atlasArrayPackMs = 0
  private atlasWorkerRenderMs = 0
  private atlasWorkerRoundTripMs = 0
  private atlasWorkerRuntimeLoadMs = 0
  private atlasWorkerConstructMs = 0
  private atlasWorkerRequestPrepareMs = 0
  private atlasWorkerPrePostMs = 0
  private atlasWorkerRenders = 0
  private atlasLastBuildMs = 0
  private atlasLastPrepareMs = 0
  private atlasLastImageLoadWallMs = 0
  private atlasLastCellRenderMs = 0
  private atlasLastReadbackMs = 0
  private atlasLastArrayPackMs = 0
  private atlasLastWorkerRenderMs = 0
  private atlasLastWorkerRoundTripMs = 0
  private atlasLastWorkerRuntimeLoadMs = 0
  private atlasLastWorkerConstructMs = 0
  private atlasLastWorkerRequestPrepareMs = 0
  private atlasLastWorkerPrePostMs = 0
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
  private maxAtlasBuildPixelBufferBytes = 0
  private mainThreadRasterYields = 0
  private mainThreadRasterYieldMs = 0

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
    this.atlasArrayPackMs += atlas.metrics.arrayPackMs ?? 0
    this.atlasWorkerRenderMs += atlas.metrics.workerRenderMs ?? 0
    this.atlasWorkerRoundTripMs += atlas.metrics.workerRoundTripMs ?? 0
    this.atlasWorkerRuntimeLoadMs += atlas.metrics.workerRuntimeLoadMs ?? 0
    this.atlasWorkerConstructMs += atlas.metrics.workerConstructMs ?? 0
    this.atlasWorkerRequestPrepareMs += atlas.metrics.workerRequestPrepareMs ?? 0
    this.atlasWorkerPrePostMs += atlas.metrics.workerPrePostMs ?? 0
    this.atlasWorkerRenders += atlas.metrics.workerRenders ?? 0
    this.atlasLastBuildMs = atlas.metrics.renderMs
    this.atlasLastPrepareMs = atlas.metrics.prepareMs
    this.atlasLastImageLoadWallMs = atlas.metrics.imageLoadWallMs
    this.atlasLastCellRenderMs = atlas.metrics.cellRenderMs
    this.atlasLastReadbackMs = atlas.metrics.readbackMs
    this.atlasLastArrayPackMs = atlas.metrics.arrayPackMs ?? 0
    this.atlasLastWorkerRenderMs = atlas.metrics.workerRenderMs ?? 0
    this.atlasLastWorkerRoundTripMs = atlas.metrics.workerRoundTripMs ?? 0
    this.atlasLastWorkerRuntimeLoadMs = atlas.metrics.workerRuntimeLoadMs ?? 0
    this.atlasLastWorkerConstructMs = atlas.metrics.workerConstructMs ?? 0
    this.atlasLastWorkerRequestPrepareMs = atlas.metrics.workerRequestPrepareMs ?? 0
    this.atlasLastWorkerPrePostMs = atlas.metrics.workerPrePostMs ?? 0
    this.atlasImageBitmapDecodeMs += atlas.metrics.imageBitmapDecodeMs ?? 0
    this.maxAtlasBuildPixelBufferBytes = Math.max(
      this.maxAtlasBuildPixelBufferBytes,
      atlas.metrics.pixelBufferPeakBytes ?? atlas.data.byteLength,
    )
  }

  recordPatch(metrics: TextureAtlasMetrics, applyMs: number): void {
    this.atlasPatches += 1
    this.recordCommon(metrics)
    this.atlasPatchMs += metrics.renderMs + applyMs
    this.atlasDrawMs += applyMs
    this.atlasReadbackMs += metrics.readbackMs
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
      atlasArrayPackMs: this.atlasArrayPackMs,
      atlasWorkerRenderMs: this.atlasWorkerRenderMs,
      atlasWorkerRoundTripMs: this.atlasWorkerRoundTripMs,
      atlasWorkerRuntimeLoadMs: this.atlasWorkerRuntimeLoadMs,
      atlasWorkerConstructMs: this.atlasWorkerConstructMs,
      atlasWorkerRequestPrepareMs: this.atlasWorkerRequestPrepareMs,
      atlasWorkerPrePostMs: this.atlasWorkerPrePostMs,
      atlasWorkerRenders: this.atlasWorkerRenders,
      atlasLastBuildMs: this.atlasLastBuildMs,
      atlasLastPrepareMs: this.atlasLastPrepareMs,
      atlasLastImageLoadWallMs: this.atlasLastImageLoadWallMs,
      atlasLastCellRenderMs: this.atlasLastCellRenderMs,
      atlasLastReadbackMs: this.atlasLastReadbackMs,
      atlasLastArrayPackMs: this.atlasLastArrayPackMs,
      atlasLastWorkerRenderMs: this.atlasLastWorkerRenderMs,
      atlasLastWorkerRoundTripMs: this.atlasLastWorkerRoundTripMs,
      atlasLastWorkerRuntimeLoadMs: this.atlasLastWorkerRuntimeLoadMs,
      atlasLastWorkerConstructMs: this.atlasLastWorkerConstructMs,
      atlasLastWorkerRequestPrepareMs: this.atlasLastWorkerRequestPrepareMs,
      atlasLastWorkerPrePostMs: this.atlasLastWorkerPrePostMs,
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
      maxAtlasBuildPixelBufferBytes: this.maxAtlasBuildPixelBufferBytes,
      totalMainThreadRasterYields: this.mainThreadRasterYields,
      totalMainThreadRasterYieldMs: this.mainThreadRasterYieldMs,
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
    this.mainThreadRasterYields += metrics.mainThreadRasterYields ?? 0
    this.mainThreadRasterYieldMs += metrics.mainThreadRasterYieldMs ?? 0
  }
}
