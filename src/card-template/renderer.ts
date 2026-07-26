import type {
  CardContentDrawContext,
  CardContentRenderer,
  CardStyle,
  MotionItem,
  PreparedCardContent,
} from '../core/types.js'
import { resolveTemplate, type RuntimeElement, type RuntimeNode } from './compiler.js'
import { templateHelpers } from './helpers.js'
import {
  CardTemplateError,
  type CardTemplateItem,
  type CardTemplateResult,
  type CardTemplateStyle,
  type DefineCardTemplateOptions,
} from './types.js'

type Rect = { x: number; y: number; width: number; height: number }
type Edges = { top: number; right: number; bottom: number; left: number }
type ResolvedStyle = CardTemplateStyle & {
  paddingEdges: Edges
  marginEdges: Edges
}

const textStyleKeys = [
  'color',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'textAlign',
  'lineClamp',
  'whiteSpace',
] as const

const supportedStyles = new Set<keyof CardTemplateStyle>([
  'display', 'flexDirection', 'justifyContent', 'alignItems', 'flex', 'position',
  'width', 'height', 'top', 'right', 'bottom', 'left',
  'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'gap',
  'background', 'backgroundColor', 'border', 'borderWidth', 'borderColor',
  'borderRadius', 'opacity', 'overflow', 'color', 'fontFamily', 'fontSize',
  'fontWeight', 'lineHeight', 'textAlign', 'lineClamp', 'whiteSpace',
  'objectFit', 'objectPosition',
])

export function defineCardTemplate<TMeta = unknown>(
  render: (
    item: Readonly<CardTemplateItem<TMeta>>,
    helpers: typeof templateHelpers,
  ) => CardTemplateResult,
  options: DefineCardTemplateOptions<TMeta> = {},
): CardContentRenderer<TMeta> {
  const classStyles = Object.fromEntries(Object.entries(options.styles ?? {}).map(([name, style]) => [
    name,
    validateStyle(style),
  ]))
  return {
    prepare(
      item: Readonly<MotionItem<TMeta>>,
      _resolvedStyle: Readonly<CardStyle>,
    ): PreparedCardContent {
      let nodes: RuntimeNode[]
      try {
        nodes = resolveTemplate(render(item as Readonly<CardTemplateItem<TMeta>>, templateHelpers))
      } catch (error) {
        const templateError = normalizeError(error)
        options.onError?.(templateError, item)
        throw templateError
      }
      const imageSources = [...new Set(collectImageSources(nodes))]
      return {
        imageSources,
        draw(drawContext) {
          try {
            paintTemplate(nodes, drawContext, classStyles)
          } catch (error) {
            const templateError = normalizeError(error)
            options.onError?.(templateError, item)
            throw templateError
          }
        },
      }
    },
  }
}

function paintTemplate(
  nodes: RuntimeNode[],
  drawContext: CardContentDrawContext,
  classStyles: Record<string, CardTemplateStyle>,
): void {
  const children = materializeTextNodes(nodes)
  const rootStyle = resolveStyle({}, drawContext.bounds, {})
  layoutChildren(
    children,
    drawContext.bounds,
    rootStyle,
    drawContext.context,
    drawContext.images,
    classStyles,
  )
}

