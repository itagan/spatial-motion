import { DataTexture, LinearFilter, LinearMipmapLinearFilter, SRGBColorSpace } from 'three'
import type {
  CardContentRenderer,
  CardDrawBounds,
  CardStyle,
  CardTitleStyle,
  DrawCard,
  MotionItem,
  PreparedCardContent,
  ResolveCardStyle,
} from '../core/types.js'

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
  signal?: AbortSignal
}

export interface TextureAtlasResult {
  texture: DataTexture
  rects: Float32Array
  width: number
  height: number
  data: Uint8Array
  columns: number
  rows: number
  cellSize: number
  cellWidth: number
  cellHeight: number
  padding: number
  stride: number
  strideX: number
  strideY: number
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
  applyMs: number
  imageLoadMs: number
  imageRequests: number
  imageFailures: number
  uploadBytes: number
}

interface ImageLoadResult {
  image: HTMLImageElement | null
  durationMs: number
  failed: boolean
  requested: boolean
}

interface RenderedCell {
  canvas: HTMLCanvasElement
}

export class TextureAtlasImageCache {
  private readonly entries = new Map<string, HTMLImageElement>()

  constructor(private readonly maximumEntries = 128) {}

  get(url: string): HTMLImageElement | null {
    const image = this.entries.get(url)
    if (!image) return null
    this.entries.delete(url)
    this.entries.set(url, image)
    return image
  }

  set(url: string, image: HTMLImageElement): void {
    if (this.maximumEntries <= 0) return
    this.entries.delete(url)
    this.entries.set(url, image)
    while (this.entries.size > this.maximumEntries) {
      const oldest = this.entries.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.entries.delete(oldest)
    }
  }

  clear(): void {
    this.entries.clear()
  }
}

const loadImage = (
  url: string,
  timeoutMs: number,
  cache: TextureAtlasImageCache | undefined,
  signal: AbortSignal | undefined,
): Promise<ImageLoadResult> => {
  const cached = cache?.get(url)
  if (cached) return Promise.resolve({ image: cached, durationMs: 0, failed: false, requested: false })
  if (signal?.aborted) return Promise.reject(abortError())
  return new Promise((resolve, reject) => {
    const startedAt = now()
    const image = new Image()
    let settled = false
    const complete = (result: HTMLImageElement | null, aborted = false) => {
      if (settled) return
      settled = true
      window.clearTimeout(timeoutId)
      signal?.removeEventListener('abort', handleAbort)
      image.onload = null
      image.onerror = null
      if (aborted) {
        image.src = ''
        reject(abortError())
        return
      }
      if (result) cache?.set(url, result)
      resolve({ image: result, durationMs: now() - startedAt, failed: result === null, requested: true })
    }
    const timeoutId = window.setTimeout(() => complete(null), timeoutMs)
    const handleAbort = () => complete(null, true)
    signal?.addEventListener('abort', handleAbort, { once: true })
    image.crossOrigin = 'anonymous'
    image.onload = () => complete(image)
    image.onerror = () => complete(null)
    image.src = url
  })
}

export async function createTextureAtlas<TMeta = unknown>(
  items: MotionItem<TMeta>[],
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
  if (!canvas.getContext('2d')) throw new Error('Canvas 2D context is unavailable')

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

  const patch = await createTextureAtlasPatch(
    items,
    items.map((_item, index) => index),
    resolvedCellSize,
    options,
  )
  const applyStartedAt = now()
  drawPatchToCanvas(canvas, columns, cellWidth, cellHeight, padding, strideX, strideY, patch)
  patch.metrics.applyMs = now() - applyStartedAt
  const imageData = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height)
  if (!imageData) throw new Error('Canvas 2D image data is unavailable')
  const data = new Uint8Array(imageData.data)
  const texture = new DataTexture(data, canvas.width, canvas.height)
  texture.colorSpace = SRGBColorSpace
  texture.minFilter = LinearMipmapLinearFilter
  texture.magFilter = LinearFilter
  texture.generateMipmaps = true
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
  }
  return atlas
}

