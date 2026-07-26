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
    stride,
    strideX,
    strideY,
    columns,
    rows,
    cellSize: resolvedCellSize,
    cellWidth,
    cellHeight,
  } = metrics
  const canvas = document.createElement('canvas')
  canvas.width = columns * strideX
  canvas.height = rows * strideY
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D context is unavailable')

  const rects = new Float32Array(items.length * 4)
  items.forEach((_item, index) => {
    const x = (index % columns) * strideX + padding
    const y = Math.floor(index / columns) * strideY + padding
    rects.set(
      [
        x / canvas.width,
        1 - (y + cellHeight) / canvas.height,
        cellWidth / canvas.width,
        cellHeight / canvas.height,
      ],
      index * 4,
    )
  })

  const patch = await rasterizeCards(
    items,
    items.map((_item, index) => index),
    resolvedCellSize,
    options,
    { context, columns, padding, strideX, strideY },
  )
  const applyStartedAt = now()
  drawPatchToCanvas(context, columns, cellWidth, cellHeight, padding, strideX, strideY, patch)
  patch.metrics.applyMs = now() - applyStartedAt
  const readbackStartedAt = now()
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data
  patch.metrics.readbackMs = now() - readbackStartedAt
  const texture = new DataTexture(data, canvas.width, canvas.height)
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
    width: canvas.width,
    height: canvas.height,
    data,
    columns,
    rows,
    cellSize: resolvedCellSize,
    cellWidth,
    cellHeight,
    padding,
    stride,
    strideX,
    strideY,
    mipmaps,
    initialized: false,
    metrics: patch.metrics,
  }
  texture.onUpdate = () => {
    atlas.initialized = true
  }
  atlas.metrics = {
    ...patch.metrics,
    renderMs: now() - startedAt,
    uploadBytes: data.byteLength,
    uploadRanges: 1,
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
