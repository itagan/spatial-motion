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
  /** Active time in seconds; the same frame object is reused and must not be retained or mutated. */
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
  /** CPU budget per update. Three consecutive overruns throttle one frame. Defaults to 4ms. */
  readonly updateBudgetMs?: number
  mount(context: StageExtensionContext): void | Promise<void>
  update?(frame: StageFrameContext): void
  /** Runs immediately before the Stage submits its scene, in extension order. */
  beforeRender?(): void
  /** Runs immediately after scene submission, in extension order. */
  afterRender?(): void
  resize?(viewport: StageViewport): void
  qualityChange?(quality: QualityLevel): void
  reducedMotionChange?(reducedMotion: boolean): void
  /** Called after the Stage has paused for a lost WebGL context. */
  contextLost?(): void
  /** Called after the Host and primary Renderer restored their GPU resources. */
  contextRestored?(): void
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
  readonly updateBudgetMs: number
  readonly overBudgetFrames: number
  readonly throttledFrames: number
  readonly renderCalls: number
  readonly averageRenderHookMs: number
  readonly maximumRenderHookMs: number
  readonly errorCount: number
  readonly lastError: string | null
}