function layoutChildren(
  children: RuntimeElement[],
  bounds: Rect,
  parentStyle: ResolvedStyle,
  context: CanvasRenderingContext2D,
  images: ReadonlyMap<string, HTMLImageElement | null>,
  classStyles: Record<string, CardTemplateStyle>,
): void {
  const normal = children.filter((child) => styleFor(child, classStyles).position !== 'absolute')
  const absolute = children.filter((child) => styleFor(child, classStyles).position === 'absolute')
  const direction = parentStyle.flexDirection ?? 'column'
  const row = direction === 'row'
  const mainSize = row ? bounds.width : bounds.height
  const crossSize = row ? bounds.height : bounds.width
  const gap = resolveLength(parentStyle.gap, mainSize, 0)
  const entries = normal.map((node) => {
    const style = resolveStyle(styleFor(node, classStyles), bounds, parentStyle)
    const marginMain = row
      ? style.marginEdges.left + style.marginEdges.right
      : style.marginEdges.top + style.marginEdges.bottom
    const requested = resolveOptionalLength(row ? style.width : style.height, mainSize)
    const intrinsic = requested ?? intrinsicMain(node, style, row)
    return { node, style, main: intrinsic, marginMain, flex: Math.max(0, number(style.flex, 0)) }
  })
  const gaps = Math.max(0, entries.length - 1) * gap
  const used = entries.reduce((sum, entry) => sum + entry.main + entry.marginMain, 0) + gaps
  const flexTotal = entries.reduce((sum, entry) => sum + entry.flex, 0)
  const autoEntries = entries.filter((entry) => entry.main === 0 && entry.flex === 0)
  let remaining = Math.max(0, mainSize - used)
  if (flexTotal > 0) {
    entries.forEach((entry) => {
      if (entry.flex > 0) entry.main += remaining * entry.flex / flexTotal
    })
    remaining = 0
  } else if (autoEntries.length) {
    autoEntries.forEach((entry) => {
      entry.main += remaining / autoEntries.length
    })
    remaining = 0
  }
  const justify = parentStyle.justifyContent ?? 'start'
  const between = justify === 'space-between' && entries.length > 1
    ? gap + remaining / (entries.length - 1)
    : gap
  let cursor = justify === 'center'
    ? remaining / 2
    : justify === 'end'
      ? remaining
      : 0
  entries.forEach(({ node, style, main }) => {
    cursor += row ? style.marginEdges.left : style.marginEdges.top
    const requestedCross = resolveOptionalLength(row ? style.height : style.width, crossSize)
    const availableCross = Math.max(0, crossSize - (row
      ? style.marginEdges.top + style.marginEdges.bottom
      : style.marginEdges.left + style.marginEdges.right))
    const cross = requestedCross ?? availableCross
    const align = parentStyle.alignItems ?? 'stretch'
    const crossOffset = align === 'center'
      ? (crossSize - cross) / 2
      : align === 'end'
        ? crossSize - cross - (row ? style.marginEdges.bottom : style.marginEdges.right)
        : row ? style.marginEdges.top : style.marginEdges.left
    const rect = row
      ? { x: bounds.x + cursor, y: bounds.y + crossOffset, width: main, height: cross }
      : { x: bounds.x + crossOffset, y: bounds.y + cursor, width: cross, height: main }
    paintElement(node, rect, style, context, images, classStyles)
    cursor += main + (row ? style.marginEdges.right : style.marginEdges.bottom) + between
  })
  absolute.forEach((node) => {
    const style = resolveStyle(styleFor(node, classStyles), bounds, parentStyle)
    const left = resolveOptionalLength(style.left, bounds.width)
    const right = resolveOptionalLength(style.right, bounds.width)
    const top = resolveOptionalLength(style.top, bounds.height)
    const bottom = resolveOptionalLength(style.bottom, bounds.height)
    const width = resolveOptionalLength(style.width, bounds.width)
      ?? Math.max(0, bounds.width - (left ?? 0) - (right ?? 0))
    const height = resolveOptionalLength(style.height, bounds.height)
      ?? Math.max(0, bounds.height - (top ?? 0) - (bottom ?? 0))
    paintElement(node, {
      x: bounds.x + (left ?? Math.max(0, bounds.width - (right ?? 0) - width)),
      y: bounds.y + (top ?? Math.max(0, bounds.height - (bottom ?? 0) - height)),
      width,
      height,
    }, style, context, images, classStyles)
  })
}

function paintElement(
  node: RuntimeElement,
  rect: Rect,
  style: ResolvedStyle,
  context: CanvasRenderingContext2D,
  images: ReadonlyMap<string, HTMLImageElement | null>,
  classStyles: Record<string, CardTemplateStyle>,
): void {
  if (node.tag === 'br') return
  context.save()
  context.globalAlpha *= clamp(number(style.opacity, 1), 0, 1)
  createRoundedPath(context, rect, resolveLength(style.borderRadius, Math.min(rect.width, rect.height), 0))
  const background = style.background ?? style.backgroundColor
  if (background) {
    context.fillStyle = resolvePaint(context, background, rect)
    context.fill()
  }
  if (style.overflow === 'hidden') context.clip()
  if (node.tag === 'img') {
    drawImage(context, images.get(String(node.attributes.src ?? '')) ?? null, rect, style)
  } else if (node.tag === 'span') {
    drawText(context, collectText(node.children), rect, style)
  } else {
    const inner = insetEdges(rect, style.paddingEdges)
    layoutChildren(
      materializeTextNodes(node.children),
      inner,
      style,
      context,
      images,
      classStyles,
    )
  }
  const border = resolveBorder(style, rect)
  if (border.width > 0) {
    context.lineWidth = border.width
    context.strokeStyle = border.color
    createRoundedPath(context, insetRect(rect, border.width / 2), Math.max(0, border.radius - border.width / 2))
    context.stroke()
  }
  context.restore()
}

