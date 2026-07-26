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
  type ImageLoadResult,
  throwIfAtlasAborted,
} from './ImageResourcePool.js'

export interface AtlasRenderTarget {
  context: CanvasRenderingContext2D
  columns: number
  padding: number
  strideX: number
  strideY: number
}

interface RenderedCell {
  canvas: HTMLCanvasElement
}

export async function rasterizeCards<TMeta = unknown>(
  items: readonly MotionItem<TMeta>[],
  indices: readonly number[],
  cellSize: number,
  options: TextureAtlasOptions<TMeta>,
  renderTarget?: AtlasRenderTarget,
): Promise<TextureAtlasPatch> {
  const startedAt = now()
  const uniqueIndices = [...new Set(indices)].filter((index) => index >= 0 && index < items.length)
  throwIfAtlasAborted(options.signal)
  const prepareStartedAt = now()
  const prepared = options.cardContent ? new Map<number, {
    content?: PreparedCardContent
    failed: boolean
    style: CardStyle
  }>() : undefined
  uniqueIndices.forEach((index) => {
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
  const imageUrls = [...new Set(uniqueIndices
    .flatMap((index) => {
      const entry = prepared?.get(index)
      if (entry?.content) return [...(entry.content.imageSources ?? [])]
      return !options.drawCard && !options.cardContent && items[index].image
        ? [items[index].image]
        : []
    })
    .filter((url): url is string => Boolean(url)))]
  const prepareMs = now() - prepareStartedAt
  const resources = await new ImageResourcePool({
    timeout: options.imageTimeout,
    concurrency: options.imageConcurrency,
    cache: options.imageCache,
    signal: options.signal,
  }).load(imageUrls)
  const { width: cellWidth, height: cellHeight } = resolveCellDimensions(
    cellSize,
    options.aspectRatio,
  )
  const cellRenderStartedAt = now()
  const renderedCells = renderTarget && !options.cardContent && !options.drawCard
    ? renderDefaultCellsToAtlas(
        items,
        uniqueIndices,
        cellWidth,
        cellHeight,
        options,
        resources.results,
        renderTarget,
      )
    : await Promise.all(uniqueIndices.map(async (index) => ({
        index,
        rendered: await renderCell(
          items[index],
          cellWidth,
          cellHeight,
          options,
          items[index].image ? resources.results.get(items[index].image) ?? null : null,
          prepared?.get(index),
          resources.images,
        ),
      })))
  const cellRenderMs = now() - cellRenderStartedAt
  throwIfAtlasAborted(options.signal)
  const metrics: TextureAtlasMetrics = {
    cells: uniqueIndices.length,
    renderMs: now() - startedAt,
    prepareMs,
    imageLoadWallMs: resources.wallTimeMs,
    cellRenderMs,
    applyMs: 0,
    readbackMs: 0,
    imageLoadMs: resources.totalLoadTimeMs,
    imageRequests: resources.requests,
    imageFailures: resources.failures,
    uploadBytes: 0,
    uploadRanges: 0,
    workerRenders: 0,
  }
  return {
    cells: renderedCells.map(({ index, rendered }) => ({ index, canvas: rendered.canvas })),
    metrics,
  }
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
    const bounds = {
      x: (index % target.columns) * target.strideX + target.padding,
      y: Math.floor(index / target.columns) * target.strideY + target.padding,
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
): Promise<RenderedCell> {
  const canvas = document.createElement('canvas')
  canvas.width = cellWidth
  canvas.height = cellHeight
  const context = canvas.getContext('2d')
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

function now(): number {
  return globalThis.performance?.now() ?? Date.now()
}
