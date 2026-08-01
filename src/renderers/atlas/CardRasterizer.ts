import type {
  CardStyle,
  MotionItem,
  PreparedCardContent,
} from '../../core/types.js'
import type {
  TextureAtlasMetrics,
  TextureAtlasOptions,
  TextureAtlasPatch,
} from '../textureAtlas.js'
import { resolveCellDimensions } from './AtlasPlanner.js'
import {
  beginCardCell,
  drawDefaultCard,
  drawDefaultCell,
  finishCardCell,
  resolveCardStyle,
} from './DefaultCardPainter.js'
import {
  ImageResourcePool,
  type ImageResourceBatch,
  type ImageLoadResult,
  throwIfAtlasAborted,
} from './ImageResourcePool.js'

export interface AtlasRenderTarget {
  context: CanvasRenderingContext2D
  columns: number
  padding: number
  strideX: number
  strideY: number
  resolveCell?: (index: number) => { x: number; y: number }
  reuseCellCanvas?: boolean
  reusableCell?: {
    canvas: HTMLCanvasElement
    context: CanvasRenderingContext2D
  }
}

interface RenderedCell {
  canvas: HTMLCanvasElement
}

interface PreparedCardEntry {
  content?: PreparedCardContent
  failed: boolean
  style: CardStyle
}

export interface CardRasterSession {
  prepared?: ReadonlyMap<number, PreparedCardEntry>
  resources: ImageResourceBatch
  prepareMs: number
}

export interface RasterizedCardCells {
  cells: Array<{ index: number; canvas: HTMLCanvasElement }>
  cellRenderMs: number
  applyMs: number
}

export async function rasterizeCards<TMeta = unknown>(
  items: readonly MotionItem<TMeta>[],
  indices: readonly number[],
  cellSize: number,
  options: TextureAtlasOptions<TMeta>,
  renderTarget?: AtlasRenderTarget,
  resourceBatch?: ImageResourceBatch,
): Promise<TextureAtlasPatch> {
  const startedAt = now()
  const uniqueIndices = [...new Set(indices)].filter((index) => index >= 0 && index < items.length)
  const session = await prepareCardRasterSession(
    items,
    uniqueIndices,
    options,
    resourceBatch,
  )
  const rendered = await rasterizePreparedCards(
    items,
    uniqueIndices,
    cellSize,
    options,
    session,
    renderTarget,
  )
  throwIfAtlasAborted(options.signal)
  const metrics: TextureAtlasMetrics = {
    cells: uniqueIndices.length,
    renderMs: now() - startedAt,
    prepareMs: session.prepareMs,
    imageLoadWallMs: session.resources.wallTimeMs,
    cellRenderMs: rendered.cellRenderMs,
    applyMs: rendered.applyMs,
    readbackMs: 0,
    imageLoadMs: session.resources.totalLoadTimeMs,
    imageRequests: session.resources.requests,
    imageFailures: session.resources.failures,
    uploadBytes: 0,
    uploadRanges: 0,
    workerRenders: 0,
    imageBitmapDecodeMs: 0,
  }
  return { cells: rendered.cells, metrics }
}

export async function prepareCardRasterSession<TMeta = unknown>(
  items: readonly MotionItem<TMeta>[],
  indices: readonly number[],
  options: TextureAtlasOptions<TMeta>,
  resourceBatch?: ImageResourceBatch,
): Promise<CardRasterSession> {
  throwIfAtlasAborted(options.signal)
  const prepareStartedAt = now()
  const prepared = options.cardContent ? new Map<number, PreparedCardEntry>() : undefined
  indices.forEach((index) => {
    if (!options.cardContent || !prepared) return
    const style = resolveCardStyle(items[index], options)
    try {
      prepared.set(index, {
        content: options.cardContent.prepare(items[index], style),
        failed: false,
        style,
      })
    } catch {
      prepared.set(index, { failed: true, style })
    }
  })
  const imageUrls = [...new Set(indices
    .flatMap((index) => {
      const entry = prepared?.get(index)
      if (entry?.content) return [...(entry.content.imageSources ?? [])]
      return !options.drawCard && !options.cardContent && items[index].image
        ? [items[index].image]
        : []
    })
    .filter((url): url is string => Boolean(url)))]
  const prepareMs = now() - prepareStartedAt
  const resources = resourceBatch ?? await new ImageResourcePool({
      timeout: options.imageTimeout,
      concurrency: options.imageConcurrency,
      cache: options.imageCache,
      signal: options.signal,
    }).load(imageUrls)
  return { prepared, resources, prepareMs }
}

