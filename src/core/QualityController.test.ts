import { describe, expect, it } from 'vitest'
import { QualityController } from './QualityController'

describe('QualityController', () => {
  it('merges and validates application quality profiles', () => {
    const controller = new QualityController({
      mode: 'high',
      profiles: {
        high: {
          maxPixelRatio: 2,
          maxVisibleItems: 5000,
          maxActiveEffectItems: 800,
          antialias: true,
          targetFps: 75,
        },
      },
    })

    expect(controller.getProfile()).toMatchObject({
      maxPixelRatio: 2,
      maxVisibleItems: 5000,
      maxActiveEffectItems: 800,
      targetFps: 75,
    })
    expect(controller.getProfile('medium').maxVisibleItems).toBe(1000)
  })

  it('rejects unsafe profile values before a renderer is created', () => {
    expect(() => new QualityController({
      mode: 'high',
      profiles: {
        high: {
          maxPixelRatio: 1,
          maxVisibleItems: 0,
          maxActiveEffectItems: 1,
          antialias: true,
          targetFps: 60,
        },
      },
    })).toThrow('high.maxVisibleItems')
  })
})
