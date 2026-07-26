import { drawDefaultCell } from './DefaultCardPainter.js'
import {
  createArrayAtlasLayout,
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
const ARRAY_RASTER_BATCH_BYTES = 8 * 1024 * 1024

scope.onmessage = (event) => {
  const images = event.data.images
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
  const context = getContext(canvas)
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

  const maximumBatchLayers = Math.min(
    layout.depth,
    Math.max(1, Math.floor(ARRAY_RASTER_BATCH_BYTES / layout.layerByteLength)),
  )
  const batchColumns = Math.min(
    maximumBatchLayers,
    Math.max(1, Math.ceil(Math.sqrt(
      maximumBatchLayers * layout.height / layout.width,
    ))),
  )
  const batchRows = Math.max(1, Math.floor(maximumBatchLayers / batchColumns))
  const layersPerBatch = batchColumns * batchRows
  const canvas = new OffscreenCanvas(
    batchColumns * layout.width,
    batchRows * layout.height,
  )
  const context = getContext(canvas)
  const data = new Uint8Array(layout.layerByteLength * layout.depth)
  let cellRenderMs = 0
  let readbackMs = 0
  let packMs = 0
  for (let firstLayer = 0; firstLayer < layout.depth; firstLayer += layersPerBatch) {
    const batchLayerCount = Math.min(layersPerBatch, layout.depth - firstLayer)
    const readColumns = Math.min(batchColumns, batchLayerCount)
    const readRows = Math.ceil(batchLayerCount / batchColumns)
    const readWidth = readColumns * layout.width
    const readHeight = readRows * layout.height
    context.clearRect(0, 0, readWidth, readHeight)
    const cellRenderStartedAt = now()
    for (let batchLayer = 0; batchLayer < batchLayerCount; batchLayer += 1) {
      const layer = firstLayer + batchLayer
      const firstItem = layer * layout.pageCapacity
      const lastItem = Math.min(request.items.length, firstItem + layout.pageCapacity)
      const pageX = (batchLayer % batchColumns) * layout.width
      const pageY = Math.floor(batchLayer / batchColumns) * layout.height
      for (let index = firstItem; index < lastItem; index += 1) {
        const pageSlot = index - firstItem
        drawItem(
          context,
          request,
          request.items[index],
          pageSlot % layout.pageColumns,
          Math.floor(pageSlot / layout.pageColumns),
          pageX,
          pageY,
        )
      }
    }
    cellRenderMs += now() - cellRenderStartedAt

    const readbackStartedAt = now()
    const pixels = context.getImageData(0, 0, readWidth, readHeight).data
    readbackMs += now() - readbackStartedAt
    const packStartedAt = now()
    for (let batchLayer = 0; batchLayer < batchLayerCount; batchLayer += 1) {
      const layer = firstLayer + batchLayer
      const pageX = (batchLayer % batchColumns) * layout.width
      const pageY = Math.floor(batchLayer / batchColumns) * layout.height
      for (let row = 0; row < layout.height; row += 1) {
        const sourceOffset = ((pageY + row) * readWidth + pageX) * 4
        const targetOffset = layer * layout.layerByteLength
          + (layout.height - 1 - row) * layout.width * 4
        data.set(pixels.subarray(sourceOffset, sourceOffset + layout.width * 4), targetOffset)
      }
    }
    packMs += now() - packStartedAt
  }
  return { data, layout, cellRenderMs, readbackMs, packMs }
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

function getContext(canvas: OffscreenCanvas): OffscreenCanvasRenderingContext2D {
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Offscreen Canvas 2D context is unavailable')
  return context
}

function now(): number {
  return globalThis.performance?.now() ?? Date.now()
}
