export interface MotionItem<TMeta = unknown> {
  readonly id: string
  readonly image?: string
  readonly title?: string
  readonly meta?: TMeta
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

export type DrawCard<TMeta = unknown> = (
  context: CanvasRenderingContext2D,
  item: MotionItem<TMeta>,
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

export interface CardContentRenderer<TMeta = unknown> {
  prepare(
    item: Readonly<MotionItem<TMeta>>,
    resolvedStyle: Readonly<CardStyle>,
  ): PreparedCardContent
  getMetrics?(): Readonly<Record<string, number>>
}

export type ResolveCardStyle<TMeta = unknown> = (
  item: Readonly<MotionItem<TMeta>>,
) => CardStyle | undefined

export interface Transform {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly scale: number
  readonly rotationX: number
  readonly rotationY: number
  readonly rotationZ: number
  readonly opacity: number
}

export interface LayoutContext<TMeta = unknown> {
  width: number
  height: number
  /** Current visible items. Custom layouts can group or weight transforms from business data. */
  items?: readonly MotionItem<TMeta>[]
  /** Current quality selected by the Stage. */
  quality?: QualityLevel
  /** Camera-visible width in world units at the default layout plane. */
  viewportWidth?: number
  /** Camera-visible height in world units at the default layout plane. */
  viewportHeight?: number
  /** Normalized shared item width. The longest item edge is 1. */
  itemWidth?: number
  /** Normalized shared item height. The longest item edge is 1. */
  itemHeight?: number
}

export interface Layout<TMeta = unknown> {
  readonly name: string
  readonly orientation?: 'surface' | 'camera'
  readonly hideBackHemisphere?: boolean
  readonly hemisphereEdgeFade?: number
  calculate(count: number, context: LayoutContext<TMeta>): readonly Transform[]
  calculateInto?(
    count: number,
    context: LayoutContext<TMeta>,
    target: import('./TransformBuffer.js').TransformBuffer,
  ): void
}

export interface LayoutDefinition<TMeta = unknown> {
  readonly name: string
  readonly orientation?: 'surface' | 'camera'
  readonly hideBackHemisphere?: boolean
  readonly hemisphereEdgeFade?: number
  readonly calculate?: (count: number, context: LayoutContext<TMeta>) => readonly Transform[]
  readonly calculateInto?: (
    count: number,
    context: LayoutContext<TMeta>,
    target: import('./TransformBuffer.js').TransformBuffer,
  ) => void
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
  /**
   * WebGL context creation preference. Unlike the other profile fields, this is
   * selected from the Stage's initial quality and cannot change at runtime.
   */
  antialias: boolean
  targetFps: number
}

export type QualityLevel = 'high' | 'medium' | 'low'
export type QualityMode = QualityLevel | 'auto'
export type QualityProfiles = Readonly<Record<QualityLevel, Readonly<QualityProfile>>>
