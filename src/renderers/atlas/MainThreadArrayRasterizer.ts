import type { MotionItem } from '../../core/types.js'
import type {
  TextureAtlasMetrics,
  TextureAtlasOptions,
} from '../textureAtlas.js'
import {
  createArrayAtlasLayout,
  resolveArrayAtlasBatchLayout,
} from './ArrayAtlasStore.js'
import {
  prepareCardRasterSession,
  rasterizePreparedCards,
} from './CardRasterizer.js'
import type { ImageResourceBatch } from './ImageResourcePool.js'
import { throwIfAtlasAborted } from './ImageResourcePool.js'

const DEFAULT_ARRAY_RASTER_BATCH_BYTES = 4 * 1024 * 1024
const CARD_CONTENT_ARRAY_RASTER_BATCH_BYTES = 1024 * 1024
const DRAW_CARD_ARRAY_RASTER_BATCH_BYTES = 512 * 1024
const MAIN_THREAD_RASTER_SLICE_MS = 8
const MAX_BATCHES_PER_SLICE = 2

interface MainThreadArrayDimensions {
  sourceWidth: number
  sourceHeight: number
  sourceColumns: number
  sourceStrideX: number
  sourceStrideY: number
  cellSize: number
  cellWidth: number
  cellHeight: number
  padding: number
}

export interface MainThreadArrayResult {
  data: Uint8Array<ArrayBuffer>
  array: {
    rects: Float32Array
    width: number
    height: number
    depth: number
    pageColumns: number
    pageRows: number
    packMs: number
  }
  metrics: TextureAtlasMetrics
}