function drawImage(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement | null,
  rect: Rect,
  style: ResolvedStyle,
): void {
  if (!image) return
  const sourceWidth = Math.max(1, image.naturalWidth || image.width)
  const sourceHeight = Math.max(1, image.naturalHeight || image.height)
  const fit = style.objectFit ?? 'cover'
  const [positionX, positionY] = parseObjectPosition(style.objectPosition)
  if (fit === 'fill') {
    context.drawImage(image, rect.x, rect.y, rect.width, rect.height)
    return
  }
  const sourceAspect = sourceWidth / sourceHeight
  const targetAspect = rect.width / Math.max(1, rect.height)
  if (fit === 'contain') {
    const width = sourceAspect >= targetAspect ? rect.width : rect.height * sourceAspect
    const height = sourceAspect >= targetAspect ? rect.width / sourceAspect : rect.height
    context.drawImage(
      image,
      rect.x + (rect.width - width) * positionX,
      rect.y + (rect.height - height) * positionY,
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
    rect.x,
    rect.y,
    rect.width,
    rect.height,
  )
}

function drawText(
  context: CanvasRenderingContext2D,
  text: string,
  rect: Rect,
  style: ResolvedStyle,
): void {
  const fontSize = resolveLength(style.fontSize, rect.height, Math.max(8, rect.height * 0.45))
  const lineHeight = fontSize * clamp(number(style.lineHeight, 1.2), 0.8, 2)
  const lineClamp = Math.round(clamp(number(style.lineClamp, style.whiteSpace === 'nowrap' ? 1 : 3), 1, 3))
  context.font = `${style.fontWeight ?? 400} ${fontSize}px ${style.fontFamily ?? 'sans-serif'}`
  context.textAlign = style.textAlign ?? 'left'
  context.textBaseline = 'top'
  context.fillStyle = style.color ?? '#ffffff'
  const lines = wrapText(context, text, rect.width, lineClamp)
  const x = context.textAlign === 'center'
    ? rect.x + rect.width / 2
    : context.textAlign === 'right'
      ? rect.x + rect.width
      : rect.x
  lines.forEach((line, index) => {
    context.fillText(line, x, rect.y + index * lineHeight)
  })
}

function wrapText(
  context: CanvasRenderingContext2D,
  text: string,
  width: number,
  maximumLines: number,
): string[] {
  const paragraphs = text.split('\n')
  const lines: string[] = []
  for (const paragraph of paragraphs) {
    let line = ''
    for (const character of Array.from(paragraph)) {
      const candidate = line + character
      if (line && context.measureText(candidate).width > width) {
        lines.push(line)
        line = character
        if (lines.length === maximumLines) break
      } else {
        line = candidate
      }
    }
    if (lines.length < maximumLines && line) lines.push(line)
    if (lines.length === maximumLines) break
  }
  if (!lines.length) return ['']
  if (lines.length === maximumLines && context.measureText(lines.at(-1) ?? '').width >= width) {
    let last = lines.at(-1) ?? ''
    while (last && context.measureText(`${last}…`).width > width) last = last.slice(0, -1)
    lines[lines.length - 1] = `${last}…`
  }
  return lines
}

function styleFor(
  node: RuntimeElement,
  classStyles: Record<string, CardTemplateStyle>,
): CardTemplateStyle {
  const classes = String(node.attributes.class ?? '').split(/\s+/).filter(Boolean)
  const fromClasses = Object.assign({}, ...classes.map((name) => classStyles[name] ?? {}))
  return {
    ...fromClasses,
    ...parseInlineStyle(node.attributes.style),
  }
}

function parseInlineStyle(value: unknown): CardTemplateStyle {
  if (value === null || value === undefined || value === '') return {}
  if (typeof value === 'object' && !Array.isArray(value)) {
    return validateStyle(value as Record<string, unknown>)
  }
  if (typeof value !== 'string') {
    throw new CardTemplateError('INVALID_VALUE', 'style must be a string or object')
  }
  const result: Record<string, unknown> = {}
  value.split(';').forEach((declaration) => {
    if (!declaration.trim()) return
    const colon = declaration.indexOf(':')
    if (colon < 1) throw new CardTemplateError('INVALID_VALUE', `Invalid style declaration ${declaration}`)
    const key = camelCase(declaration.slice(0, colon).trim())
    result[key] = declaration.slice(colon + 1).trim()
  })
  return validateStyle(result)
}

function validateStyle(value: Readonly<Record<string, unknown>>): CardTemplateStyle {
  const result: Record<string, unknown> = {}
  Object.entries(value).forEach(([key, styleValue]) => {
    const normalized = camelCase(key)
    if (!supportedStyles.has(normalized as keyof CardTemplateStyle)) {
      throw new CardTemplateError('UNSUPPORTED_STYLE', `Unsupported style ${key}`)
    }
    result[normalized] = normalizeStyleValue(normalized, styleValue)
  })
  return result as CardTemplateStyle
}

function normalizeStyleValue(key: string, value: unknown): unknown {
  if (value === null || value === undefined) return undefined
  if ([
    'flex', 'opacity', 'lineHeight', 'lineClamp',
  ].includes(key)) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) throw new CardTemplateError('INVALID_VALUE', `Invalid ${key}`)
    return parsed
  }
  return value
}

