import { DataTexture, LinearFilter, LinearMipmapLinearFilter, SRGBColorSpace } from 'three'
import type { CardDrawBounds, CardStyle, DrawCard, MotionItem } from '../core/types.js'

export interface TextureAtlasOptions {
  cardStyle?: CardStyle
  drawCard?: DrawCard
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
  cellSize: number
  padding: number
  stride: number
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

export async function createTextureAtlas(
  items: MotionItem[],
  cellSize = 64,
  options: TextureAtlasOptions = {},
): Promise<TextureAtlasResult> {
  const startedAt = now()
  const { padding, stride, columns, rows, cellSize: resolvedCellSize } = resolveAtlasMetrics(
    items.length,
    cellSize,
    options.maxTextureSize,
  )
  const canvas = document.createElement('canvas')
  canvas.width = columns * stride
  canvas.height = rows * stride
  if (!canvas.getContext('2d')) throw new Error('Canvas 2D context is unavailable')

  const rects = new Float32Array(items.length * 4)
  items.forEach((_item, index) => {
    const x = (index % columns) * stride + padding
    const y = Math.floor(index / columns) * stride + padding
    rects.set(
      [x / canvas.width, 1 - (y + resolvedCellSize) / canvas.height, resolvedCellSize / canvas.width, resolvedCellSize / canvas.height],
      index * 4,
    )
  })

  const patch = await createTextureAtlasPatch(items, items.map((_item, index) => index), resolvedCellSize, options)
  const applyStartedAt = now()
  drawPatchToCanvas(canvas, columns, resolvedCellSize, padding, stride, patch)
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
    cellSize: resolvedCellSize,
    padding,
    stride,
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

export async function createTextureAtlasPatch(
  items: MotionItem[],
  indices: number[],
  cellSize: number,
  options: TextureAtlasOptions = {},
): Promise<TextureAtlasPatch> {
  const startedAt = now()
  const uniqueIndices = [...new Set(indices)].filter((index) => index >= 0 && index < items.length)
  throwIfAborted(options.signal)
  const imageTimeout = resolveImageTimeout(options.imageTimeout)
  const imageUrls = [...new Set(uniqueIndices
    .map((index) => !options.drawCard ? items[index].image : undefined)
    .filter((url): url is string => Boolean(url)))]
  const imageResults = await mapWithConcurrency(
    imageUrls,
    options.imageConcurrency,
    (url) => loadImage(url, imageTimeout, options.imageCache, options.signal),
    options.signal,
  )
  const images = new Map(imageUrls.map((url, index) => [url, imageResults[index]]))
  const renderedCells = await Promise.all(uniqueIndices.map(async (index) => ({
    index,
    rendered: await renderCell(items[index], cellSize, options, items[index].image
      ? images.get(items[index].image) ?? null
      : null),
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
    const x = (index % atlas.columns) * atlas.stride + atlas.padding
    const y = Math.floor(index / atlas.columns) * atlas.stride + atlas.padding
    const context = canvas.getContext('2d')
    const imageData = context?.getImageData(0, 0, atlas.cellSize, atlas.cellSize)
    if (!imageData) throw new Error('Canvas 2D image data is unavailable')
    for (let row = 0; row < atlas.cellSize; row += 1) {
      const sourceOffset = row * atlas.cellSize * 4
      const targetOffset = ((y + row) * atlas.width + x) * 4
      const rowLength = atlas.cellSize * 4
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
  cellSize: number,
  padding: number,
  stride: number,
  patch: TextureAtlasPatch,
): void {
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D context is unavailable')
  patch.cells.forEach(({ index, canvas: cellCanvas }) => {
    const x = (index % columns) * stride + padding
    const y = Math.floor(index / columns) * stride + padding
    context.clearRect(x, y, cellSize, cellSize)
    context.drawImage(cellCanvas, x, y)
  })
}

async function renderCell(
  item: MotionItem,
  cellSize: number,
  options: TextureAtlasOptions,
  imageResult: ImageLoadResult | null,
): Promise<RenderedCell> {
  const canvas = document.createElement('canvas')
  canvas.width = cellSize
  canvas.height = cellSize
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D context is unavailable')
  const style = options.cardStyle ?? {}
  const bounds = { x: 0, y: 0, width: cellSize, height: cellSize }
  const image = imageResult?.image ?? null

  context.save()
  createCardPath(context, bounds, style)
  if (style.backgroundColor) {
    context.fillStyle = style.backgroundColor
    context.fill()
  }
  context.clip()
  try {
    if (options.drawCard) {
      await options.drawCard(context, item, bounds)
      throwIfAborted(options.signal)
    } else {
      drawDefaultCard(context, item, image, bounds)
    }
  } catch (error) {
    if (options.signal?.aborted) throw error
    drawDefaultCard(context, item, image, bounds)
  } finally {
    context.restore()
  }

  const borderWidth = Math.min(cellSize / 2, Math.max(0, style.borderWidth ?? 0))
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
): { columns: number; rows: number; cellSize: number; padding: number; stride: number } {
  const safeCount = Math.max(1, Math.floor(Number.isFinite(count) ? count : 1))
  const columns = Math.ceil(Math.sqrt(safeCount))
  const rows = Math.ceil(safeCount / columns)
  const maxTextureSize = Math.max(1, Math.floor(
    Number.isFinite(requestedMaxTextureSize) ? requestedMaxTextureSize : 16_384,
  ))
  const requested = Math.min(256, Math.max(32, Math.round(
    Number.isFinite(requestedCellSize) ? requestedCellSize : 64,
  )))
  const strideLimit = Math.max(1, Math.floor(maxTextureSize / Math.max(columns, rows)))
  const padding = Math.min(4, Math.max(0, Math.floor((strideLimit - 1) / 2)))
  const cellSize = Math.min(requested, Math.max(1, strideLimit - padding * 2))
  return { columns, rows, cellSize, padding, stride: cellSize + padding * 2 }
}

function drawDefaultCard(
  context: CanvasRenderingContext2D,
  item: MotionItem,
  image: HTMLImageElement | null,
  bounds: CardDrawBounds,
): void {
  if (image) {
    const sourceSize = Math.min(image.naturalWidth, image.naturalHeight)
    const sourceX = (image.naturalWidth - sourceSize) / 2
    const sourceY = (image.naturalHeight - sourceSize) / 2
    context.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, bounds.x, bounds.y, bounds.width, bounds.height)
    return
  }
  const hue = Math.abs(hash(item.id)) % 360
  context.fillStyle = `hsl(${hue} 55% 42%)`
  context.fillRect(bounds.x, bounds.y, bounds.width, bounds.height)
  context.fillStyle = 'rgba(255,255,255,.85)'
  context.font = `600 ${bounds.width * 0.32}px sans-serif`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText((item.title || item.id).slice(0, 2), bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
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
