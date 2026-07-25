export interface MotionItem {
  id: string
  image?: string
  title?: string
  meta?: unknown
}

export interface CardStyle {
  shape?: 'square' | 'rounded' | 'circle'
  cornerRadius?: number
  borderWidth?: number
  borderColor?: string
  backgroundColor?: string
  imageFit?: 'cover' | 'contain' | 'fill'
  imagePosition?: {
    x?: number
    y?: number
  }
  /** Padding as a fraction of the card's shorter edge. */
  contentPadding?: number
  overlayColor?: string
  titleStyle?: CardTitleStyle
}

export interface CardTitleStyle {
  color?: string
  backgroundColor?: string
  fontFamily?: string
  fontWeight?: number | string
  /** Font size as a fraction of the card height. */
  fontSizeRatio?: number
  position?: 'top' | 'center' | 'bottom'
  align?: 'left' | 'center' | 'right'
  lineHeight?: number
  maxLines?: 1 | 2 | 3
}

export interface CardDrawBounds {
  x: number
  y: number
  width: number
  height: number
}

export type DrawCard = (
  context: CanvasRenderingContext2D,
  item: MotionItem,
  bounds: CardDrawBounds,
  resolvedStyle: Readonly<CardStyle>,
) => void | Promise<void>

export interface CardContentDrawContext {
  context: CanvasRenderingContext2D
  bounds: Readonly<CardDrawBounds>
  resolvedStyle: Readonly<CardStyle>
  images: ReadonlyMap<string, HTMLImageElement | null>
  signal?: AbortSignal
}

export interface PreparedCardContent {
  imageSources?: readonly string[]
  draw(context: CardContentDrawContext): void | Promise<void>
}

export interface CardContentRenderer {
  prepare(
    item: Readonly<MotionItem>,
    resolvedStyle: Readonly<CardStyle>,
  ): PreparedCardContent
}

export type ResolveCardStyle = (item: Readonly<MotionItem>) => CardStyle | undefined

export interface Transform {
  x: number
  y: number
  z: number
  scale: number
  rotationX: number
  rotationY: number
  rotationZ: number
  opacity: number
}

export interface LayoutContext {
  width: number
  height: number
  /** Camera-visible width in world units at the default layout plane. */
  viewportWidth?: number
  /** Camera-visible height in world units at the default layout plane. */
  viewportHeight?: number
  /** Normalized shared card width. The longest card edge is 1. */
  cardWidth?: number
  /** Normalized shared card height. The longest card edge is 1. */
  cardHeight?: number
}

export interface Layout {
  readonly name: string
  readonly orientation?: 'surface' | 'camera'
  readonly hideBackHemisphere?: boolean
  readonly hemisphereEdgeFade?: number
  calculate(count: number, context: LayoutContext): Transform[]
}

export interface TransitionOptions {
  duration?: number
  easing?: EasingFunction
  signal?: AbortSignal
}

export type EasingFunction = (value: number) => number

export interface QualityProfile {
  maxPixelRatio: number
  maxVisibleItems: number
  maxActiveEffectItems: number
  antialias: boolean
  targetFps: number
}

export type QualityLevel = 'high' | 'medium' | 'low'