function resolveStyle(
  style: CardTemplateStyle,
  bounds: Rect,
  parent: CardTemplateStyle,
): ResolvedStyle {
  const inherited = Object.fromEntries(textStyleKeys
    .filter((key) => style[key] === undefined && parent[key] !== undefined)
    .map((key) => [key, parent[key]]))
  const merged = { ...inherited, ...style }
  return {
    ...merged,
    flexDirection: merged.flexDirection ?? 'column',
    paddingEdges: resolveEdges(merged, 'padding', bounds),
    marginEdges: resolveEdges(merged, 'margin', bounds),
  }
}

function resolveEdges(style: CardTemplateStyle, prefix: 'padding' | 'margin', bounds: Rect): Edges {
  const base = resolveLength(style[prefix], bounds.width, 0)
  return {
    top: resolveLength(style[`${prefix}Top`], bounds.height, base),
    right: resolveLength(style[`${prefix}Right`], bounds.width, base),
    bottom: resolveLength(style[`${prefix}Bottom`], bounds.height, base),
    left: resolveLength(style[`${prefix}Left`], bounds.width, base),
  }
}

function intrinsicMain(node: RuntimeElement, style: ResolvedStyle, row: boolean): number {
  if (node.tag === 'span' || node.tag === 'br') {
    return row ? 0 : resolveLength(style.fontSize, 100, 14) * number(style.lineHeight, 1.2)
  }
  return 0
}

function materializeTextNodes(nodes: RuntimeNode[]): RuntimeElement[] {
  return nodes.flatMap((node): RuntimeElement[] => node.type === 'element'
    ? [node]
    : [{
        type: 'element',
        tag: 'span',
        attributes: {},
        children: [node],
      }])
}

function collectText(nodes: RuntimeNode[]): string {
  return nodes.map((node) => node.type === 'text'
    ? node.value
    : node.tag === 'br'
      ? '\n'
      : collectText(node.children)).join('')
}

function collectImageSources(nodes: RuntimeNode[]): string[] {
  return nodes.flatMap((node): string[] => {
    if (node.type === 'text') return []
    const own = node.tag === 'img' && typeof node.attributes.src === 'string' && node.attributes.src
      ? [node.attributes.src]
      : []
    return own.concat(collectImageSources(node.children))
  })
}

