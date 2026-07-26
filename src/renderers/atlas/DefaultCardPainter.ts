import type {
  CardDrawBounds,
  CardStyle,
  CardTitleStyle,
  MotionItem,
} from '../../core/types.js'
import type { TextureAtlasOptions } from '../textureAtlas.js'

export type CardCanvasContext =
  | CanvasRenderingContext2D
  | OffscreenCanvasRenderingContext2D

export function drawDefaultCell(
  context: CardCanvasContext,
  item: MotionItem,
  image: CanvasImageSource | null,
  bounds: CardDrawBounds,
  style: CardStyle,
): void {
  beginCardCell(context, bounds, style)
  drawDefaultCard(context, item, image, bounds, style)
  finishCardCell(context, bounds, style)
}

export function beginCardCell(
  context: CardCanvasContext,
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
}

export function finishCardCell(
  context: CardCanvasContext,
  bounds: CardDrawBounds,
  style: CardStyle,
): void {
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

export function resolveCardStyle<TMeta>(
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

export function drawDefaultCard(
  context: CardCanvasContext,
  item: MotionItem,
  image: CanvasImageSource | null,
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
  context: CardCanvasContext,
  image: CanvasImageSource,
  bounds: CardDrawBounds,
  style: CardStyle,
): void {
  const fit = style.imageFit ?? 'cover'
  const positionX = clamp(style.imagePosition?.x, 0, 1, 0.5)
  const positionY = clamp(style.imagePosition?.y, 0, 1, 0.5)
  const dimensions = resolveImageDimensions(image)
  const sourceWidth = Math.max(1, dimensions.width)
  const sourceHeight = Math.max(1, dimensions.height)
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

function resolveImageDimensions(image: CanvasImageSource): { width: number; height: number } {
  const source = image as unknown as {
    naturalWidth?: number
    naturalHeight?: number
    videoWidth?: number
    videoHeight?: number
    displayWidth?: number
    displayHeight?: number
    width?: number
    height?: number
  }
  return {
    width: source.naturalWidth ?? source.videoWidth ?? source.displayWidth ?? source.width ?? 1,
    height: source.naturalHeight ?? source.videoHeight ?? source.displayHeight ?? source.height ?? 1,
  }
}

function drawCardTitle(
  context: CardCanvasContext,
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
  context: CardCanvasContext,
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

function createCardPath(
  context: CardCanvasContext,
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

function hash(value: string): number {
  let result = 0
  for (let index = 0; index < value.length; index += 1) {
    result = (result << 5) - result + value.charCodeAt(index)
  }
  return result
}
