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
    expect(manager.getStats().ignoredFrames).toBe(1)
  })

  it('records frame percentiles and cumulative long-frame counters', () => {
    const manager = new AdaptivePerformanceManager('high', {
      sampleWindowMs: 100,
      cooldownMs: 0,
    })
    let now = 0
    for (const frameMs of [10, 16, 25, 34, 51]) {
      now += frameMs
      manager.recordFrame(frameMs, now, false)
    }

    const stats = manager.getStats()
    expect(stats.frameTimeP50).toBe(25)
    expect(stats.frameTimeP95).toBeCloseTo(47.6)
    expect(stats.frameTimeP99).toBeCloseTo(50.32)
    expect(stats).toMatchObject({
      longFramesOver24Ms: 3,
      longFramesOver33Ms: 2,
      longFramesOver50Ms: 1,
    })
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
