import type { QualityLevel, QualityProfile } from '../core/types.js'

export const qualityProfiles: Record<QualityLevel, QualityProfile> = {
  high: { maxPixelRatio: 1.5, maxVisibleItems: 2000, maxActiveEffectItems: 300, antialias: true, targetFps: 60 },
  medium: { maxPixelRatio: 1.25, maxVisibleItems: 1000, maxActiveEffectItems: 220, antialias: true, targetFps: 45 },
  low: { maxPixelRatio: 1, maxVisibleItems: 500, maxActiveEffectItems: 140, antialias: false, targetFps: 30 },
}

export const visibleRatios: Record<QualityLevel, number> = {
  high: 1,
  medium: 0.82,
  low: 0.58,
}

export function detectQuality(): QualityLevel {
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4
  const cores = navigator.hardwareConcurrency ?? 4
  if (memory <= 4 || cores <= 4) return 'low'
  if (memory <= 8 || cores <= 8) return 'medium'
  return 'high'
}
