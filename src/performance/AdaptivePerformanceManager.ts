import type { QualityLevel } from '../core/types.js'
import { qualityProfiles } from './quality.js'

export interface AdaptivePerformanceOptions {
  sampleWindowMs?: number
  recoveryWindowMs?: number
  cooldownMs?: number
  degradeThreshold?: number
  recoveryThreshold?: number
}

export interface PerformanceStats {
  fps: number
  averageFrameMs: number
  quality: QualityLevel
  sampleCount: number
}

const levels: QualityLevel[] = ['low', 'medium', 'high']

export class AdaptivePerformanceManager {
  private readonly options: Required<AdaptivePerformanceOptions>
  private samples: number[] = []
  private windowStartedAt = 0
  private stableSince = 0
  private lastChangedAt = -Infinity
  private stats: PerformanceStats

  constructor(private quality: QualityLevel, options: AdaptivePerformanceOptions = {}) {
    this.options = {
      sampleWindowMs: options.sampleWindowMs ?? 2500,
      recoveryWindowMs: options.recoveryWindowMs ?? 8000,
      cooldownMs: options.cooldownMs ?? 5000,
      degradeThreshold: options.degradeThreshold ?? 0.78,
      recoveryThreshold: options.recoveryThreshold ?? 0.9,
    }
    this.stats = { fps: 0, averageFrameMs: 0, quality, sampleCount: 0 }
  }

  recordFrame(frameMs: number, now: number, allowQualityChange = true): QualityLevel | null {
    // Ignore tab suspension, debugger pauses and invalid measurements.
    if (frameMs < 4 || frameMs > 100) return null
    if (!this.windowStartedAt) this.windowStartedAt = now
    this.samples.push(frameMs)
    if (now - this.windowStartedAt < this.options.sampleWindowMs) return null

    const averageFrameMs = this.samples.reduce((sum, value) => sum + value, 0) / this.samples.length
    const fps = 1000 / averageFrameMs
    this.stats = { fps, averageFrameMs, quality: this.quality, sampleCount: this.samples.length }
    this.samples = []
    this.windowStartedAt = now

    if (!allowQualityChange) return null
    if (now - this.lastChangedAt < this.options.cooldownMs) return null
    const currentIndex = levels.indexOf(this.quality)
    const currentTarget = qualityProfiles[this.quality].targetFps

    if (currentIndex > 0 && fps < currentTarget * this.options.degradeThreshold) {
      this.quality = levels[currentIndex - 1]
      this.lastChangedAt = now
      this.stableSince = 0
      this.stats.quality = this.quality
      return this.quality
    }

    if (currentIndex < levels.length - 1) {
      const nextTarget = qualityProfiles[levels[currentIndex + 1]].targetFps
      if (fps >= nextTarget * this.options.recoveryThreshold) {
        if (!this.stableSince) this.stableSince = now
        if (now - this.stableSince >= this.options.recoveryWindowMs) {
          this.quality = levels[currentIndex + 1]
          this.lastChangedAt = now
          this.stableSince = 0
          this.stats.quality = this.quality
          return this.quality
        }
      } else {
        this.stableSince = 0
      }
    }

    return null
  }

  getStats(): PerformanceStats {
    return { ...this.stats, quality: this.quality }
  }
}
