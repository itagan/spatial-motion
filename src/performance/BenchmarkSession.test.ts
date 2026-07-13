import { describe, expect, it } from 'vitest'
import type { StagePerformanceStats } from '../core/MotionStage'
import { BenchmarkSession } from './BenchmarkSession'

function stats(overrides: Partial<StagePerformanceStats> = {}): StagePerformanceStats {
  return {
    fps: 60,
    averageFrameMs: 16.67,
    quality: 'high',
    sampleCount: 120,
    qualityMode: 'high',
    inputItems: 600,
    renderedItems: 600,
    visibleItems: 600,
    drawCalls: 1,
    triangles: 1200,
    textureBytes: 2_000_000,
    pixelRatio: 1.5,
    paused: false,
    ...overrides,
  }
}

describe('BenchmarkSession', () => {
  it('summarizes sampled render metrics', () => {
    const session = new BenchmarkSession({ itemCount: 600, qualityMode: 'high', layout: 'sphere' }, 100)
    session.record(stats(), 600)
    session.record(stats({ fps: 40, averageFrameMs: 25, drawCalls: 2, triangles: 1400 }), 1100)

    const result = session.finish(1600)
    expect(result).toMatchObject({
      durationMs: 1500,
      sampleCount: 2,
      averageFps: 50,
      minimumFps: 40,
      maximumFrameMs: 25,
      maximumDrawCalls: 2,
      maximumTriangles: 1400,
      maximumTextureBytes: 2_000_000,
      renderedItems: 600,
      visibleItems: 600,
    })
    expect(result.samples).toHaveLength(2)
  })

  it('returns zero aggregates for a session without samples', () => {
    const result = new BenchmarkSession({ itemCount: 100, qualityMode: 'auto', layout: 'grid' }, 0).finish(500)
    expect(result).toMatchObject({ sampleCount: 0, averageFps: 0, minimumFps: 0, renderedItems: 0 })
  })
})
