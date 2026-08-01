import { drawDefaultCell } from './DefaultCardPainter.js'
import {
  createArrayAtlasLayout,
  resolveArrayAtlasBatchLayout,
  type ArrayAtlasLayout,
} from './ArrayAtlasStore.js'
import type {
  DefaultCardWorkerRequest,
  DefaultCardWorkerResponse,
} from './DefaultCardWorkerProtocol.js'

interface DefaultCardWorkerScope {
  onmessage: ((event: MessageEvent<DefaultCardWorkerRequest>) => void) | null
  postMessage(message: DefaultCardWorkerResponse, transfer: Transferable[]): void
}

const scope = globalThis as unknown as DefaultCardWorkerScope
const ARRAY_RASTER_BATCH_BYTES = 2 * 1024 * 1024

scope.onmessage = (event) => {
  const images = event.data.images
  const workerRenderStartedAt = now()
  try {
    const request = event.data
    const array = request.arrayMaxTextureLayers
      ? renderArrayPages(request)
      : null
    const single = array ? null : renderSingleAtlas(request)
    const data = array?.data.buffer ?? single?.data.buffer
    if (!data) throw new Error('Atlas pixel data is unavailable')
    const rects = array?.layout.rects.buffer as ArrayBuffer | undefined
    const transfer = [data, rects].filter(
      (value): value is ArrayBuffer => Boolean(value),
    )
    scope.postMessage({
      data,
      rects,
      arrayWidth: array?.layout.width,
      arrayHeight: array?.layout.height,
      arrayDepth: array?.layout.depth,
      arrayPageColumns: array?.layout.pageColumns,
      arrayPageRows: array?.layout.pageRows,
      arrayPackMs: array?.packMs ?? 0,
      workerRenderMs: now() - workerRenderStartedAt,
      pixelBufferPeakBytes: array?.pixelBufferPeakBytes ?? single?.data.byteLength ?? 0,
      cellRenderMs: array?.cellRenderMs ?? single?.cellRenderMs ?? 0,
      readbackMs: array?.readbackMs ?? single?.readbackMs ?? 0,
    }, transfer)
  } catch (error) {
    scope.postMessage({
      cellRenderMs: 0,
      readbackMs: 0,
      error: error instanceof Error ? error.message : String(error),
    }, [])
  } finally {
    images.forEach((image) => image.close())
  }
}

function renderSingleAtlas(request: DefaultCardWorkerRequest): {
  data: Uint8ClampedArray<ArrayBuffer>
  cellRenderMs: number
  readbackMs: number
} {
  const canvas = new OffscreenCanvas(request.width, request.height)
  const context = getContext(canvas, false)
  const cellRenderStartedAt = now()
  request.items.forEach((item, index) => {
    drawItem(context, request, item, index % request.columns, Math.floor(index / request.columns))
  })
  const cellRenderMs = now() - cellRenderStartedAt
  const readbackStartedAt = now()
  const data = context.getImageData(0, 0, request.width, request.height).data
  return {
    data,
    cellRenderMs,
    readbackMs: now() - readbackStartedAt,
  }
}

function renderArrayPages(request: DefaultCardWorkerRequest): {
  data: Uint8Array<ArrayBuffer>
  layout: ArrayAtlasLayout
  cellRenderMs: number
  readbackMs: number
  packMs: number
  pixelBufferPeakBytes: number
} | null {
  const layout = createArrayAtlasLayout(request.items.length, {
    sourceWidth: request.width,
    sourceHeight: request.height,
    sourceColumns: request.columns,
    sourceStrideX: request.strideX,
    sourceStrideY: request.strideY,
    cellWidth: request.cellWidth,
    cellHeight: request.cellHeight,
    padding: request.padding,
    maxTextureLayers: request.arrayMaxTextureLayers,
  })
  if (!layout) return null

  const balancedBatch = resolveArrayAtlasBatchLayout(layout, ARRAY_RASTER_BATCH_BYTES)
  const batch = {
    columns: 1,
    rows: balancedBatch.layersPerBatch,
    layersPerBatch: balancedBatch.layersPerBatch,
  }
  const canvas = new OffscreenCanvas(
    batch.columns * layout.width,
    batch.rows * layout.height,
  )
  const context = getContext(canvas, true)
  const data = new Uint8Array(layout.layerByteLength * layout.depth)
  let cellRenderMs = 0
  let readbackMs = 0
  let packMs = 0
  let maximumReadbackBytes = 0
  for (let firstLayer = 0; firstLayer < layout.depth; firstLayer += batch.layersPerBatch) {
    const batchLayerCount = Math.min(batch.layersPerBatch, layout.depth - firstLayer)
    const readColumns = Math.min(batch.columns, batchLayerCount)
    const readRows = Math.ceil(batchLayerCount / batch.columns)
    const readWidth = readColumns * layout.width
    const readHeight = readRows * layout.height
    context.clearRect(0, 0, readWidth, readHeight)
    const cellRenderStartedAt = now()
    for (let batchLayer = 0; batchLayer < batchLayerCount; batchLayer += 1) {
      const layer = firstLayer + batchLayer
      const firstItem = layer * layout.pageCapacity
      const lastItem = Math.min(request.items.length, firstItem + layout.pageCapacity)
      const pageY = batchLayer * layout.height
      context.save()
      try {
        context.translate(0, pageY + layout.height)
        context.scale(1, -1)
        for (let index = firstItem; index < lastItem; index += 1) {
          const pageSlot = index - firstItem
          drawItem(
            context,
            request,
            request.items[index],
            pageSlot % layout.pageColumns,
            Math.floor(pageSlot / layout.pageColumns),
            0,
            0,
          )
        }
      } finally {
        context.restore()
      }
    }
    cellRenderMs += now() - cellRenderStartedAt

    const readbackStartedAt = now()
    const pixels = context.getImageData(0, 0, readWidth, readHeight).data
    maximumReadbackBytes = Math.max(maximumReadbackBytes, pixels.byteLength)
    readbackMs += now() - readbackStartedAt
    const packStartedAt = now()
    for (let batchLayer = 0; batchLayer < batchLayerCount; batchLayer += 1) {
      const layer = firstLayer + batchLayer
      const sourceOffset = batchLayer * layout.layerByteLength
      const targetOffset = layer * layout.layerByteLength
      data.set(pixels.subarray(sourceOffset, sourceOffset + layout.layerByteLength), targetOffset)
    }
    packMs += now() - packStartedAt
  }
  return {
    data,
    layout,
    cellRenderMs,
    readbackMs,
    packMs,
    pixelBufferPeakBytes: data.byteLength + maximumReadbackBytes,
  }
}

function drawItem(
  context: OffscreenCanvasRenderingContext2D,
  request: DefaultCardWorkerRequest,
  item: DefaultCardWorkerRequest['items'][number],
  column: number,
  row: number,
  originX = 0,
  originY = 0,
): void {
  drawDefaultCell(
    context,
    item,
    item.imageIndex === undefined ? null : request.images[item.imageIndex] ?? null,
    {
      x: originX + column * request.strideX + request.padding,
      y: originY + row * request.strideY + request.padding,
      width: request.cellWidth,
      height: request.cellHeight,
    },
    item.style,
  )
}

function getContext(
  canvas: OffscreenCanvas,
  willReadFrequently: boolean,
): OffscreenCanvasRenderingContext2D {
  const context = willReadFrequently
    ? canvas.getContext('2d', { willReadFrequently: true })
    : canvas.getContext('2d')
  if (!context) throw new Error('Offscreen Canvas 2D context is unavailable')
  return context
}

function now(): number {
  return globalThis.performance?.now() ?? Date.now()
}
