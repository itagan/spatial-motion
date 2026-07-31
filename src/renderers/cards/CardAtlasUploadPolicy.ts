const STABLE_FRAME_MS = 18
const PRESSURE_FRAME_MS = 24
const GROWTH_STREAK = 2
const BACKOFF_COOLDOWN_FRAMES = 6
const MAX_UPLOAD_MULTIPLIER = 4

export class ArrayAtlasUploadPolicy {
  private multiplier = 1
  private stableFrames = 0
  private cooldownFrames = 0
  private currentBudgetBytes = 0
  private peakBudgetBytes = 0
  private backoffs = 0

  nextBudget(deltaSeconds: number, baseBudgetBytes: number): number {
    const baseBudget = Math.max(1, Math.floor(baseBudgetBytes))
    const frameMs = deltaSeconds * 1000
    if (Number.isFinite(frameMs) && frameMs >= 4) {
      if (frameMs > PRESSURE_FRAME_MS) {
        const nextMultiplier = Math.max(1, this.multiplier / 2)
        if (nextMultiplier < this.multiplier) this.backoffs += 1
        this.multiplier = nextMultiplier
        this.stableFrames = 0
        this.cooldownFrames = BACKOFF_COOLDOWN_FRAMES
      } else if (this.cooldownFrames > 0) {
        this.cooldownFrames -= 1
        this.stableFrames = 0
      } else if (frameMs <= STABLE_FRAME_MS) {
        this.stableFrames += 1
        if (this.stableFrames >= GROWTH_STREAK) {
          this.multiplier = Math.min(MAX_UPLOAD_MULTIPLIER, this.multiplier * 2)
          this.stableFrames = 0
        }
      } else {
        this.stableFrames = 0
      }
    }
    this.currentBudgetBytes = Math.floor(baseBudget * this.multiplier)
    this.peakBudgetBytes = Math.max(this.peakBudgetBytes, this.currentBudgetBytes)
    return this.currentBudgetBytes
  }

  reset(): void {
    this.multiplier = 1
    this.stableFrames = 0
    this.cooldownFrames = 0
    this.currentBudgetBytes = 0
    this.peakBudgetBytes = 0
    this.backoffs = 0
  }

  snapshot(): Readonly<Record<string, number>> {
    return {
      arrayUploadBudgetBytes: this.currentBudgetBytes,
      arrayUploadPeakBudgetBytes: this.peakBudgetBytes,
      arrayUploadBackoffs: this.backoffs,
    }
  }
}