export async function rasterizeMainThreadArrayAtlas<TMeta>(
  items: readonly MotionItem<TMeta>[],
  dimensions: MainThreadArrayDimensions,
  options: TextureAtlasOptions<TMeta>,
  resourceBatch?: ImageResourceBatch,
): Promise<MainThreadArrayResult | null> {
  const startedAt = now()
  const layout = createArrayAtlasLayout(items.length, {
    sourceWidth: dimensions.sourceWidth,
    sourceHeight: dimensions.sourceHeight,
    sourceColumns: dimensions.sourceColumns,
    sourceStrideX: dimensions.sourceStrideX,
    sourceStrideY: dimensions.sourceStrideY,
    cellWidth: dimensions.cellWidth,
    cellHeight: dimensions.cellHeight,
    padding: dimensions.padding,
    maxTextureLayers: options.maxTextureLayers,
  })
  if (!layout) return null

  const indices = Array.from({ length: items.length }, (_value, index) => index)
  const session = await prepareCardRasterSession(items, indices, options, resourceBatch)
  const batch = resolveArrayAtlasBatchLayout(
    layout,
    options.cardContent
      ? CARD_CONTENT_ARRAY_RASTER_BATCH_BYTES
      : options.drawCard
        ? DRAW_CARD_ARRAY_RASTER_BATCH_BYTES
        : DEFAULT_ARRAY_RASTER_BATCH_BYTES,
  )
  const canvas = document.createElement('canvas')
  canvas.width = batch.columns * layout.width
  canvas.height = batch.rows * layout.height
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('spatial-motion-main-thread-array-rasterizer: Canvas 2D context is unavailable')
  }
  const reusableCell = options.cardContent || options.drawCard
    ? createReusableCellCanvas(dimensions.cellWidth, dimensions.cellHeight)
    : undefined
  const data = new Uint8Array(layout.layerByteLength * layout.depth)
  let cellRenderMs = 0
  let applyMs = 0
  let readbackMs = 0
  let packMs = 0
  let maximumReadbackBytes = 0
  let mainThreadRasterYields = 0
  let mainThreadRasterYieldMs = 0
  let batchesInSlice = 0
  let sliceStartedAt = now()

  for (let firstLayer = 0; firstLayer < layout.depth; firstLayer += batch.layersPerBatch) {
    throwIfAtlasAborted(options.signal)
    const batchLayerCount = Math.min(batch.layersPerBatch, layout.depth - firstLayer)
    const firstItem = firstLayer * layout.pageCapacity
    const lastItem = Math.min(
      items.length,
      (firstLayer + batchLayerCount) * layout.pageCapacity,
    )
    const batchIndices = indices.slice(firstItem, lastItem)
    const readColumns = Math.min(batch.columns, batchLayerCount)
    const readRows = Math.ceil(batchLayerCount / batch.columns)
    const readWidth = readColumns * layout.width
    const readHeight = readRows * layout.height
    context.clearRect(0, 0, readWidth, readHeight)
    const resolveCell = (index: number) => {
      const layer = Math.floor(index / layout.pageCapacity)
      const batchLayer = layer - firstLayer
      const pageSlot = index % layout.pageCapacity
      return {
        x: (batchLayer % batch.columns) * layout.width
          + (pageSlot % layout.pageColumns) * dimensions.sourceStrideX
          + dimensions.padding,
        y: Math.floor(batchLayer / batch.columns) * layout.height
          + Math.floor(pageSlot / layout.pageColumns) * dimensions.sourceStrideY
          + dimensions.padding,
      }
    }
    const rendered = await rasterizePreparedCards(
      items,
      batchIndices,
      dimensions.cellSize,
      options,
      session,
      {
        context,
        columns: layout.pageColumns,
        padding: dimensions.padding,
        strideX: dimensions.sourceStrideX,
        strideY: dimensions.sourceStrideY,
        resolveCell,
        reuseCellCanvas: true,
        reusableCell,
      },
    )
    cellRenderMs += rendered.cellRenderMs
    applyMs += rendered.applyMs

    const readbackStartedAt = now()
    const pixels = context.getImageData(0, 0, readWidth, readHeight).data
    readbackMs += now() - readbackStartedAt
    maximumReadbackBytes = Math.max(maximumReadbackBytes, pixels.byteLength)
    const packStartedAt = now()
    for (let batchLayer = 0; batchLayer < batchLayerCount; batchLayer += 1) {
      const layer = firstLayer + batchLayer
      const pageX = (batchLayer % batch.columns) * layout.width
      const pageY = Math.floor(batchLayer / batch.columns) * layout.height
      for (let row = 0; row < layout.height; row += 1) {
        const sourceOffset = ((pageY + row) * readWidth + pageX) * 4
        const targetOffset = layer * layout.layerByteLength
          + (layout.height - 1 - row) * layout.width * 4
        data.set(pixels.subarray(sourceOffset, sourceOffset + layout.width * 4), targetOffset)
      }
    }
    packMs += now() - packStartedAt
    batchesInSlice += 1
    if (
      firstLayer + batch.layersPerBatch < layout.depth
      && (
        batchesInSlice >= MAX_BATCHES_PER_SLICE
        || now() - sliceStartedAt >= MAIN_THREAD_RASTER_SLICE_MS
      )
    ) {
      const yielded = await yieldToNextFrame(options.signal)
      if (yielded !== null) {
        mainThreadRasterYields += 1
        mainThreadRasterYieldMs += yielded
      }
      batchesInSlice = 0
      sliceStartedAt = now()
    }
  }

  return {
    data,
    array: {
      rects: layout.rects,
      width: layout.width,
      height: layout.height,
      depth: layout.depth,
      pageColumns: layout.pageColumns,
      pageRows: layout.pageRows,
      packMs,
    },
    metrics: {
      cells: items.length,
      renderMs: now() - startedAt,
      prepareMs: session.prepareMs,
      imageLoadWallMs: session.resources.wallTimeMs,
      cellRenderMs,
      applyMs,
      readbackMs,
      imageLoadMs: session.resources.totalLoadTimeMs,
      imageRequests: session.resources.requests,
      imageFailures: session.resources.failures,
      uploadBytes: data.byteLength,
      uploadRanges: 1,
      workerRenders: 0,
      imageBitmapDecodeMs: 0,
      arrayPackMs: packMs,
      pixelBufferPeakBytes: data.byteLength + maximumReadbackBytes,
      mainThreadRasterYields,
      mainThreadRasterYieldMs,
    },
  }
}

function createReusableCellCanvas(
  width: number,
  height: number,
): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('spatial-motion-main-thread-array-rasterizer: Cell Canvas 2D context is unavailable')
  }
  return { canvas, context }
}

function now(): number {
  return globalThis.performance?.now() ?? Date.now()
}

function yieldToNextFrame(signal: AbortSignal | undefined): Promise<number | null> {
  if (typeof requestAnimationFrame !== 'function') return Promise.resolve(null)
  throwIfAtlasAborted(signal)
  const startedAt = now()
  return new Promise((resolve, reject) => {
    let frameId = 0
    const finish = (): void => {
      signal?.removeEventListener('abort', abort)
      resolve(now() - startedAt)
    }
    const abort = (): void => {
      cancelAnimationFrame(frameId)
      signal?.removeEventListener('abort', abort)
      reject(signal?.reason ?? new DOMException('Atlas rasterization aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', abort, { once: true })
    frameId = requestAnimationFrame(finish)
  })
}
