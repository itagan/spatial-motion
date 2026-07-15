import { CanvasTexture, LinearFilter, SRGBColorSpace } from 'three'
import type { CardDrawBounds, CardStyle, DrawCard, MotionItem } from '../core/types.js'

export interface TextureAtlasOptions {
  cardStyle?: CardStyle
  drawCard?: DrawCard
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
}

export interface TextureAtlasPatch {
  cells: Array<{ index: number; canvas: HTMLCanvasElement }>
}

const loadImage = (url: string): Promise<HTMLImageElement | null> =>
  new Promise((resolve) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => resolve(null)
    image.src = url
  })

export async function createTextureAtlas(
  items: MotionItem[],
  cellSize = 64,
  options: TextureAtlasOptions = {},
): Promise<TextureAtlasResult> {
  const padding = 2
  const stride = cellSize + padding * 2
  const columns = Math.ceil(Math.sqrt(items.length || 1))
  const rows = Math.ceil(Math.max(1, items.length) / columns)
  const canvas = document.createElement('canvas')
  canvas.width = columns * stride
  canvas.height = rows * stride
  if (!canvas.getContext('2d')) throw new Error('Canvas 2D context is unavailable')

  const rects = new Float32Array(items.length * 4)
  items.forEach((_item, index) => {
    const x = (index % columns) * stride + padding
    const y = Math.floor(index / columns) * stride + padding
    rects.set(
      [x / canvas.width, 1 - (y + cellSize) / canvas.height, cellSize / canvas.width, cellSize / canvas.height],
      index * 4,
    )
  })

  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.minFilter = LinearFilter
  texture.magFilter = LinearFilter
  texture.generateMipmaps = false
  const atlas = { texture, rects, width: canvas.width, height: canvas.height, canvas, columns, cellSize, padding, stride }
  const patch = await createTextureAtlasPatch(items, items.map((_item, index) => index), cellSize, options)
  applyTextureAtlasPatch(atlas, patch)
  return atlas
}

export async function createTextureAtlasPatch(
  items: MotionItem[],
  indices: number[],
  cellSize: number,
  options: TextureAtlasOptions = {},
): Promise<TextureAtlasPatch> {
  const uniqueIndices = [...new Set(indices)].filter((index) => index >= 0 && index < items.length)
  const cells = await Promise.all(uniqueIndices.map(async (index) => ({
    index,
    canvas: await renderCell(items[index], cellSize, options),
  })))
  return { cells }
}

export function applyTextureAtlasPatch(atlas: TextureAtlasResult, patch: TextureAtlasPatch): void {
  const context = atlas.canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D context is unavailable')
  patch.cells.forEach(({ index, canvas }) => {
    const x = (index % atlas.columns) * atlas.stride + atlas.padding
    const y = Math.floor(index / atlas.columns) * atlas.stride + atlas.padding
    context.clearRect(x, y, atlas.cellSize, atlas.cellSize)
    context.drawImage(canvas, x, y)
  })
  atlas.texture.needsUpdate = true
}

async function renderCell(
  item: MotionItem,
  cellSize: number,
  options: TextureAtlasOptions,
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas')
  canvas.width = cellSize
  canvas.height = cellSize
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D context is unavailable')
  const style = options.cardStyle ?? {}
  const bounds = { x: 0, y: 0, width: cellSize, height: cellSize }
  const image = !options.drawCard && item.image ? await loadImage(item.image) : null

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
  return canvas
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
