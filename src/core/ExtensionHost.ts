import { Group, type Object3D, type PerspectiveCamera } from 'three'
import type { QualityLevel } from './types.js'
import type {
  StageExtension,
  StageExtensionContext,
  StageExtensionHandle,
  StageExtensionStats,
  StageViewport,
} from './extensions.js'

interface ExtensionRecord {
  id: number
  order: number
  sequence: number
  extension: StageExtension
  root: Group
  abortController: AbortController
  active: boolean
  enabled: boolean
  mounted: boolean
  disposed: boolean
  archived: boolean
  paused: boolean
  hasUpdated: boolean
  elapsed: number
  updateCalls: number
  updateTotalMs: number
  updateSamples: number[]
  maximumUpdateMs: number
  slowFrames: number
  errorCount: number
  lastError: string | null
}

interface ExtensionHostOptions {
  parent: Object3D
  camera: PerspectiveCamera
  getViewport: () => StageViewport
  getQuality: () => QualityLevel
  getReducedMotion: () => boolean
  isPaused: () => boolean
  isDestroyed: () => boolean
  onError?: (error: unknown, extension: StageExtension) => void
}

export class ExtensionHost {
  private readonly extensions = new Set<ExtensionRecord>()
  private readonly history: StageExtensionStats[] = []
  private sequence = 0
  private updateDurationMs = 0

  constructor(private readonly options: ExtensionHostOptions) {}

  async add(extension: StageExtension): Promise<StageExtensionHandle> {
    if (!extension || typeof extension.mount !== 'function') {
      throw new TypeError('Stage extension must provide a mount(context) function')
    }
    const root = new Group()
    root.name = `SpatialMotionExtension:${extension.name ?? 'anonymous'}`
    const sequence = this.sequence++
    const record: ExtensionRecord = {
      id: sequence + 1,
      order: Number.isFinite(extension.order) ? extension.order as number : 0,
      sequence,
      extension,
      root,
      abortController: new AbortController(),
      active: true,
      enabled: true,
      mounted: false,
      disposed: false,
      archived: false,
      paused: false,
      hasUpdated: false,
      elapsed: 0,
      updateCalls: 0,
      updateTotalMs: 0,
      updateSamples: [],
      maximumUpdateMs: 0,
      slowFrames: 0,
      errorCount: 0,
      lastError: null,
    }
    this.extensions.add(record)
    this.options.parent.add(root)
    const context: StageExtensionContext = {
      root,
      camera: this.options.camera,
      signal: record.abortController.signal,
    }

    try {
      await extension.mount(context)
      record.mounted = true
      if (!record.active || this.options.isDestroyed()) {
        this.disposeRecord(record)
        throw new Error('MotionStage was destroyed or the extension was removed during mount')
      }
      extension.qualityChange?.(this.options.getQuality())
      extension.reducedMotionChange?.(this.options.getReducedMotion())
      extension.resize?.(this.options.getViewport())
      this.syncPaused(record)
    } catch (error) {
      const cancelled = !record.active || this.options.isDestroyed()
      if (!cancelled) this.recordError(record, error)
      record.mounted = true
      if (record.active) this.removeRecord(record)
      else this.disposeRecord(record)
      if (!cancelled) this.reportError(error, extension)
      throw error
    }

    return {
      get active() { return record.active },
      get enabled() { return record.active && record.enabled },
      enable: () => this.setEnabled(record, true),
      disable: () => this.setEnabled(record, false),
      remove: () => this.removeRecord(record),
    }
  }

  resize(viewport: StageViewport): void {
    for (const record of this.ordered()) {
      if (!record.active || !record.mounted || !record.enabled || !record.extension.resize) continue
      try {
        record.extension.resize(viewport)
      } catch (error) {
        this.fail(record, error)
      }
    }
  }

  qualityChange(quality: QualityLevel): void {
    this.notify('qualityChange', quality)
  }

  reducedMotionChange(reducedMotion: boolean): void {
    this.notify('reducedMotionChange', reducedMotion)
  }

  update(delta: number): void {
    const startedAt = performance.now()
    for (const record of this.ordered()) {
      if (!record.active || !record.mounted || !record.enabled || !record.extension.update) continue
      const extensionDelta = record.hasUpdated ? delta : 0
      record.hasUpdated = true
      record.elapsed += extensionDelta
      const extensionStartedAt = performance.now()
      try {
        record.extension.update({ elapsed: record.elapsed, delta: extensionDelta })
      } catch (error) {
        this.fail(record, error)
      } finally {
        this.recordUpdate(record, performance.now() - extensionStartedAt)
      }
    }
    this.updateDurationMs = performance.now() - startedAt
  }

  setPaused(paused: boolean): void {
    for (const record of this.ordered()) this.syncPaused(record, paused)
  }

  getCount(): number {
    return this.extensions.size
  }

