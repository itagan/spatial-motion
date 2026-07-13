import type { QualityMode, StagePerformanceStats } from '../core/MotionStage'

export interface BenchmarkConfiguration {
  itemCount: number
  qualityMode: QualityMode
  layout: string
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
  maximumDrawCalls: number
  maximumTriangles: number
  maximumTextureBytes: number
  renderedItems: number
  visibleItems: number
  samples: BenchmarkSample[]
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
    return {
      configuration: { ...this.configuration },
      durationMs,
      sampleCount: this.samples.length,
      averageFps: average(fpsValues),
      minimumFps: fpsValues.length ? Math.min(...fpsValues) : 0,
      averageFrameMs: average(frameValues),
      maximumFrameMs: frameValues.length ? Math.max(...frameValues) : 0,
      maximumDrawCalls: maximum(this.samples.map(({ stats }) => stats.drawCalls)),
      maximumTriangles: maximum(this.samples.map(({ stats }) => stats.triangles)),
      maximumTextureBytes: maximum(this.samples.map(({ stats }) => stats.textureBytes)),
      renderedItems: latest?.renderedItems ?? 0,
      visibleItems: latest?.visibleItems ?? 0,
      samples: this.samples.map((sample) => ({ elapsedMs: sample.elapsedMs, stats: { ...sample.stats } })),
    }
  }
}

function average(values: number[]): number {
  if (!values.length) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function maximum(values: number[]): number {
  return values.length ? Math.max(...values) : 0
}
