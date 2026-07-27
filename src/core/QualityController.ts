import {
  AdaptivePerformanceManager,
  type AdaptivePerformanceOptions,
  type PerformanceStats,
} from '../performance/AdaptivePerformanceManager.js'
import { detectQuality, qualityProfiles as defaults } from '../performance/quality.js'
import type {
  QualityLevel,
  QualityMode,
  QualityProfile,
  QualityProfiles,
} from './types.js'

export interface QualityControllerOptions {
  mode?: QualityMode
  profiles?: Partial<Record<QualityLevel, QualityProfile>>
  adaptive?: AdaptivePerformanceOptions
}

export class QualityController {
  readonly profiles: QualityProfiles
  private readonly adaptiveOptions: AdaptivePerformanceOptions
  private mode: QualityMode
  private level: QualityLevel
  private manager: AdaptivePerformanceManager

  constructor(options: QualityControllerOptions = {}) {
    this.profiles = resolveQualityProfiles(options.profiles)
    this.adaptiveOptions = { ...options.adaptive }
    this.mode = options.mode ?? 'auto'
    this.level = this.mode === 'auto' ? detectQuality() : this.mode
    this.manager = new AdaptivePerformanceManager(
      this.level,
      this.adaptiveOptions,
      this.profiles,
    )
  }

  getMode(): QualityMode {
    return this.mode
  }

  getLevel(): QualityLevel {
    return this.level
  }

  getProfile(level = this.level): Readonly<QualityProfile> {
    return this.profiles[level]
  }

  setMode(mode: QualityMode): QualityLevel | null {
    this.mode = mode
    const next = mode === 'auto' ? detectQuality() : mode
    this.manager = new AdaptivePerformanceManager(next, this.adaptiveOptions, this.profiles)
    if (next === this.level) return null
    this.level = next
    return next
  }

  recordFrame(frameMs: number, now: number, adaptive = true): QualityLevel | null {
    const next = this.manager.recordFrame(frameMs, now, this.mode === 'auto' && adaptive)
    if (next) this.level = next
    return next
  }

  getStats(): PerformanceStats {
    return this.manager.getStats()
  }
}

function resolveQualityProfiles(
  overrides: Partial<Record<QualityLevel, QualityProfile>> | undefined,
): QualityProfiles {
  const result = Object.fromEntries(
    (['high', 'medium', 'low'] as const).map((level) => {
      const profile = { ...defaults[level], ...overrides?.[level] }
      validateProfile(level, profile)
      return [level, Object.freeze(profile)]
    }),
  ) as unknown as Record<QualityLevel, Readonly<QualityProfile>>
  return Object.freeze(result)
}

function validateProfile(level: QualityLevel, profile: QualityProfile): void {
  for (const key of [
    'maxPixelRatio',
    'maxVisibleItems',
    'maxActiveEffectItems',
    'targetFps',
  ] as const) {
    if (!Number.isFinite(profile[key]) || profile[key] <= 0) {
      throw new RangeError(`Quality profile ${level}.${key} must be greater than 0`)
    }
  }
  if (!Number.isInteger(profile.maxVisibleItems)
    || !Number.isInteger(profile.maxActiveEffectItems)) {
    throw new RangeError(`Quality profile ${level} item limits must be integers`)
  }
  if (typeof profile.antialias !== 'boolean') {
    throw new TypeError(`Quality profile ${level}.antialias must be a boolean`)
  }
}
