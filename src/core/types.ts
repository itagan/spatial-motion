export interface MotionItem {
  id: string
  image?: string
  title?: string
  meta?: unknown
}

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
}

export interface Layout {
  readonly name: string
  readonly orientation?: 'surface' | 'camera'
  readonly hideBackHemisphere?: boolean
  calculate(count: number, context: LayoutContext): Transform[]
}

export interface TransitionOptions {
  duration?: number
  easing?: EasingFunction
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
