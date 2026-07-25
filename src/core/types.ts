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
) => void | Promise<void>

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
