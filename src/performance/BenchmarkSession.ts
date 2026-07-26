import type {
  QualityMode,
  StagePerformanceEnvironment,
  StagePerformanceStats,
} from '../core/MotionStage.js'
import type { StageExtensionStats } from '../core/extensions.js'

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
  extensionStats: StageExtensionStats[]
}

export interface BenchmarkResult {
  version: 1
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
  averageExtensionUpdateMs: number
  maximumExtensionUpdateMs: number
  maximumExtensions: number
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
  extensionStats: StageExtensionStats[]
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
    atlasBuildMs: BenchmarkComparisonMetric
    atlasPatchMs: BenchmarkComparisonMetric
    maximumTextureBytes: BenchmarkComparisonMetric
    estimatedTextureUploadBytes: BenchmarkComparisonMetric
  }
}

export type BenchmarkMetricName = keyof BenchmarkComparison['metrics']

export interface BenchmarkRegressionThreshold {
  maxRegressionPercent?: number
  maxRegressionAbsolute?: number
}

export type BenchmarkRegressionThresholds = Partial<Record<BenchmarkMetricName, BenchmarkRegressionThreshold>>

export interface BenchmarkRegressionFailure extends BenchmarkRegressionThreshold {
  metric: BenchmarkMetricName
  regressionPercent: number | null
  regressionAbsolute: number
}

export interface BenchmarkRegressionReport {
  passed: boolean
  compatible: boolean
  comparison: BenchmarkComparison
  failures: BenchmarkRegressionFailure[]
}

export const defaultBenchmarkRegressionThresholds: BenchmarkRegressionThresholds = {
  averageFps: { maxRegressionPercent: 8 },
  maximumFrameMs: { maxRegressionPercent: 20 },
  maximumFrameTimeP95: { maxRegressionPercent: 12 },
  maximumFrameTimeP99: { maxRegressionPercent: 15 },
  longFramesOver33Ms: { maxRegressionAbsolute: 5 },
  averageFrameCpuMs: { maxRegressionPercent: 15 },
  averageRenderSubmitMs: { maxRegressionPercent: 15 },
  atlasBuildMs: { maxRegressionPercent: 20 },
  atlasPatchMs: { maxRegressionPercent: 20 },
  maximumTextureBytes: { maxRegressionPercent: 5 },
  estimatedTextureUploadBytes: { maxRegressionPercent: 10 },
}

export class BenchmarkSession {
  private readonly samples: BenchmarkSample[] = []

  constructor(
    private readonly configuration: BenchmarkConfiguration,
    private readonly startedAt = performance.now(),
  ) {}

