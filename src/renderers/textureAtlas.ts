import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, SRGBColorSpace } from 'three'
import type { CardDrawBounds, CardStyle, DrawCard, MotionItem } from '../core/types.js'

export interface TextureAtlasOptions {
  cardStyle?: CardStyle
  drawCard?: DrawCard
  imageTimeout?: number
  maxTextureSize?: number
  anisotropy?: number
}

export interface TextureAtlasResult {
  texture: CanvasTexture
  rects: Float32Array
  width: number
  height: number
  canvas: HTMLCanvasElement
  columns: number
  cellSize: number
  padding: number
  stride: number
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
}

interface ImageLoadResult {
  image: HTMLImageElement | null
  durationMs: number
  failed: boolean
}

interface RenderedCell {
  canvas: HTMLCanvasElement
  imageLoadMs: number
  imageRequests: number
  imageFailures: number
}

const loadImage = (url: string, timeoutMs: number): Promise<ImageLoadResult> =>
  new Promise((resolve) => {
    const startedAt = now()
    const image = new Image()
    let settled = false
    const complete = (result: HTMLImageElement | null) => {
      if (settled) return
      settled = true
      window.clearTimeout(timeoutId)
      image.onload = null
      image.onerror = null
      resolve({ image: result, durationMs: now() - startedAt, failed: result === null })
    }
    const timeoutId = window.setTimeout(() => complete(null), timeoutMs)
    image.crossOrigin = 'anonymous'
    image.onload = () => complete(image)
    image.onerror = () => complete(null)
    image.src = url
  })

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

  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.minFilter = LinearMipmapLinearFilter
  texture.magFilter = LinearFilter
  texture.generateMipmaps = true
  texture.anisotropy = Math.max(1, Math.floor(options.anisotropy ?? 1))
  const patch = await createTextureAtlasPatch(items, items.map((_item, index) => index), resolvedCellSize, options)
  const atlas: TextureAtlasResult = {
    texture,
    rects,
    width: canvas.width,
    height: canvas.height,
    canvas,
    columns,
    cellSize: resolvedCellSize,
    padding,
    stride,
    metrics: patch.metrics,
  }
  patch.metrics.applyMs = applyTextureAtlasPatch(atlas, patch)
  atlas.metrics = { ...patch.metrics, renderMs: now() - startedAt }
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
  const renderedCells = await Promise.all(uniqueIndices.map(async (index) => ({
    index,
    rendered: await renderCell(items[index], cellSize, options),
  })))
  return {
    cells: renderedCells.map(({ index, rendered }) => ({ index, canvas: rendered.canvas })),
    metrics: {
      cells: renderedCells.length,
      renderMs: now() - startedAt,
      applyMs: 0,
      imageLoadMs: renderedCells.reduce((sum, { rendered }) => sum + rendered.imageLoadMs, 0),
      imageRequests: renderedCells.reduce((sum, { rendered }) => sum + rendered.imageRequests, 0),
      imageFailures: renderedCells.reduce((sum, { rendered }) => sum + rendered.imageFailures, 0),
    },
  }
}

export function applyTextureAtlasPatch(atlas: TextureAtlasResult, patch: TextureAtlasPatch): number {
  const startedAt = now()
  const context = atlas.canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D context is unavailable')
  patch.cells.forEach(({ index, canvas }) => {
    const x = (index % atlas.columns) * atlas.stride + atlas.padding
    const y = Math.floor(index / atlas.columns) * atlas.stride + atlas.padding
    context.clearRect(x, y, atlas.cellSize, atlas.cellSize)
    context.drawImage(canvas, x, y)
  })
  atlas.texture.needsUpdate = true
  return now() - startedAt
}

async function renderCell(
  item: MotionItem,
  cellSize: number,
  options: TextureAtlasOptions,
): Promise<RenderedCell> {
  const canvas = document.createElement('canvas')
  canvas.width = cellSize
  canvas.height = cellSize
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D context is unavailable')
  const style = options.cardStyle ?? {}
  const bounds = { x: 0, y: 0, width: cellSize, height: cellSize }
  const imageTimeout = Number.isFinite(options.imageTimeout) && (options.imageTimeout ?? 0) > 0
    ? Math.min(60_000, Math.max(100, options.imageTimeout as number))
    : 10_000
  const imageResult = !options.drawCard && item.image
    ? await loadImage(item.image, imageTimeout)
    : null
  const image = imageResult?.image ?? null

  context.save()
  createCardPath(context, bounds, style)
  if (style.backgroundColor) {
    context.fillStyle = style.backgroundColor
    context.fill()
  }
  context.clip()
  try {
    if (options.drawCard) await options.drawCard(context, item, bounds)
    else drawDefaultCard(context, item, image, bounds)
  } catch {
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
  return {
    canvas,
    imageLoadMs: imageResult?.durationMs ?? 0,
    imageRequests: imageResult ? 1 : 0,
    imageFailures: imageResult?.failed ? 1 : 0,
  }
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
