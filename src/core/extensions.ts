import type { Group, PerspectiveCamera } from 'three'

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
  mount(context: StageExtensionContext): void | Promise<void>
  update?(frame: StageFrameContext): void
  resize?(viewport: StageViewport): void
  pause?(): void
  resume?(): void
  dispose?(): void
}

export interface StageExtensionHandle {
  readonly active: boolean
  remove(): void
}
