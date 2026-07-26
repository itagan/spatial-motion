interface StageRuntimeFrame {
  now: number
  rawFrameMs: number
  deltaSeconds: number
}

interface StageRuntimeOptions {
  element: HTMLCanvasElement
  onFrame: (frame: StageRuntimeFrame) => void
  onPauseChange: (paused: boolean) => void
  onResume: (now: number) => void
  onContextLost: () => void
  onContextRestored: () => void
  onContextChange?: (state: 'lost' | 'restored') => void
}

export class StageRuntime {
  private frameId = 0
  private lastFrame = 0
  private pausedByUser = false
  private pausedByVisibility = document.visibilityState === 'hidden'
  private pausedByContext = false
  private destroyed = false

  constructor(private readonly options: StageRuntimeOptions) {
    options.element.addEventListener('webglcontextlost', this.handleContextLost)
    options.element.addEventListener('webglcontextrestored', this.handleContextRestored)
    document.addEventListener('visibilitychange', this.handleVisibilityChange)
  }

  start(): void {
    this.syncLoop()
  }

  pause(): void {
    if (this.pausedByUser || this.destroyed) return
    this.pausedByUser = true
    this.syncLoop()
  }

  resume(): void {
    if (!this.pausedByUser || this.destroyed) return
    this.pausedByUser = false
    this.syncLoop()
  }

  isPaused(): boolean {
    return this.pausedByUser || this.pausedByVisibility || this.pausedByContext
  }

  isContextLost(): boolean {
    return this.pausedByContext
  }

  hasScheduledFrame(): boolean {
    return Boolean(this.frameId)
  }

  dispose(): void {
    if (this.destroyed) return
    this.destroyed = true
    if (this.frameId) cancelAnimationFrame(this.frameId)
    this.frameId = 0
    this.options.element.removeEventListener('webglcontextlost', this.handleContextLost)
    this.options.element.removeEventListener('webglcontextrestored', this.handleContextRestored)
    document.removeEventListener('visibilitychange', this.handleVisibilityChange)
  }

  private syncLoop(): void {
    if (this.destroyed) return
    if (this.isPaused()) {
      this.options.onPauseChange(true)
      if (this.frameId) cancelAnimationFrame(this.frameId)
      this.frameId = 0
      return
    }
    if (this.frameId) return
    this.options.onPauseChange(false)
    const now = performance.now()
    this.lastFrame = now
    this.options.onResume(now)
    this.frameId = requestAnimationFrame(this.render)
  }

  private readonly render = (now: number) => {
    if (this.destroyed || this.isPaused()) return
    this.frameId = 0
    const rawFrameMs = now - this.lastFrame || 0
    this.lastFrame = now
    this.options.onFrame({
      now,
      rawFrameMs,
      deltaSeconds: Math.min(0.05, rawFrameMs / 1000),
    })
    if (!this.destroyed && !this.isPaused()) {
      this.frameId = requestAnimationFrame(this.render)
    }
  }

  private readonly handleVisibilityChange = () => {
    if (this.destroyed) return
    this.pausedByVisibility = document.visibilityState === 'hidden'
    this.syncLoop()
  }

  private readonly handleContextLost = (event: Event) => {
    if (this.destroyed || this.pausedByContext) return
    event.preventDefault()
    this.pausedByContext = true
    this.syncLoop()
    this.options.onContextLost()
    this.options.onContextChange?.('lost')
  }

  private readonly handleContextRestored = () => {
    if (this.destroyed || !this.pausedByContext) return
    this.pausedByContext = false
    this.options.onContextRestored()
    this.syncLoop()
    this.options.onContextChange?.('restored')
  }
}