export async function rasterizePreparedCards<TMeta = unknown>(
  items: readonly MotionItem<TMeta>[],
  indices: readonly number[],
  cellSize: number,
  options: TextureAtlasOptions<TMeta>,
  session: CardRasterSession,
  renderTarget?: AtlasRenderTarget,
): Promise<RasterizedCardCells> {
  throwIfAtlasAborted(options.signal)
  const { width: cellWidth, height: cellHeight } = resolveCellDimensions(
    cellSize,
    options.aspectRatio,
  )
  let renderedCells: Array<{ index: number; rendered: RenderedCell }>
  let cellRenderMs = 0
  let applyMs = 0
  if (renderTarget && !options.cardContent && !options.drawCard) {
    const startedAt = now()
    renderedCells = renderDefaultCellsToAtlas(
      items,
      indices,
      cellWidth,
      cellHeight,
      options,
      session.resources.results,
      renderTarget,
    )
    cellRenderMs = now() - startedAt
  } else if (renderTarget?.reuseCellCanvas) {
    const direct = await renderCustomCellsToAtlas(
      items,
      indices,
      cellWidth,
      cellHeight,
      options,
      session,
      renderTarget,
    )
    renderedCells = []
    cellRenderMs = direct.cellRenderMs
    applyMs = direct.applyMs
  } else {
    const startedAt = now()
    renderedCells = await Promise.all(indices.map(async (index) => ({
        index,
        rendered: await renderCell(
          items[index],
          cellWidth,
          cellHeight,
          options,
          items[index].image
            ? session.resources.results.get(items[index].image) ?? null
            : null,
          session.prepared?.get(index),
          session.resources.images,
        ),
      })))
    cellRenderMs = now() - startedAt
  }
  throwIfAtlasAborted(options.signal)
  return {
    cells: renderedCells.map(({ index, rendered }) => ({ index, canvas: rendered.canvas })),
    cellRenderMs,
    applyMs,
  }
}

async function renderCustomCellsToAtlas<TMeta>(
  items: readonly MotionItem<TMeta>[],
  indices: readonly number[],
  cellWidth: number,
  cellHeight: number,
  options: TextureAtlasOptions<TMeta>,
  session: CardRasterSession,
  target: AtlasRenderTarget,
): Promise<{ cellRenderMs: number; applyMs: number }> {
  const canvas = target.reusableCell?.canvas ?? document.createElement('canvas')
  canvas.width = cellWidth
  canvas.height = cellHeight
  const context = target.reusableCell?.context ?? canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D context is unavailable')
  let cellRenderMs = 0
  let applyMs = 0

  for (const index of indices) {
    throwIfAtlasAborted(options.signal)
    const cellRenderStartedAt = now()
    resetCellCanvas(canvas, context, cellWidth, cellHeight)
    await renderCell(
      items[index],
      cellWidth,
      cellHeight,
      options,
      items[index].image
        ? session.resources.results.get(items[index].image) ?? null
        : null,
      session.prepared?.get(index),
      session.resources.images,
      canvas,
      context,
    )
    cellRenderMs += now() - cellRenderStartedAt
    const position = resolveTargetCell(target, index)
    const applyStartedAt = now()
    target.context.drawImage(canvas, position.x, position.y)
    applyMs += now() - applyStartedAt
  }
  return { cellRenderMs, applyMs }
}

function renderDefaultCellsToAtlas<TMeta>(
  items: readonly MotionItem<TMeta>[],
  indices: readonly number[],
  cellWidth: number,
  cellHeight: number,
  options: TextureAtlasOptions<TMeta>,
  images: ReadonlyMap<string, ImageLoadResult>,
  target: AtlasRenderTarget,
): Array<{ index: number; rendered: RenderedCell }> {
  indices.forEach((index) => {
    const item = items[index]
    const position = resolveTargetCell(target, index)
    const bounds = {
      x: position.x,
      y: position.y,
      width: cellWidth,
      height: cellHeight,
    }
    drawDefaultCell(
      target.context,
      item,
      item.image ? images.get(item.image)?.image ?? null : null,
      bounds,
      resolveCardStyle(item, options),
    )
  })
  return []
}

async function renderCell<TMeta>(
  item: MotionItem<TMeta>,
  cellWidth: number,
  cellHeight: number,
  options: TextureAtlasOptions<TMeta>,
  imageResult: ImageLoadResult | null,
  prepared: {
    content?: PreparedCardContent
    failed: boolean
    style: CardStyle
  } | undefined,
  images: ReadonlyMap<string, HTMLImageElement | null>,
  reusableCanvas?: HTMLCanvasElement,
  reusableContext?: CanvasRenderingContext2D,
): Promise<RenderedCell> {
  const canvas = reusableCanvas ?? document.createElement('canvas')
  if (!reusableCanvas) {
    canvas.width = cellWidth
    canvas.height = cellHeight
  }
  const context = reusableContext ?? canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Canvas 2D context is unavailable')
  const style = prepared?.style ?? resolveCardStyle(item, options)
  const bounds = { x: 0, y: 0, width: cellWidth, height: cellHeight }
  const image = imageResult?.image ?? null

  beginCardCell(context, bounds, style)
  try {
    if (prepared?.content && !prepared.failed) {
      await prepared.content.draw({
        context,
        bounds,
        resolvedStyle: style,
        images,
        signal: options.signal,
      })
      throwIfAtlasAborted(options.signal)
    } else if (options.drawCard) {
      await options.drawCard(context, item, bounds, style)
      throwIfAtlasAborted(options.signal)
    } else {
      drawDefaultCard(context, item, image, bounds, style)
    }
  } catch (error) {
    if (options.signal?.aborted) throw error
    drawDefaultCard(context, item, image, bounds, style)
  } finally {
    finishCardCell(context, bounds, style)
  }
  return { canvas }
}

function resolveTargetCell(
  target: AtlasRenderTarget,
  index: number,
): { x: number; y: number } {
  return target.resolveCell?.(index) ?? {
    x: (index % target.columns) * target.strideX + target.padding,
    y: Math.floor(index / target.columns) * target.strideY + target.padding,
  }
}

function resetCellCanvas(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  if (typeof context.reset === 'function') {
    context.reset()
    return
  }
  canvas.width = width
  canvas.height = height
}

function now(): number {
  return globalThis.performance?.now() ?? Date.now()
}