function resolveBorder(style: ResolvedStyle, rect: Rect): { width: number; color: string; radius: number } {
  let width = resolveLength(style.borderWidth, Math.min(rect.width, rect.height), 0)
  let color = style.borderColor ?? '#ffffff'
  if (style.border) {
    const parts = style.border.trim().split(/\s+/)
    const parsedWidth = Number.parseFloat(parts[0])
    if (Number.isFinite(parsedWidth)) width = parsedWidth
    color = parts.at(-1) ?? color
  }
  return {
    width: Math.max(0, width),
    color,
    radius: resolveLength(style.borderRadius, Math.min(rect.width, rect.height), 0),
  }
}

function resolvePaint(
  context: CanvasRenderingContext2D,
  value: string,
  rect: Rect,
): string | CanvasGradient {
  const match = /^linear-gradient\(\s*([^,]+),\s*(.+)\)$/.exec(value)
  if (!match) return value
  const colors = splitTopLevelCommas(match[2]).map((color) => color.trim()).filter(Boolean)
  if (colors.length < 2) return value
  const angle = parseAngle(match[1])
  const centerX = rect.x + rect.width / 2
  const centerY = rect.y + rect.height / 2
  const distance = Math.abs(rect.width * Math.cos(angle)) + Math.abs(rect.height * Math.sin(angle))
  const dx = Math.cos(angle) * distance / 2
  const dy = Math.sin(angle) * distance / 2
  const gradient = context.createLinearGradient(centerX - dx, centerY - dy, centerX + dx, centerY + dy)
  colors.forEach((color, index) => gradient.addColorStop(index / (colors.length - 1), color))
  return gradient
}

function splitTopLevelCommas(value: string): string[] {
  const result: string[] = []
  let depth = 0
  let cursor = 0
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '(') depth += 1
    else if (value[index] === ')') depth = Math.max(0, depth - 1)
    else if (value[index] === ',' && depth === 0) {
      result.push(value.slice(cursor, index))
      cursor = index + 1
    }
  }
  result.push(value.slice(cursor))
  return result
}

function createRoundedPath(context: CanvasRenderingContext2D, rect: Rect, requestedRadius: number): void {
  const radius = Math.min(Math.max(0, requestedRadius), rect.width / 2, rect.height / 2)
  context.beginPath()
  if (typeof context.roundRect === 'function') {
    context.roundRect(rect.x, rect.y, rect.width, rect.height, radius)
  } else {
    context.rect(rect.x, rect.y, rect.width, rect.height)
  }
  context.closePath()
}

function parseObjectPosition(value: string | undefined): [number, number] {
  const parts = (value ?? '50% 50%').trim().split(/\s+/)
  return [position(parts[0]), position(parts[1] ?? parts[0])]
}

function position(value: string): number {
  if (value === 'left' || value === 'top') return 0
  if (value === 'right' || value === 'bottom') return 1
  if (value === 'center') return 0.5
  return clamp(Number.parseFloat(value) / 100, 0, 1)
}

function resolveOptionalLength(value: unknown, reference: number): number | undefined {
  if (value === undefined || value === null || value === 'auto') return undefined
  return resolveLength(value, reference, 0)
}

function resolveLength(value: unknown, reference: number, fallback: number): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback
  if (typeof value !== 'string') return fallback
  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed)) return fallback
  return value.endsWith('%') ? reference * parsed / 100 : parsed
}

function insetEdges(rect: Rect, edges: Edges): Rect {
  return {
    x: rect.x + edges.left,
    y: rect.y + edges.top,
    width: Math.max(0, rect.width - edges.left - edges.right),
    height: Math.max(0, rect.height - edges.top - edges.bottom),
  }
}

function insetRect(rect: Rect, amount: number): Rect {
  return {
    x: rect.x + amount,
    y: rect.y + amount,
    width: Math.max(0, rect.width - amount * 2),
    height: Math.max(0, rect.height - amount * 2),
  }
}

function parseAngle(value: string): number {
  const parsed = Number.parseFloat(value)
  return (Number.isFinite(parsed) ? parsed : 180) * Math.PI / 180
}

function camelCase(value: string): string {
  return value.trim().replace(/^-/, '').replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase())
}

function number(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum))
}

function normalizeError(error: unknown): CardTemplateError {
  return error instanceof CardTemplateError
    ? error
    : new CardTemplateError('INVALID_VALUE', error instanceof Error ? error.message : String(error))
}
