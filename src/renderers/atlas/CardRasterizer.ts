import type {
  CardDrawBounds,
  CardStyle,
  CardTitleStyle,
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

function drawDefaultCell(
  context: CanvasRenderingContext2D,
  item: MotionItem,
  image: HTMLImageElement | null,
  bounds: CardDrawBounds,
  style: CardStyle,
): void {
  context.save()
  createCardPath(context, bounds, style)
  if (style.backgroundColor) {
    context.fillStyle = style.backgroundColor
    context.fill()
  }
  context.clip()
  drawDefaultCard(context, item, image, bounds, style)
  context.restore()

  const borderWidth = Math.min(
    Math.min(bounds.width, bounds.height) / 2,
    Math.max(0, style.borderWidth ?? 0),
  )
  if (borderWidth <= 0) return
  context.save()
  context.lineWidth = borderWidth
  context.strokeStyle = style.borderColor ?? '#ffffff'
  createCardPath(context, inset(bounds, borderWidth / 2), style)
  context.stroke()
  context.restore()
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

  context.save()
  createCardPath(context, bounds, style)
  if (style.backgroundColor) {
    context.fillStyle = style.backgroundColor
    context.fill()
  }
  context.clip()
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
    context.restore()
  }

  const borderWidth = Math.min(
    Math.min(cellWidth, cellHeight) / 2,
    Math.max(0, style.borderWidth ?? 0),
  )
  if (borderWidth > 0) {
    context.save()
    context.lineWidth = borderWidth
    context.strokeStyle = style.borderColor ?? '#ffffff'
    createCardPath(context, inset(bounds, borderWidth / 2), style)
    context.stroke()
    context.restore()
  }
  return { canvas }
}

function drawDefaultCard(
  context: CanvasRenderingContext2D,
  item: MotionItem,
  image: HTMLImageElement | null,
  bounds: CardDrawBounds,
  style: CardStyle,
): void {
  const padding = Math.min(bounds.width, bounds.height)
    * clamp(style.contentPadding, 0, 0.45, 0)
  const contentBounds = inset(bounds, padding)
  if (image) {
    drawCardImage(context, image, contentBounds, style)
  } else {
    const hue = Math.abs(hash(item.id)) % 360
    context.fillStyle = `hsl(${hue} 55% 42%)`
    context.fillRect(contentBounds.x, contentBounds.y, contentBounds.width, contentBounds.height)
    context.fillStyle = 'rgba(255,255,255,.85)'
    context.font = `600 ${Math.min(contentBounds.width, contentBounds.height) * 0.32}px sans-serif`
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(
      (item.title || item.id).slice(0, 2),
      contentBounds.x + contentBounds.width / 2,
      contentBounds.y + contentBounds.height / 2,
    )
  }
  if (style.overlayColor) {
    context.fillStyle = style.overlayColor
    context.fillRect(contentBounds.x, contentBounds.y, contentBounds.width, contentBounds.height)
  }
  if (style.titleStyle && item.title) {
    drawCardTitle(context, item.title, contentBounds, style.titleStyle)
  }
}

function drawCardImage(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  bounds: CardDrawBounds,
  style: CardStyle,
): void {
  const fit = style.imageFit ?? 'cover'
  const positionX = clamp(style.imagePosition?.x, 0, 1, 0.5)
  const positionY = clamp(style.imagePosition?.y, 0, 1, 0.5)
  const sourceWidth = Math.max(1, image.naturalWidth)
  const sourceHeight = Math.max(1, image.naturalHeight)
  if (fit === 'fill') {
    context.drawImage(image, bounds.x, bounds.y, bounds.width, bounds.height)
    return
  }
  const sourceAspect = sourceWidth / sourceHeight
  const targetAspect = bounds.width / Math.max(1, bounds.height)
  if (fit === 'contain') {
    const width = sourceAspect >= targetAspect ? bounds.width : bounds.height * sourceAspect
    const height = sourceAspect >= targetAspect ? bounds.width / sourceAspect : bounds.height
    context.drawImage(
      image,
      bounds.x + (bounds.width - width) * positionX,
      bounds.y + (bounds.height - height) * positionY,
      width,
      height,
    )
    return
  }
  const cropWidth = sourceAspect >= targetAspect ? sourceHeight * targetAspect : sourceWidth
  const cropHeight = sourceAspect >= targetAspect ? sourceHeight : sourceWidth / targetAspect
  context.drawImage(
    image,
    (sourceWidth - cropWidth) * positionX,
    (sourceHeight - cropHeight) * positionY,
    cropWidth,
    cropHeight,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
  )
}

function drawCardTitle(
  context: CanvasRenderingContext2D,
  title: string,
  bounds: CardDrawBounds,
  style: CardTitleStyle,
): void {
  const fontSize = bounds.height * clamp(style.fontSizeRatio, 0.04, 0.5, 0.14)
  const lineHeight = fontSize * clamp(style.lineHeight, 0.8, 2, 1.2)
  const maximumLines = Math.round(clamp(style.maxLines, 1, 3, 1))
  context.font = `${style.fontWeight ?? 600} ${fontSize}px ${style.fontFamily ?? 'sans-serif'}`
  context.textAlign = style.align ?? 'center'
  context.textBaseline = 'middle'
  const lines = wrapTitle(context, title, bounds.width, maximumLines)
  const blockHeight = lines.length * lineHeight
  const position = style.position ?? 'bottom'
  const blockTop = position === 'top'
    ? bounds.y
    : position === 'center'
      ? bounds.y + (bounds.height - blockHeight) / 2
      : bounds.y + bounds.height - blockHeight
  if (style.backgroundColor) {
    context.fillStyle = style.backgroundColor
    context.fillRect(bounds.x, blockTop, bounds.width, blockHeight)
  }
  context.fillStyle = style.color ?? '#ffffff'
  const textX = style.align === 'left'
    ? bounds.x
    : style.align === 'right'
      ? bounds.x + bounds.width
      : bounds.x + bounds.width / 2
  lines.forEach((line, index) => {
    context.fillText(line, textX, blockTop + lineHeight * (index + 0.5))
  })
}

