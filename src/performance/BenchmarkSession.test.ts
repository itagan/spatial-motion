import { describe, expect, it } from 'vitest'
import type { StagePerformanceStats } from '../core/MotionStage'
import type { StageExtensionStats } from '../core/extensions'
import {
  BenchmarkSession,
  compareBenchmarkResults,
  evaluateBenchmarkRegression,
  parseBenchmarkResult,
} from './BenchmarkSession'

function stats(overrides: Partial<StagePerformanceStats> = {}): StagePerformanceStats {
  const base: StagePerformanceStats = {
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
    residentItems: 600,
    submittedItems: 600,
    visibleItems: 600,
    render: { drawCalls: 1, triangles: 1200 },
    renderer: {
      instanceCount: 600,
      submittedInstanceCount: 600,
      gpuBytes: 2_000_000,
      metrics: {
        textureBytes: 2_000_000,
        atlasBuilds: 1,
        atlasPatches: 0,
        atlasDiscardedBuilds: 0,
        atlasDiscardedPatches: 0,
        atlasCellsUpdated: 600,
        atlasBuildMs: 10,
        atlasPatchMs: 0,
        atlasDrawMs: 2,
        atlasPrepareMs: 1,
        atlasImageLoadWallMs: 0,
        atlasCellRenderMs: 6,
        atlasReadbackMs: 1,
        atlasArrayPackMs: 4,
        atlasWorkerRenderMs: 7,
        atlasWorkerRoundTripMs: 10,
        atlasWorkerRuntimeLoadMs: 2,
        atlasWorkerConstructMs: 1,
        atlasWorkerRequestPrepareMs: 2,
        atlasWorkerPrePostMs: 6,
        atlasLastBuildMs: 10,
        atlasLastPrepareMs: 1,
        atlasLastImageLoadWallMs: 0,
        atlasLastCellRenderMs: 6,
        atlasLastReadbackMs: 1,
        atlasLastArrayPackMs: 4,
        atlasLastWorkerRenderMs: 7,
        atlasLastWorkerRoundTripMs: 10,
        atlasLastWorkerRuntimeLoadMs: 2,
        atlasLastWorkerConstructMs: 1,
        atlasLastWorkerRequestPrepareMs: 2,
        atlasLastWorkerPrePostMs: 6,
        atlasWorkerRenders: 1,
        atlasImageBitmapDecodeMs: 2,
        atlasTexturePrewarms: 1,
        atlasTexturePrewarmMs: 3,
        atlasTexturePrewarmFailures: 0,
        atlasTexturePrewarmSkips: 0,
        imageLoadMs: 0,
        imageRequests: 0,
        imageFailures: 0,
        estimatedTextureUploadBytes: 2_000_000,
      },
    },
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
    extensions: 0,
    extensionUpdateMs: 0,
    extensionRenderMs: 0,
  }
  return {
    ...base,
    ...overrides,
    render: { ...base.render, ...overrides.render },
    renderer: {
      ...base.renderer,
      ...overrides.renderer,
      metrics: { ...base.renderer.metrics, ...overrides.renderer?.metrics },
    },
  }
}