  getUpdateDuration(): number {
    return this.updateDurationMs
  }

  getStats(): StageExtensionStats[] {
    return [
      ...this.ordered().map((record) => extensionStats(record)),
      ...this.history.map((stats) => ({ ...stats })),
    ]
  }

  dispose(): void {
    for (const record of this.ordered()) this.removeRecord(record)
  }

  private ordered(): ExtensionRecord[] {
    return [...this.extensions].sort((left, right) =>
      left.order - right.order || left.sequence - right.sequence)
  }

  private setEnabled(record: ExtensionRecord, enabled: boolean): void {
    if (!record.active || record.enabled === enabled) return
    record.enabled = enabled
    record.root.visible = enabled
    if (enabled && record.mounted && record.extension.resize) {
      try {
        record.extension.resize(this.options.getViewport())
      } catch (error) {
        this.fail(record, error)
        return
      }
    }
    this.syncPaused(record)
  }

  private syncPaused(record: ExtensionRecord, stagePaused = this.options.isPaused()): void {
    if (!record.active || !record.mounted) return
    const paused = stagePaused || !record.enabled
    if (record.paused === paused) return
    record.paused = paused
    const callback = paused ? record.extension.pause : record.extension.resume
    if (!callback) return
    try {
      callback.call(record.extension)
    } catch (error) {
      this.fail(record, error)
    }
  }

  private notify(
    callbackName: 'qualityChange' | 'reducedMotionChange',
    value: QualityLevel | boolean,
  ): void {
    for (const record of this.ordered()) {
      if (!record.active || !record.mounted) continue
      try {
        if (callbackName === 'qualityChange') {
          record.extension.qualityChange?.(value as QualityLevel)
        } else {
          record.extension.reducedMotionChange?.(value as boolean)
        }
      } catch (error) {
        this.fail(record, error)
      }
    }
  }

  private recordUpdate(record: ExtensionRecord, durationMs: number): void {
    const duration = Math.max(0, durationMs)
    record.updateCalls += 1
    record.updateTotalMs += duration
    record.maximumUpdateMs = Math.max(record.maximumUpdateMs, duration)
    if (duration > SLOW_UPDATE_MS) record.slowFrames += 1
    record.updateSamples.push(duration)
    if (record.updateSamples.length > SAMPLE_LIMIT) record.updateSamples.shift()
  }

  private recordError(record: ExtensionRecord, error: unknown): void {
    record.errorCount += 1
    record.lastError = error instanceof Error ? error.message : String(error)
  }

  private fail(record: ExtensionRecord, error: unknown): void {
    this.recordError(record, error)
    this.removeRecord(record)
    this.reportError(error, record.extension)
  }

  private removeRecord(record: ExtensionRecord): void {
    if (!record.active) return
    record.active = false
    record.abortController.abort()
    this.extensions.delete(record)
    record.root.removeFromParent()
    if (record.mounted) this.disposeRecord(record)
  }

  private disposeRecord(record: ExtensionRecord): void {
    if (record.disposed) return
    record.disposed = true
    try {
      record.extension.dispose?.()
    } catch (error) {
      this.recordError(record, error)
      this.reportError(error, record.extension)
    } finally {
      record.root.clear()
      this.archive(record)
    }
  }

  private archive(record: ExtensionRecord): void {
    if (record.archived || record.active) return
    record.archived = true
    this.history.unshift({ ...extensionStats(record), active: false, enabled: false })
    if (this.history.length > HISTORY_LIMIT) this.history.pop()
  }

  private reportError(error: unknown, extension: StageExtension): void {
    try {
      this.options.onError?.(error, extension)
    } catch {
      // An error observer must not break the Stage render or cleanup path.
    }
  }
}

const SAMPLE_LIMIT = 120
const HISTORY_LIMIT = 20
const SLOW_UPDATE_MS = 2

function extensionStats(record: ExtensionRecord): StageExtensionStats {
  const orderedSamples = [...record.updateSamples].sort((left, right) => left - right)
  return {
    id: record.id,
    name: record.extension.name ?? 'anonymous',
    order: record.order,
    active: record.active,
    enabled: record.active && record.enabled,
    updateCalls: record.updateCalls,
    averageUpdateMs: record.updateCalls ? record.updateTotalMs / record.updateCalls : 0,
    updateTimeP95: percentile(orderedSamples, 0.95),
    updateTimeP99: percentile(orderedSamples, 0.99),
    maximumUpdateMs: record.maximumUpdateMs,
    slowFrames: record.slowFrames,
    errorCount: record.errorCount,
    lastError: record.lastError,
  }
}

function percentile(orderedValues: number[], fraction: number): number {
  if (!orderedValues.length) return 0
  return orderedValues[Math.min(
    orderedValues.length - 1,
    Math.floor(orderedValues.length * fraction),
  )]
}