function wrapTitle(
  context: CanvasRenderingContext2D,
  title: string,
  maximumWidth: number,
  maximumLines: number,
): string[] {
  const characters = Array.from(title)
  const lines: string[] = []
  let line = ''
  while (characters.length && lines.length < maximumLines) {
    const character = characters.shift()!
    const candidate = line + character
    if (line && context.measureText(candidate).width > maximumWidth) {
      lines.push(line)
      line = character
    } else {
      line = candidate
    }
  }
  if (line && lines.length < maximumLines) lines.push(line)
  if (characters.length && lines.length) {
    let last = lines.at(-1) ?? ''
    while (last && context.measureText(`${last}…`).width > maximumWidth) {
      last = Array.from(last).slice(0, -1).join('')
    }
    lines[lines.length - 1] = `${last}…`
  }
  return lines.length ? lines : ['']
}

function resolveCardStyle<TMeta>(
  item: MotionItem<TMeta>,
  options: TextureAtlasOptions<TMeta>,
): CardStyle {
  const base = options.cardStyle ?? {}
  let override: CardStyle | undefined
  try {
    override = options.resolveCardStyle?.(item)
  } catch {
    override = undefined
  }
  const merged = {
    ...base,
    ...override,
    imagePosition: base.imagePosition || override?.imagePosition
      ? { ...base.imagePosition, ...override?.imagePosition }
      : undefined,
    titleStyle: base.titleStyle || override?.titleStyle
      ? { ...base.titleStyle, ...override?.titleStyle }
      : undefined,
  }
  const titleStyle = merged.titleStyle
    ? {
        color: merged.titleStyle.color ?? '#ffffff',
        backgroundColor: merged.titleStyle.backgroundColor,
        fontFamily: merged.titleStyle.fontFamily ?? 'sans-serif',
        fontWeight: merged.titleStyle.fontWeight ?? 600,
        fontSizeRatio: clamp(merged.titleStyle.fontSizeRatio, 0.04, 0.5, 0.14),
        position: merged.titleStyle.position ?? 'bottom',
        align: merged.titleStyle.align ?? 'center',
        lineHeight: clamp(merged.titleStyle.lineHeight, 0.8, 2, 1.2),
        maxLines: Math.round(clamp(merged.titleStyle.maxLines, 1, 3, 1)) as 1 | 2 | 3,
      }
    : undefined
  return {
    ...merged,
    imageFit: merged.imageFit ?? 'cover',
    imagePosition: {
      x: clamp(merged.imagePosition?.x, 0, 1, 0.5),
      y: clamp(merged.imagePosition?.y, 0, 1, 0.5),
    },
    contentPadding: clamp(merged.contentPadding, 0, 0.45, 0),
    titleStyle,
  }
}

function clamp(
  value: number | undefined,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  return Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value as number))
    : fallback
}

function createCardPath(
  context: CanvasRenderingContext2D,
  bounds: CardDrawBounds,
  style: CardStyle,
): void {
  context.beginPath()
  if (style.shape === 'circle') {
    context.arc(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
      Math.min(bounds.width, bounds.height) / 2,
      0,
      Math.PI * 2,
    )
    context.closePath()
    return
  }
  if (style.shape === 'rounded') {
    const radius = Math.min(
      Math.max(0, style.cornerRadius ?? 8),
      bounds.width / 2,
      bounds.height / 2,
    )
    const right = bounds.x + bounds.width
    const bottom = bounds.y + bounds.height
    context.moveTo(bounds.x + radius, bounds.y)
    context.lineTo(right - radius, bounds.y)
    context.quadraticCurveTo(right, bounds.y, right, bounds.y + radius)
    context.lineTo(right, bottom - radius)
    context.quadraticCurveTo(right, bottom, right - radius, bottom)
    context.lineTo(bounds.x + radius, bottom)
    context.quadraticCurveTo(bounds.x, bottom, bounds.x, bottom - radius)
    context.lineTo(bounds.x, bounds.y + radius)
    context.quadraticCurveTo(bounds.x, bounds.y, bounds.x + radius, bounds.y)
    context.closePath()
    return
  }
  context.rect(bounds.x, bounds.y, bounds.width, bounds.height)
}

function inset(bounds: CardDrawBounds, amount: number): CardDrawBounds {
  return {
    x: bounds.x + amount,
    y: bounds.y + amount,
    width: Math.max(0, bounds.width - amount * 2),
    height: Math.max(0, bounds.height - amount * 2),
  }
}

function hash(value: string): number {
  let result = 0
  for (let index = 0; index < value.length; index += 1) {
    result = (result << 5) - result + value.charCodeAt(index)
  }
  return result
}

function now(): number {
  return globalThis.performance?.now() ?? Date.now()
}
