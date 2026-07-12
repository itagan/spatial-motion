import { CanvasTexture, LinearFilter, SRGBColorSpace } from 'three'
import type { MotionItem } from '../core/types'

export interface TextureAtlasResult {
  texture: CanvasTexture
  rects: Float32Array
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
): Promise<TextureAtlasResult> {
  const padding = 2
  const stride = cellSize + padding * 2
  const columns = Math.ceil(Math.sqrt(items.length || 1))
  const rows = Math.ceil(Math.max(1, items.length) / columns)
  const canvas = document.createElement('canvas')
  canvas.width = columns * stride
  canvas.height = rows * stride
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D context is unavailable')

  const rects = new Float32Array(items.length * 4)
  const images = await Promise.all(items.map((item) => (item.image ? loadImage(item.image) : null)))
  items.forEach((item, index) => {
    const x = (index % columns) * stride + padding
    const y = Math.floor(index / columns) * stride + padding
    const image = images[index]
    if (image) {
      const sourceSize = Math.min(image.naturalWidth, image.naturalHeight)
      const sourceX = (image.naturalWidth - sourceSize) / 2
      const sourceY = (image.naturalHeight - sourceSize) / 2
      context.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, x, y, cellSize, cellSize)
    } else {
      const hue = Math.abs(hash(item.id)) % 360
      context.fillStyle = `hsl(${hue} 55% 42%)`
      context.fillRect(x, y, cellSize, cellSize)
      context.fillStyle = 'rgba(255,255,255,.85)'
      context.font = `600 ${cellSize * 0.32}px sans-serif`
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.fillText((item.title || item.id).slice(0, 2), x + cellSize / 2, y + cellSize / 2)
    }
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
  texture.needsUpdate = true
  return { texture, rects }
}

function hash(value: string): number {
  let result = 0
  for (let i = 0; i < value.length; i += 1) result = (result << 5) - result + value.charCodeAt(i)
  return result
}
