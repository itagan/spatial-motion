import type {
  QualityMode,
  StagePerformanceEnvironment,
  StagePerformanceStats,
} from '../core/MotionStage.js'

export interface BenchmarkConfiguration {
  itemCount: number
  qualityMode: QualityMode
  layout: string
  scenario?: string
  environment?: StagePerformanceEnvironment
}

export interface BenchmarkSample {
  elapsedMs: number
  stats: StagePerformanceStats
}

export interface BenchmarkResult {
  configuration: BenchmarkConfiguration
  durationMs: number
  sampleCount: number
  averageFps: number
  minimumFps: number
  averageFrameMs: number
  maximumFrameMs: number
  averageFrameTimeP50: number
  maximumFrameTimeP95: number
  maximumFrameTimeP99: number
  longFramesOver24Ms: number
  longFramesOver33Ms: number
  longFramesOver50Ms: number
  ignoredFrames: number
  averageFrameCpuMs: number
  maximumFrameCpuMs: number
  averageRenderSubmitMs: number
  maximumRenderSubmitMs: number
  transformCalculationMs: number
  transformCalculations: number
  pickingMs: number
  pickOperations: number
  atlasBuilds: number
  atlasPatches: number
  atlasDiscardedBuilds: number
  atlasDiscardedPatches: number
  atlasCellsUpdated: number
  atlasBuildMs: number
  atlasPatchMs: number
  atlasDrawMs: number
  imageLoadMs: number
  imageRequests: number
  imageFailures: number
  estimatedTextureUploadBytes: number
  maximumDrawCalls: number
  maximumTriangles: number
  maximumTextureBytes: number
  renderedItems: number
  submittedItems: number
  visibleItems: number
  samples: BenchmarkSample[]
}

export interface BenchmarkComparisonMetric {
  baseline: number
  current: number
  delta: number
  deltaPercent: number | null
  lowerIsBetter: boolean
}

export interface BenchmarkComparison {
  compatible: boolean
  metrics: {
    averageFps: BenchmarkComparisonMetric
    maximumFrameMs: BenchmarkComparisonMetric
    maximumFrameTimeP95: BenchmarkComparisonMetric
    maximumFrameTimeP99: BenchmarkComparisonMetric
    longFramesOver33Ms: BenchmarkComparisonMetric
    averageFrameCpuMs: BenchmarkComparisonMetric
    averageRenderSubmitMs: BenchmarkComparisonMetric
    maximumTextureBytes: BenchmarkComparisonMetric
    estimatedTextureUploadBytes: BenchmarkComparisonMetric
  }
}

export class BenchmarkSession {
  private readonly samples: BenchmarkSample[] = []

  constructor(
    private readonly configuration: BenchmarkConfiguration,
    private readonly startedAt = performance.now(),
  ) {}

  record(stats: StagePerformanceStats, now = performance.now()): void {
    this.samples.push({ elapsedMs: Math.max(0, now - this.startedAt), stats: { ...stats } })
  }

