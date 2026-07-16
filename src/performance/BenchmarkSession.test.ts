import { describe, expect, it } from 'vitest'
import type { StagePerformanceStats } from '../core/MotionStage'
import { BenchmarkSession, compareBenchmarkResults } from './BenchmarkSession'

function stats(overrides: Partial<StagePerformanceStats> = {}): StagePerformanceStats {
  return {
    fps: 60,
    averageFrameMs: 16.67,
    frameTimeP50: 16.5,
    frameTimeP95: 18,
    frameTimeP99: 20,
    longFramesOver24Ms: 0,
    longFramesOver33Ms: 0,
    longFramesOver50Ms: 0,
    ignoredFrames: 0,
    quality: 'high',
    sampleCount: 120,
    qualityMode: 'high',
    inputItems: 600,
    renderedItems: 600,
    submittedItems: 600,
    visibleItems: 600,
    drawCalls: 1,
    triangles: 1200,
    textureBytes: 2_000_000,
    pixelRatio: 1.5,
    paused: false,
    effect: null,
    activeEffectItems: 0,
    contextLost: false,
    frameCpuMs: 0.2,
    renderSubmitMs: 0.4,
    transformCalculationMs: 0,
    transformCalculations: 0,
    pickingMs: 0,
    pickOperations: 0,
    atlasBuilds: 1,
    atlasPatches: 0,
    atlasDiscardedBuilds: 0,
    atlasDiscardedPatches: 0,
    atlasCellsUpdated: 600,
    atlasBuildMs: 10,
    atlasPatchMs: 0,
    atlasDrawMs: 2,
    imageLoadMs: 0,
    imageRequests: 0,
    imageFailures: 0,
    estimatedTextureUploadBytes: 2_000_000,
    extensions: 0,
    extensionUpdateMs: 0,
    ...overrides,
  }
}

describe('BenchmarkSession', () => {
  it('summarizes sampled render metrics', () => {
    const session = new BenchmarkSession({ itemCount: 600, qualityMode: 'high', layout: 'sphere' }, 100)
    session.record(stats(), 600)
    session.record(stats({
      fps: 40,
      averageFrameMs: 25,
      frameTimeP95: 32,
      frameTimeP99: 40,
      longFramesOver24Ms: 3,
      longFramesOver33Ms: 2,
      longFramesOver50Ms: 1,
      frameCpuMs: 0.8,
      renderSubmitMs: 1.2,
      extensions: 2,
      extensionUpdateMs: 0.3,
      transformCalculationMs: 4,
      transformCalculations: 2,
      atlasPatches: 1,
      atlasCellsUpdated: 601,
      atlasPatchMs: 3,
      estimatedTextureUploadBytes: 4_000_000,
      drawCalls: 2,
      triangles: 1400,
    }), 1100)

    const result = session.finish(1600)
    expect(result).toMatchObject({
      durationMs: 1500,
      sampleCount: 2,
      averageFps: 50,
      minimumFps: 40,
      maximumFrameMs: 25,
      maximumFrameTimeP95: 32,
      maximumFrameTimeP99: 40,
      longFramesOver24Ms: 3,
      longFramesOver33Ms: 2,
      longFramesOver50Ms: 1,
      averageFrameCpuMs: 0.5,
      maximumFrameCpuMs: 0.8,
      averageRenderSubmitMs: 0.8,
      averageExtensionUpdateMs: 0.15,
      maximumExtensionUpdateMs: 0.3,
      maximumExtensions: 2,
      transformCalculationMs: 4,
      transformCalculations: 2,
      atlasPatches: 1,
      atlasCellsUpdated: 1,
      atlasPatchMs: 3,
      estimatedTextureUploadBytes: 2_000_000,
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

  it('compares compatible benchmark results without hiding regressions', () => {
    const baselineSession = new BenchmarkSession({
      itemCount: 1000,
      qualityMode: 'high',
      layout: 'sphere',
      scenario: 'steady',
    }, 0)
    baselineSession.record(stats({ fps: 50, frameTimeP95: 22, frameTimeP99: 28 }), 100)
    baselineSession.record(stats({ fps: 50, frameTimeP95: 22, frameTimeP99: 28 }), 200)
    const currentSession = new BenchmarkSession({
      itemCount: 1000,
      qualityMode: 'high',
      layout: 'sphere',
      scenario: 'steady',
    }, 0)
    currentSession.record(stats({ fps: 60, frameTimeP95: 18, frameTimeP99: 21 }), 100)
    currentSession.record(stats({ fps: 60, frameTimeP95: 18, frameTimeP99: 21 }), 200)

    const comparison = compareBenchmarkResults(
      baselineSession.finish(300),
      currentSession.finish(300),
    )
    expect(comparison.compatible).toBe(true)
    expect(comparison.metrics.averageFps).toMatchObject({
      baseline: 50,
      current: 60,
      delta: 10,
      deltaPercent: 20,
      lowerIsBetter: false,
    })
    expect(comparison.metrics.maximumFrameTimeP95.delta).toBe(-4)
  })
})
