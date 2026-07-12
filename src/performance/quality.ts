import type { QualityLevel, QualityProfile } from '../core/types'

export const qualityProfiles: Record<QualityLevel, QualityProfile> = {
  high: { maxPixelRatio: 1.5, maxVisibleItems: 2000, antialias: true, targetFps: 60 },
  medium: { maxPixelRatio: 1.25, maxVisibleItems: 1000, antialias: true, targetFps: 45 },
  low: { maxPixelRatio: 1, maxVisibleItems: 500, antialias: false, targetFps: 30 },
}

export function detectQuality(): QualityLevel {
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4
  const cores = navigator.hardwareConcurrency ?? 4
  if (memory <= 4 || cores <= 4) return 'low'
  if (memory <= 8 || cores <= 8) return 'medium'
  return 'high'
}
