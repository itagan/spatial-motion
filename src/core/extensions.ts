import type { Group, PerspectiveCamera } from 'three'
import type { QualityLevel } from './types.js'

export interface StageExtensionContext {
  /** Isolated scene root owned by this extension. */
  readonly root: Group
  /** Stage camera for read-only projection and facing calculations. */
  readonly camera: Readonly<PerspectiveCamera>
  /** Aborted when the extension is removed or the Stage is destroyed. */
  readonly signal: AbortSignal
}

export interface StageFrameContext {
  /** Active extension time in seconds; paused time is excluded. */
  readonly elapsed: number
  /** Current frame delta in seconds, clamped to the Stage frame budget. */
  readonly delta: number
}

export interface StageViewport {
  readonly width: number
  readonly height: number
  readonly pixelRatio: number
}

export interface StageExtension {
  readonly name?: string
  /** Lower values run first; equal values retain mount order. */
  readonly order?: number
  mount(context: StageExtensionContext): void | Promise<void>
  update?(frame: StageFrameContext): void
  resize?(viewport: StageViewport): void
  qualityChange?(quality: QualityLevel): void
  reducedMotionChange?(reducedMotion: boolean): void
  pause?(): void
  resume?(): void
  dispose?(): void
}

export interface StageExtensionHandle {
  readonly active: boolean
  readonly enabled: boolean
  enable(): void
  disable(): void
  remove(): void
}

export interface StageExtensionStats {
  readonly id: number
  readonly name: string
  readonly order: number
  readonly active: boolean
  readonly enabled: boolean
  readonly updateCalls: number
  readonly averageUpdateMs: number
  readonly updateTimeP95: number
  readonly updateTimeP99: number
  readonly maximumUpdateMs: number
  readonly slowFrames: number
  readonly errorCount: number
  readonly lastError: string | null
}