  record(
    stats: StagePerformanceStats,
    now = performance.now(),
    extensionStats: StageExtensionStats[] = [],
  ): void {
    this.samples.push({
      elapsedMs: Math.max(0, now - this.startedAt),
      stats: { ...stats },
      extensionStats: extensionStats.map((entry) => ({ ...entry })),
    })
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
      version: 1,
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
      averageExtensionUpdateMs: average(this.samples.map(({ stats }) => stats.extensionUpdateMs).filter(nonNegative)),
      maximumExtensionUpdateMs: maximum(this.samples.map(({ stats }) => stats.extensionUpdateMs)),
      maximumExtensions: maximum(this.samples.map(({ stats }) => stats.extensions)),
      transformCalculationMs: counterDelta(first, latest, 'transformCalculationMs'),
      transformCalculations: counterDelta(first, latest, 'transformCalculations'),
      pickingMs: counterDelta(first, latest, 'pickingMs'),
      pickOperations: counterDelta(first, latest, 'pickOperations'),
      atlasBuilds: rendererCounterDelta(first, latest, 'atlasBuilds'),
      atlasPatches: rendererCounterDelta(first, latest, 'atlasPatches'),
      atlasDiscardedBuilds: rendererCounterDelta(first, latest, 'atlasDiscardedBuilds'),
      atlasDiscardedPatches: rendererCounterDelta(first, latest, 'atlasDiscardedPatches'),
      atlasCellsUpdated: rendererCounterDelta(first, latest, 'atlasCellsUpdated'),
      atlasBuildMs: rendererCounterDelta(first, latest, 'atlasBuildMs'),
      atlasPatchMs: rendererCounterDelta(first, latest, 'atlasPatchMs'),
      atlasDrawMs: rendererCounterDelta(first, latest, 'atlasDrawMs'),
      imageLoadMs: rendererCounterDelta(first, latest, 'imageLoadMs'),
      imageRequests: rendererCounterDelta(first, latest, 'imageRequests'),
      imageFailures: rendererCounterDelta(first, latest, 'imageFailures'),
      estimatedTextureUploadBytes: rendererCounterDelta(
        first,
        latest,
        'estimatedTextureUploadBytes',
      ),
      maximumDrawCalls: maximum(this.samples.map(({ stats }) => stats.render.drawCalls)),
      maximumTriangles: maximum(this.samples.map(({ stats }) => stats.render.triangles)),
      maximumTextureBytes: maximum(
        this.samples.map(({ stats }) => stats.renderer.metrics.textureBytes ?? 0),
      ),
      renderedItems: latest?.renderer.instanceCount ?? 0,
      submittedItems: latest?.renderer.submittedInstanceCount ?? 0,
      visibleItems: latest?.visibleItems ?? 0,
      extensionStats: this.samples.at(-1)?.extensionStats.map((entry) => ({ ...entry })) ?? [],
      samples: this.samples.map((sample) => ({
        elapsedMs: sample.elapsedMs,
        stats: { ...sample.stats },
        extensionStats: sample.extensionStats.map((entry) => ({ ...entry })),
      })),
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
      atlasBuildMs: comparisonMetric(baseline.atlasBuildMs, current.atlasBuildMs, true),
      atlasPatchMs: comparisonMetric(baseline.atlasPatchMs, current.atlasPatchMs, true),
      maximumTextureBytes: comparisonMetric(baseline.maximumTextureBytes, current.maximumTextureBytes, true),
      estimatedTextureUploadBytes: comparisonMetric(
        baseline.estimatedTextureUploadBytes,
        current.estimatedTextureUploadBytes,
        true,
      ),
    },
  }
}

export function evaluateBenchmarkRegression(
  baseline: BenchmarkResult,
  current: BenchmarkResult,
  thresholds: BenchmarkRegressionThresholds = defaultBenchmarkRegressionThresholds,
): BenchmarkRegressionReport {
  const comparison = compareBenchmarkResults(baseline, current)
  const failures: BenchmarkRegressionFailure[] = []
  for (const metric of Object.keys(thresholds) as BenchmarkMetricName[]) {
    if (!(metric in comparison.metrics)) throw new TypeError(`Unknown metric: ${metric}`)
    const threshold = thresholds[metric]
    if (!threshold) continue
    validateThreshold(metric, threshold)
    const comparisonMetric = comparison.metrics[metric]
    const signedRegression = comparisonMetric.lowerIsBetter
      ? comparisonMetric.delta
      : -comparisonMetric.delta
    const regressionAbsolute = Math.max(0, signedRegression)
    const regressionPercent = comparisonMetric.deltaPercent === null
      ? null
      : Math.max(0, comparisonMetric.lowerIsBetter
        ? comparisonMetric.deltaPercent
        : -comparisonMetric.deltaPercent)
    const exceedsPercent = threshold.maxRegressionPercent !== undefined
      && regressionPercent !== null
      && regressionPercent > threshold.maxRegressionPercent
    const exceedsAbsolute = threshold.maxRegressionAbsolute !== undefined
      && regressionAbsolute > threshold.maxRegressionAbsolute
    if (exceedsPercent || exceedsAbsolute) {
      failures.push({
        metric,
        maxRegressionPercent: threshold.maxRegressionPercent,
        maxRegressionAbsolute: threshold.maxRegressionAbsolute,
        regressionPercent,
        regressionAbsolute,
      })
    }
  }
  return {
    passed: comparison.compatible && failures.length === 0,
    compatible: comparison.compatible,
    comparison,
    failures,
  }
}