export async function createTextureAtlasPatch<TMeta = unknown>(
  items: MotionItem<TMeta>[],
  indices: number[],
  cellSize: number,
  options: TextureAtlasOptions<TMeta> = {},
): Promise<TextureAtlasPatch> {
  const startedAt = now()
  const uniqueIndices = [...new Set(indices)].filter((index) => index >= 0 && index < items.length)
  throwIfAborted(options.signal)
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
  const imageTimeout = resolveImageTimeout(options.imageTimeout)
  const imageUrls = [...new Set(uniqueIndices
    .flatMap((index) => {
      const entry = prepared?.get(index)
      if (entry?.content) return [...(entry.content.imageSources ?? [])]
      return !options.drawCard && !options.cardContent && items[index].image
        ? [items[index].image]
        : []
    })
    .filter((url): url is string => Boolean(url)))]
  const imageResults = await mapWithConcurrency(
    imageUrls,
    options.imageConcurrency,
    (url) => loadImage(url, imageTimeout, options.imageCache, options.signal),
    options.signal,
  )
  const images = new Map(imageUrls.map((url, index) => [url, imageResults[index]]))
  const resolvedImages = new Map(imageUrls.map((url, index) => [url, imageResults[index].image]))
  const { width: cellWidth, height: cellHeight } = resolveCellDimensions(
    cellSize,
    options.aspectRatio,
  )
  const renderedCells = await Promise.all(uniqueIndices.map(async (index) => ({
    index,
    rendered: await renderCell(
      items[index],
      cellWidth,
      cellHeight,
      options,
      items[index].image ? images.get(items[index].image) ?? null : null,
      prepared?.get(index),
      resolvedImages,
    ),
  })))
  throwIfAborted(options.signal)
  return {
    cells: renderedCells.map(({ index, rendered }) => ({ index, canvas: rendered.canvas })),
    metrics: {
      cells: renderedCells.length,
      renderMs: now() - startedAt,
      applyMs: 0,
      imageLoadMs: imageResults.reduce((sum, result) => sum + result.durationMs, 0),
      imageRequests: imageResults.filter((result) => result.requested).length,
      imageFailures: imageResults.filter((result) => result.failed).length,
      uploadBytes: 0,
    },
  }
}

export function applyTextureAtlasPatch(atlas: TextureAtlasResult, patch: TextureAtlasPatch): number {
  const startedAt = now()
  let uploadBytes = 0
  patch.cells.forEach(({ index, canvas }) => {
    const x = (index % atlas.columns) * atlas.strideX + atlas.padding
    const y = Math.floor(index / atlas.columns) * atlas.strideY + atlas.padding
    const context = canvas.getContext('2d')
    const imageData = context?.getImageData(0, 0, atlas.cellWidth, atlas.cellHeight)
    if (!imageData) throw new Error('Canvas 2D image data is unavailable')
    for (let row = 0; row < atlas.cellHeight; row += 1) {
      const sourceOffset = row * atlas.cellWidth * 4
      const targetOffset = ((y + row) * atlas.width + x) * 4
      const rowLength = atlas.cellWidth * 4
      atlas.data.set(imageData.data.subarray(sourceOffset, sourceOffset + rowLength), targetOffset)
      if (atlas.initialized) atlas.texture.addUpdateRange(targetOffset, rowLength)
      uploadBytes += rowLength
    }
  })
  if (!atlas.initialized) {
    atlas.texture.clearUpdateRanges()
    uploadBytes = atlas.data.byteLength
  }
  patch.metrics.uploadBytes = uploadBytes
  atlas.texture.needsUpdate = true
  return now() - startedAt
}

function drawPatchToCanvas(
  canvas: HTMLCanvasElement,
  columns: number,
  cellWidth: number,
  cellHeight: number,
  padding: number,
  strideX: number,
  strideY: number,
  patch: TextureAtlasPatch,
): void {
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D context is unavailable')
  patch.cells.forEach(({ index, canvas: cellCanvas }) => {
    const x = (index % columns) * strideX + padding
    const y = Math.floor(index / columns) * strideY + padding
    context.clearRect(x, y, cellWidth, cellHeight)
    context.drawImage(cellCanvas, x, y)
  })
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
      throwIfAborted(options.signal)
    } else if (options.drawCard) {
      await options.drawCard(context, item, bounds, style)
      throwIfAborted(options.signal)
    } else {
      drawDefaultCard(context, item, image, bounds, style)
    }
  } catch (error) {
    if (options.signal?.aborted) throw error
    drawDefaultCard(context, item, image, bounds, style)
  } finally {
    context.restore()
  }

  const borderWidth = Math.min(Math.min(cellWidth, cellHeight) / 2, Math.max(0, style.borderWidth ?? 0))
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

