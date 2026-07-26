import { DataTexture, LinearFilter, LinearMipmapLinearFilter, SRGBColorSpace } from 'three'
import type {
  CardContentRenderer,
  CardStyle,
  DrawCard,
  MotionItem,
  ResolveCardStyle,
} from '../core/types.js'
import { resolveAtlasMetrics } from './atlas/AtlasPlanner.js'
import {
  TextureAtlasImageCache,
} from './atlas/ImageResourcePool.js'
import {
  rasterizeCards,
} from './atlas/CardRasterizer.js'
import { renderDefaultAtlasInWorker } from './atlas/DefaultCardWorkerClient.js'
import {
  applyAtlasPatch,
  drawPatchToCanvas,
} from './atlas/AtlasStore.js'

export { resolveAtlasMetrics } from './atlas/AtlasPlanner.js'
export { TextureAtlasImageCache } from './atlas/ImageResourcePool.js'

export interface TextureAtlasOptions<TMeta = unknown> {
  cardStyle?: CardStyle
  resolveCardStyle?: ResolveCardStyle<TMeta>
  drawCard?: DrawCard<TMeta>
  cardContent?: CardContentRenderer<TMeta>
  aspectRatio?: number
  imageTimeout?: number
  maxTextureSize?: number
  anisotropy?: number
  imageConcurrency?: number
  imageCacheSize?: number
  imageCache?: TextureAtlasImageCache
  mipmaps?: boolean
  signal?: AbortSignal
}

export interface TextureAtlasResult {
  texture: DataTexture
  rects: Float32Array
  width: number
  height: number
  data: Uint8Array | Uint8ClampedArray
  columns: number
  rows: number
  cellSize: number
  cellWidth: number
  cellHeight: number
  padding: number
  stride: number
  strideX: number
  strideY: number
  mipmaps: boolean
  initialized: boolean
  metrics: TextureAtlasMetrics
}

export interface TextureAtlasPatch {
  cells: Array<{ index: number; canvas: HTMLCanvasElement }>
  metrics: TextureAtlasMetrics
}

export interface TextureAtlasMetrics {
  cells: number
  renderMs: number
  prepareMs: number
  imageLoadWallMs: number
  cellRenderMs: number
  applyMs: number
  readbackMs: number
  imageLoadMs: number
  imageRequests: number
  imageFailures: number
  uploadBytes: number
  uploadRanges?: number
  workerRenders?: number
  imageBitmapDecodeMs?: number
}

export async function createTextureAtlas<TMeta = unknown>(
  items: readonly MotionItem<TMeta>[],
  cellSize = 64,
  options: TextureAtlasOptions<TMeta> = {},
): Promise<TextureAtlasResult> {
  const startedAt = now()
  const metrics = resolveAtlasMetrics(
    items.length,
    cellSize,
    options.maxTextureSize,
    options.aspectRatio,
  )
  const {
    padding,
    strideX,
    strideY,
    columns,
    rows,
    cellSize: resolvedCellSize,
    cellWidth,
    cellHeight,
  } = metrics
  const width = columns * strideX
  const height = rows * strideY

  const rects = new Float32Array(items.length * 4)
  items.forEach((_item, index) => {
    const x = (index % columns) * strideX + padding
    const y = Math.floor(index / columns) * strideY + padding
    rects.set(
      [
        x / width,
        1 - (y + cellHeight) / height,
        cellWidth / width,
        cellHeight / height,
      ],
      index * 4,
    )
  })

  const workerAttempt = await renderDefaultAtlasInWorker(items, {
    width,
    height,
    columns,
    cellWidth,
    cellHeight,
    padding,
    strideX,
    strideY,
  }, options)
  const workerResult = workerAttempt.result
  if (workerResult) {
    return createAtlasResult(
      workerResult.data,
      rects,
      metrics,
      options,
      {
        cells: items.length,
        renderMs: now() - startedAt,
        prepareMs: workerResult.imageBitmapDecodeMs,
        imageLoadWallMs: workerResult.imageLoadWallMs,
        cellRenderMs: workerResult.cellRenderMs,
        applyMs: 0,
        readbackMs: workerResult.readbackMs,
        imageLoadMs: workerResult.imageLoadMs,
        imageRequests: workerResult.imageRequests,
        imageFailures: workerResult.imageFailures,
        uploadBytes: workerResult.data.byteLength,
        uploadRanges: 1,
        workerRenders: 1,
        imageBitmapDecodeMs: workerResult.imageBitmapDecodeMs,
      },
    )
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D context is unavailable')
  const patch = await rasterizeCards(
    items,
    items.map((_item, index) => index),
    resolvedCellSize,
    options,
    { context, columns, padding, strideX, strideY },
    workerAttempt.resources,
  )
  const applyStartedAt = now()
  drawPatchToCanvas(context, columns, cellWidth, cellHeight, padding, strideX, strideY, patch)
  patch.metrics.applyMs = now() - applyStartedAt
  const readbackStartedAt = now()
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data
  patch.metrics.readbackMs = now() - readbackStartedAt
  patch.metrics = {
    ...patch.metrics,
    renderMs: now() - startedAt,
    uploadBytes: data.byteLength,
    uploadRanges: 1,
    workerRenders: 0,
    imageBitmapDecodeMs: 0,
  }
  return createAtlasResult(data, rects, metrics, options, patch.metrics)
}

function createAtlasResult<TMeta>(
  data: Uint8Array | Uint8ClampedArray,
  rects: Float32Array,
  dimensions: ReturnType<typeof resolveAtlasMetrics>,
  options: TextureAtlasOptions<TMeta>,
  atlasMetrics: TextureAtlasMetrics,
): TextureAtlasResult {
  const {
    columns,
    rows,
    cellSize,
    cellWidth,
    cellHeight,
    padding,
    stride,
    strideX,
    strideY,
  } = dimensions
  const width = columns * strideX
  const height = rows * strideY
  const texture = new DataTexture(data, width, height)
  const mipmaps = options.mipmaps !== false
  texture.colorSpace = SRGBColorSpace
  texture.minFilter = mipmaps ? LinearMipmapLinearFilter : LinearFilter
  texture.magFilter = LinearFilter
  texture.generateMipmaps = mipmaps
  texture.flipY = true
  texture.anisotropy = Math.max(1, Math.floor(options.anisotropy ?? 1))
  texture.needsUpdate = true
  const atlas: TextureAtlasResult = {
    texture,
    rects,
    width,
    height,
    data,
    columns,
    rows,
    cellSize,
    cellWidth,
    cellHeight,
    padding,
    stride,
    strideX,
    strideY,
    mipmaps,
    initialized: false,
    metrics: atlasMetrics,
  }
  texture.onUpdate = () => {
    atlas.initialized = true
  }
  return atlas
}

export async function createTextureAtlasPatch<TMeta = unknown>(
  items: readonly MotionItem<TMeta>[],
  indices: readonly number[],
  cellSize: number,
  options: TextureAtlasOptions<TMeta> = {},
): Promise<TextureAtlasPatch> {
  return rasterizeCards(items, indices, cellSize, options)
}

export function applyTextureAtlasPatch(atlas: TextureAtlasResult, patch: TextureAtlasPatch): number {
  return applyAtlasPatch(atlas, patch)
}


function now(): number {
  return globalThis.performance?.now() ?? Date.now()
}