export function parseBenchmarkResult(value: unknown): BenchmarkResult {
  const parsed = typeof value === 'string' ? parseJson(value) : value
  assertRecord(parsed, 'benchmark')
  if (parsed.version !== undefined && parsed.version !== 1) {
    throw new TypeError('Unsupported benchmark version')
  }
  assertRecord(parsed.configuration, 'benchmark.configuration')
  assertNonNegativeNumber(parsed.configuration.itemCount, 'benchmark.configuration.itemCount')
  if (typeof parsed.configuration.qualityMode !== 'string'
    || !['auto', 'high', 'medium', 'low'].includes(parsed.configuration.qualityMode)) {
    throw new TypeError('Invalid benchmark qualityMode')
  }
  if (typeof parsed.configuration.layout !== 'string' || !parsed.configuration.layout) {
    throw new TypeError('Invalid benchmark layout')
  }
  if (!Array.isArray(parsed.samples)) throw new TypeError('Invalid benchmark samples')
  if (!Array.isArray(parsed.extensionStats)) throw new TypeError('Invalid extensionStats')
  for (const key of benchmarkNumberFields) assertNonNegativeNumber(parsed[key], `benchmark.${key}`)
  return { ...parsed, version: 1 } as unknown as BenchmarkResult
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

function rendererCounterDelta(
  first: StagePerformanceStats | undefined,
  latest: StagePerformanceStats | undefined,
  key: string,
): number {
  const start = first?.renderer.metrics[key] ?? 0
  const end = latest?.renderer.metrics[key] ?? 0
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

const benchmarkNumberFields = [
  'durationMs',
  'sampleCount',
  'averageFps',
  'minimumFps',
  'averageFrameMs',
  'maximumFrameMs',
  'averageFrameTimeP50',
  'maximumFrameTimeP95',
  'maximumFrameTimeP99',
  'longFramesOver24Ms',
  'longFramesOver33Ms',
  'longFramesOver50Ms',
  'ignoredFrames',
  'averageFrameCpuMs',
  'maximumFrameCpuMs',
  'averageRenderSubmitMs',
  'maximumRenderSubmitMs',
  'averageExtensionUpdateMs',
  'maximumExtensionUpdateMs',
  'maximumExtensions',
  'transformCalculationMs',
  'transformCalculations',
  'pickingMs',
  'pickOperations',
  'atlasBuilds',
  'atlasPatches',
  'atlasDiscardedBuilds',
  'atlasDiscardedPatches',
  'atlasCellsUpdated',
  'atlasBuildMs',
  'atlasPatchMs',
  'atlasDrawMs',
  'imageLoadMs',
  'imageRequests',
  'imageFailures',
  'estimatedTextureUploadBytes',
  'maximumDrawCalls',
  'maximumTriangles',
  'maximumTextureBytes',
  'renderedItems',
  'submittedItems',
  'visibleItems',
] as const

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    throw new TypeError('benchmark must be valid JSON')
  }
}

function assertRecord(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${path} is invalid`)
  }
}

function assertNonNegativeNumber(value: unknown, path: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${path} is invalid`)
  }
}

function validateThreshold(metric: BenchmarkMetricName, threshold: BenchmarkRegressionThreshold): void {
  const values = [threshold.maxRegressionPercent, threshold.maxRegressionAbsolute]
    .filter((value) => value !== undefined)
  if (!values.length || values.some((value) => typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
    throw new TypeError(`Invalid threshold: ${metric}`)
  }
}

function positive(value: number): boolean {
  return value > 0
}

function nonNegative(value: number): boolean {
  return value >= 0 && Number.isFinite(value)
}