function resolveImageTimeout(value: number | undefined): number {
  return Number.isFinite(value) && (value ?? 0) > 0
    ? Math.min(60_000, Math.max(100, value as number))
    : 10_000
}

async function mapWithConcurrency<T, R>(
  values: T[],
  requestedConcurrency: number | undefined,
  task: (value: T) => Promise<R>,
  signal: AbortSignal | undefined,
): Promise<R[]> {
  if (!values.length) return []
  const concurrency = Math.min(values.length, Math.max(1, Math.floor(
    Number.isFinite(requestedConcurrency) ? requestedConcurrency as number : 6,
  )))
  const results = new Array<R>(values.length)
  let cursor = 0
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (cursor < values.length) {
      throwIfAborted(signal)
      const index = cursor
      cursor += 1
      results[index] = await task(values[index])
    }
  }))
  return results
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError()
}

function abortError(): DOMException {
  return new DOMException('Atlas aborted', 'AbortError')
}

export function resolveAtlasMetrics(
  count: number,
  requestedCellSize = 64,
  requestedMaxTextureSize = 16_384,
  requestedAspectRatio = 1,
): {
  columns: number
  rows: number
  cellSize: number
  cellWidth: number
  cellHeight: number
  padding: number
  stride: number
  strideX: number
  strideY: number
} {
  const safeCount = Math.max(1, Math.floor(Number.isFinite(count) ? count : 1))
  const aspectRatio = resolveAspectRatio(requestedAspectRatio)
  const normalizedWidth = aspectRatio >= 1 ? 1 : aspectRatio
  const normalizedHeight = aspectRatio >= 1 ? 1 / aspectRatio : 1
  const columns = Math.max(1, Math.min(
    safeCount,
    Math.ceil(Math.sqrt(safeCount * normalizedHeight / normalizedWidth)),
  ))
  const rows = Math.ceil(safeCount / columns)
  const maxTextureSize = Math.max(1, Math.floor(
    Number.isFinite(requestedMaxTextureSize) ? requestedMaxTextureSize : 16_384,
  ))
  const requested = Math.min(256, Math.max(32, Math.round(
    Number.isFinite(requestedCellSize) ? requestedCellSize : 64,
  )))
  const strideLimitX = Math.max(1, Math.floor(maxTextureSize / columns))
  const strideLimitY = Math.max(1, Math.floor(maxTextureSize / rows))
  const padding = Math.min(
    4,
    Math.max(0, Math.floor((Math.min(strideLimitX, strideLimitY) - 1) / 2)),
  )
  const maximumLongEdge = Math.max(1, Math.floor(Math.min(
    (strideLimitX - padding * 2) / normalizedWidth,
    (strideLimitY - padding * 2) / normalizedHeight,
  )))
  const cellSize = Math.min(requested, maximumLongEdge)
  const { width: cellWidth, height: cellHeight } = resolveCellDimensions(
    cellSize,
    aspectRatio,
  )
  const strideX = cellWidth + padding * 2
  const strideY = cellHeight + padding * 2
  return {
    columns,
    rows,
    cellSize,
    cellWidth,
    cellHeight,
    padding,
    stride: Math.max(strideX, strideY),
    strideX,
    strideY,
  }
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

function resolveCellDimensions(
  longestEdge: number,
  requestedAspectRatio: number | undefined,
): { width: number; height: number } {
  const aspectRatio = resolveAspectRatio(requestedAspectRatio)
  return aspectRatio >= 1
    ? { width: longestEdge, height: Math.max(1, Math.floor(longestEdge / aspectRatio)) }
    : { width: Math.max(1, Math.floor(longestEdge * aspectRatio)), height: longestEdge }
}

function resolveAspectRatio(value: number | undefined): number {
  return Number.isFinite(value) ? Math.min(4, Math.max(0.25, value as number)) : 1
}

function clamp(
  value: number | undefined,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value as number)) : fallback
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