  finish(now = performance.now()): BenchmarkResult {
    const durationMs = Math.max(0, now - this.startedAt)
    const fpsValues = this.samples.map(({ stats }) => stats.fps).filter((fps) => fps > 0)
    const frameValues = this.samples
      .map(({ stats }) => stats.averageFrameMs)
      .filter((frameMs) => frameMs > 0)
    const latest = this.samples.at(-1)?.stats
    const first = this.samples[0]?.stats
    return {
      configuration: {
        ...this.configuration,
        environment: this.configuration.environment
          ? { ...this.configuration.environment }
          : undefined,
      },
      durationMs,
      sampleCount: this.samples.length,
      averageFps: average(fpsValues),
      minimumFps: fpsValues.length ? Math.min(...fpsValues) : 0,
      averageFrameMs: average(frameValues),
      maximumFrameMs: frameValues.length ? Math.max(...frameValues) : 0,
      averageFrameTimeP50: average(this.samples.map(({ stats }) => stats.frameTimeP50).filter(positive)),
      maximumFrameTimeP95: maximum(this.samples.map(({ stats }) => stats.frameTimeP95)),
      maximumFrameTimeP99: maximum(this.samples.map(({ stats }) => stats.frameTimeP99)),
      longFramesOver24Ms: counterDelta(first, latest, 'longFramesOver24Ms'),
      longFramesOver33Ms: counterDelta(first, latest, 'longFramesOver33Ms'),
      longFramesOver50Ms: counterDelta(first, latest, 'longFramesOver50Ms'),
      ignoredFrames: counterDelta(first, latest, 'ignoredFrames'),
      averageFrameCpuMs: average(this.samples.map(({ stats }) => stats.frameCpuMs).filter(nonNegative)),
      maximumFrameCpuMs: maximum(this.samples.map(({ stats }) => stats.frameCpuMs)),
      averageRenderSubmitMs: average(this.samples.map(({ stats }) => stats.renderSubmitMs).filter(nonNegative)),
      maximumRenderSubmitMs: maximum(this.samples.map(({ stats }) => stats.renderSubmitMs)),
      transformCalculationMs: counterDelta(first, latest, 'transformCalculationMs'),
      transformCalculations: counterDelta(first, latest, 'transformCalculations'),
      pickingMs: counterDelta(first, latest, 'pickingMs'),
      pickOperations: counterDelta(first, latest, 'pickOperations'),
      atlasBuilds: counterDelta(first, latest, 'atlasBuilds'),
      atlasPatches: counterDelta(first, latest, 'atlasPatches'),
      atlasDiscardedBuilds: counterDelta(first, latest, 'atlasDiscardedBuilds'),
      atlasDiscardedPatches: counterDelta(first, latest, 'atlasDiscardedPatches'),
      atlasCellsUpdated: counterDelta(first, latest, 'atlasCellsUpdated'),
      atlasBuildMs: counterDelta(first, latest, 'atlasBuildMs'),
      atlasPatchMs: counterDelta(first, latest, 'atlasPatchMs'),
      atlasDrawMs: counterDelta(first, latest, 'atlasDrawMs'),
      imageLoadMs: counterDelta(first, latest, 'imageLoadMs'),
      imageRequests: counterDelta(first, latest, 'imageRequests'),
      imageFailures: counterDelta(first, latest, 'imageFailures'),
      estimatedTextureUploadBytes: counterDelta(first, latest, 'estimatedTextureUploadBytes'),
      maximumDrawCalls: maximum(this.samples.map(({ stats }) => stats.drawCalls)),
      maximumTriangles: maximum(this.samples.map(({ stats }) => stats.triangles)),
      maximumTextureBytes: maximum(this.samples.map(({ stats }) => stats.textureBytes)),
      renderedItems: latest?.renderedItems ?? 0,
      submittedItems: latest?.submittedItems ?? 0,
      visibleItems: latest?.visibleItems ?? 0,
      samples: this.samples.map((sample) => ({ elapsedMs: sample.elapsedMs, stats: { ...sample.stats } })),
    }
  }
}

export function compareBenchmarkResults(
  baseline: BenchmarkResult,
  current: BenchmarkResult,
): BenchmarkComparison {
  const compatible = baseline.configuration.itemCount === current.configuration.itemCount
    && baseline.configuration.qualityMode === current.configuration.qualityMode
    && baseline.configuration.layout === current.configuration.layout
    && baseline.configuration.scenario === current.configuration.scenario
  return {
    compatible,
    metrics: {
      averageFps: comparisonMetric(baseline.averageFps, current.averageFps, false),
      maximumFrameMs: comparisonMetric(baseline.maximumFrameMs, current.maximumFrameMs, true),
      maximumFrameTimeP95: comparisonMetric(baseline.maximumFrameTimeP95, current.maximumFrameTimeP95, true),
      maximumFrameTimeP99: comparisonMetric(baseline.maximumFrameTimeP99, current.maximumFrameTimeP99, true),
      longFramesOver33Ms: comparisonMetric(baseline.longFramesOver33Ms, current.longFramesOver33Ms, true),
      averageFrameCpuMs: comparisonMetric(baseline.averageFrameCpuMs, current.averageFrameCpuMs, true),
      averageRenderSubmitMs: comparisonMetric(baseline.averageRenderSubmitMs, current.averageRenderSubmitMs, true),
      maximumTextureBytes: comparisonMetric(baseline.maximumTextureBytes, current.maximumTextureBytes, true),
      estimatedTextureUploadBytes: comparisonMetric(
        baseline.estimatedTextureUploadBytes,
        current.estimatedTextureUploadBytes,
        true,
      ),
    },
  }
}

function average(values: number[]): number {
  if (!values.length) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function maximum(values: number[]): number {
  return values.length ? Math.max(...values) : 0
}

function counterDelta(
  first: StagePerformanceStats | undefined,
  latest: StagePerformanceStats | undefined,
  key: keyof StagePerformanceStats,
): number {
  const start = typeof first?.[key] === 'number' ? first[key] as number : 0
  const end = typeof latest?.[key] === 'number' ? latest[key] as number : 0
  return Math.max(0, end - start)
}

function comparisonMetric(
  baseline: number,
  current: number,
  lowerIsBetter: boolean,
): BenchmarkComparisonMetric {
  return {
    baseline,
    current,
    delta: current - baseline,
    deltaPercent: baseline === 0 ? null : (current - baseline) / Math.abs(baseline) * 100,
    lowerIsBetter,
  }
}

function positive(value: number): boolean {
  return value > 0
}

function nonNegative(value: number): boolean {
  return value >= 0 && Number.isFinite(value)
}
