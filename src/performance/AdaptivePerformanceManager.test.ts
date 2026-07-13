import { describe, expect, it } from 'vitest'
import { AdaptivePerformanceManager } from './AdaptivePerformanceManager'

describe('AdaptivePerformanceManager', () => {
  it('degrades quality after a sustained low frame rate', () => {
    const manager = new AdaptivePerformanceManager('high', {
      sampleWindowMs: 100,
      cooldownMs: 0,
    })
    let now = 0
    let decision = null
    for (let index = 0; index < 4; index += 1) {
      now += 34
      decision = manager.recordFrame(34, now) ?? decision
    }

    expect(decision).toBe('medium')
    expect(manager.getStats().fps).toBeLessThan(30)
  })

  it('recovers only after performance remains stable', () => {
    const manager = new AdaptivePerformanceManager('low', {
      sampleWindowMs: 100,
      recoveryWindowMs: 200,
      cooldownMs: 0,
    })
    let now = 0
    let decision = null
    for (let index = 0; index < 30; index += 1) {
      now += 16
      decision = manager.recordFrame(16, now) ?? decision
    }

    expect(decision).toBe('medium')
  })

  it('ignores suspension-sized frame gaps', () => {
    const manager = new AdaptivePerformanceManager('high', { sampleWindowMs: 100 })
    expect(manager.recordFrame(800, 800)).toBeNull()
    expect(manager.getStats().sampleCount).toBe(0)
  })

  it('records locked-quality metrics without changing the quality level', () => {
    const manager = new AdaptivePerformanceManager('high', {
      sampleWindowMs: 100,
      cooldownMs: 0,
    })
    let now = 0
    let decision = null
    for (let index = 0; index < 4; index += 1) {
      now += 34
      decision = manager.recordFrame(34, now, false) ?? decision
    }

    expect(decision).toBeNull()
    expect(manager.getStats()).toMatchObject({ quality: 'high', fps: expect.any(Number) })
    expect(manager.getStats().fps).toBeGreaterThan(0)
  })
})