describe('BenchmarkSession', () => {
  it('summarizes sampled render metrics', () => {
    const session = new BenchmarkSession({ itemCount: 600, qualityMode: 'high', layout: 'sphere' }, 100)
    session.record(stats(), 600)
    const extensionStats: StageExtensionStats[] = [{
      id: 1,
      name: 'gsap',
      order: 2,
      active: true,
      enabled: true,
      updateCalls: 10,
      averageUpdateMs: 0.2,
      updateTimeP95: 0.3,
      updateTimeP99: 0.4,
      maximumUpdateMs: 0.5,
      slowFrames: 0,
      updateBudgetMs: 4,
      overBudgetFrames: 0,
      throttledFrames: 0,
      renderCalls: 0,
      averageRenderHookMs: 0,
      maximumRenderHookMs: 0,
      errorCount: 0,
      lastError: null,
    }]
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
      renderer: {
        instanceCount: 600,
        submittedInstanceCount: 600,
        gpuBytes: 2_000_000,
        metrics: {
          atlasBuilds: 2,
          atlasPatches: 1,
          atlasCellsUpdated: 601,
          atlasPatchMs: 3,
          atlasArrayPackMs: 9,
          atlasWorkerRenderMs: 17,
          atlasWorkerRoundTripMs: 25,
          atlasWorkerRuntimeLoadMs: 7,
          atlasWorkerConstructMs: 3,
          atlasWorkerRequestPrepareMs: 6,
          atlasWorkerPrePostMs: 18,
          atlasLastBuildMs: 20,
          atlasLastPrepareMs: 2,
          atlasLastImageLoadWallMs: 3,
          atlasLastCellRenderMs: 12,
          atlasLastReadbackMs: 5,
          atlasLastArrayPackMs: 6,
          atlasLastWorkerRenderMs: 16,
          atlasLastWorkerRoundTripMs: 22,
          atlasLastWorkerRuntimeLoadMs: 5,
          atlasLastWorkerConstructMs: 2,
          atlasLastWorkerRequestPrepareMs: 4,
          atlasLastWorkerPrePostMs: 14,
          estimatedTextureUploadBytes: 4_000_000,
        },
      },
      render: { drawCalls: 2, triangles: 1400 },
    }), 1100, extensionStats)

    const result = session.finish(1600)
    expect(result).toMatchObject({
      version: 1,
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
      atlasBuilds: 1,
      atlasPatches: 1,
      atlasCellsUpdated: 1,
      atlasPatchMs: 3,
      atlasPrepareMs: 0,
      atlasImageLoadWallMs: 0,
      atlasCellRenderMs: 0,
      atlasReadbackMs: 0,
      atlasArrayPackMs: 5,
      atlasWorkerRenderMs: 10,
      atlasWorkerRoundTripMs: 15,
      atlasWorkerRuntimeLoadMs: 5,
      atlasWorkerConstructMs: 2,
      atlasWorkerRequestPrepareMs: 4,
      atlasWorkerPrePostMs: 12,
      atlasLastBuildMs: 20,
      atlasLastPrepareMs: 2,
      atlasLastImageLoadWallMs: 3,
      atlasLastCellRenderMs: 12,
      atlasLastReadbackMs: 5,
      atlasLastArrayPackMs: 6,
      atlasLastWorkerRenderMs: 16,
      atlasLastWorkerRoundTripMs: 22,
      atlasLastWorkerRuntimeLoadMs: 5,
      atlasLastWorkerConstructMs: 2,
      atlasLastWorkerRequestPrepareMs: 4,
      atlasLastWorkerPrePostMs: 14,
      atlasWorkerRenders: 0,
      atlasImageBitmapDecodeMs: 0,
      atlasTexturePrewarms: 0,
      atlasTexturePrewarmMs: 0,
      atlasTexturePrewarmFailures: 0,
      atlasTexturePrewarmSkips: 0,
      estimatedTextureUploadBytes: 2_000_000,
      maximumDrawCalls: 2,
      maximumTriangles: 1400,
      maximumTextureBytes: 2_000_000,
      renderedItems: 600,
      visibleItems: 600,
    })
    expect(result.samples).toHaveLength(2)
    expect(result.extensionStats).toEqual(extensionStats)
  })

  it('returns zero aggregates for a session without samples', () => {
    const result = new BenchmarkSession({ itemCount: 100, qualityMode: 'auto', layout: 'grid' }, 0).finish(500)
    expect(result).toMatchObject({
      sampleCount: 0,
      averageFps: 0,
      minimumFps: 0,
      renderedItems: 0,
      atlasLastBuildMs: 0,
    })
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

  it('evaluates directional percentage and absolute regression limits', () => {
    const baseline = new BenchmarkSession({
      itemCount: 1000,
      qualityMode: 'high',
      layout: 'sphere',
      scenario: 'steady',
    }, 0)
    baseline.record(stats({ fps: 60, frameTimeP95: 20, longFramesOver33Ms: 0 }), 100)
    baseline.record(stats({ fps: 60, frameTimeP95: 20, longFramesOver33Ms: 1 }), 200)
    const current = new BenchmarkSession({
      itemCount: 1000,
      qualityMode: 'high',
      layout: 'sphere',
      scenario: 'steady',
    }, 0)
    current.record(stats({ fps: 50, frameTimeP95: 25, longFramesOver33Ms: 0 }), 100)
    current.record(stats({ fps: 50, frameTimeP95: 25, longFramesOver33Ms: 8 }), 200)

    const report = evaluateBenchmarkRegression(baseline.finish(300), current.finish(300), {
      averageFps: { maxRegressionPercent: 10 },
      maximumFrameTimeP95: { maxRegressionPercent: 20 },
      longFramesOver33Ms: { maxRegressionAbsolute: 5 },
      atlasPatchMs: { maxRegressionPercent: 10 },
    })

    expect(report.passed).toBe(false)
    expect(report.failures.map(({ metric }) => metric)).toEqual([
      'averageFps',
      'maximumFrameTimeP95',
      'longFramesOver33Ms',
    ])
    expect(report.failures[0].regressionPercent).toBeCloseTo(16.67, 1)
  })

  it('rejects incompatible comparisons and strictly parses benchmark JSON', () => {
    const result = new BenchmarkSession({ itemCount: 100, qualityMode: 'high', layout: 'grid' }, 0).finish(10)
    const parsed = parseBenchmarkResult(JSON.stringify({ ...result, version: undefined }))
    expect(parsed.version).toBe(1)
    const {
      atlasArrayPackMs: _legacyArrayPack,
      atlasWorkerRenderMs: _legacyWorkerRender,
      atlasWorkerRoundTripMs: _legacyWorkerRoundTrip,
      atlasWorkerPrePostMs: _legacyWorkerPrePost,
      atlasLastBuildMs: _legacyLastBuild,
      atlasLastPrepareMs: _legacyLastPrepare,
      atlasLastImageLoadWallMs: _legacyLastImageLoadWall,
      atlasLastCellRenderMs: _legacyLastCellRender,
      atlasLastReadbackMs: _legacyLastReadback,
      atlasLastArrayPackMs: _legacyLastArrayPack,
      atlasLastWorkerRenderMs: _legacyLastWorkerRender,
      atlasLastWorkerRoundTripMs: _legacyLastWorkerRoundTrip,
      atlasLastWorkerPrePostMs: _legacyLastWorkerPrePost,
      ...legacyResult
    } = result
    const parsedLegacy = parseBenchmarkResult(JSON.stringify(legacyResult))
    expect(parsedLegacy.atlasArrayPackMs).toBeUndefined()
    expect(parsedLegacy.atlasWorkerRenderMs).toBeUndefined()
    expect(parsedLegacy.atlasWorkerRoundTripMs).toBeUndefined()
    expect(parsedLegacy.atlasWorkerPrePostMs).toBeUndefined()
    expect(parsedLegacy.atlasLastBuildMs).toBeUndefined()
    expect(() => parseBenchmarkResult({ ...result, averageFps: Number.NaN })).toThrow('benchmark.averageFps')
    expect(() => parseBenchmarkResult({ ...result, atlasArrayPackMs: -1 })).toThrow(
      'benchmark.atlasArrayPackMs',
    )
    expect(() => parseBenchmarkResult({ ...result, atlasWorkerRoundTripMs: -1 })).toThrow(
      'benchmark.atlasWorkerRoundTripMs',
    )
    expect(() => parseBenchmarkResult({ ...result, atlasLastBuildMs: -1 })).toThrow(
      'benchmark.atlasLastBuildMs',
    )
    expect(() => parseBenchmarkResult({ ...result, atlasLastWorkerPrePostMs: -1 })).toThrow(
      'benchmark.atlasLastWorkerPrePostMs',
    )
    expect(() => parseBenchmarkResult({ ...result, version: 2 })).toThrow('benchmark version')
    expect(() => evaluateBenchmarkRegression(result, result, {
      averageFps: { maxRegressionPercent: -1 },
    })).toThrow('Invalid threshold')

    const other = new BenchmarkSession({ itemCount: 200, qualityMode: 'high', layout: 'grid' }, 0).finish(10)
    expect(evaluateBenchmarkRegression(result, other, {}).passed).toBe(false)
  })
})
