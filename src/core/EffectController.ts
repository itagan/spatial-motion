import type {
  StreamingEffect,
  StreamingEffectGpuData,
} from '../effects/types.js'
import type { MotionRendererStreamingEffectsCapability } from '../renderers/MotionRenderer.js'
import {
  TransformBuffer,
  type TransformBufferView,
} from './TransformBuffer.js'

interface ActiveEffect {
  effect: StreamingEffect
  gpuData: StreamingEffectGpuData
  elapsedSeconds: number
  lastUpdatedAt: number
}

export type EffectControllerPhase = 'activate' | 'reconfigure' | 'restore'

export interface EffectControllerError {
  effect: string
  phase: EffectControllerPhase
  error: unknown
}

export class EffectController {
  private active: ActiveEffect | null = null
  private generation = 0
  private disposed = false
  private activating = false
  private readonly transforms = new TransformBuffer()

  constructor(
    private readonly renderer: MotionRendererStreamingEffectsCapability | undefined,
    private readonly onError?: (event: EffectControllerError) => void,
  ) {}

  prepare(
    effect: StreamingEffect,
    count: number,
    activeLimit: number,
  ): TransformBufferView {
    effect.prepare(count, activeLimit)
    return this.calculateInto(effect, count, 0)
  }

  async activate(effect: StreamingEffect, now: number): Promise<boolean> {
    const gpuData = effect.getGpuData()
    if (!this.renderer || this.disposed) return false
    const generation = ++this.generation
    this.activating = true
    try {
      const accepted = await this.renderer.enable(gpuData)
      if (this.disposed || generation !== this.generation || accepted === false) return false
      this.active = { effect, gpuData, elapsedSeconds: 0, lastUpdatedAt: now }
      return true
    } catch (error) {
      if (generation === this.generation) {
        this.onError?.({ effect: effect.kind, phase: 'activate', error })
      }
      return false
    } finally {
      if (generation === this.generation) this.activating = false
    }
  }

  deactivate(): void {
    this.generation += 1
    if (!this.active) {
      if (this.activating) this.renderer?.disable()
      this.activating = false
      return
    }
    this.active = null
    this.renderer?.disable()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.deactivate()
  }

  hasActive(): boolean {
    return this.active !== null
  }

  getToken(): object | null {
    return this.active
  }

  isTokenActive(token: object | null): boolean {
    return token !== null && this.active === token
  }

  getName(): string | null {
    return this.active?.effect.name ?? null
  }

  getGpuData(): StreamingEffectGpuData | null {
    return this.active?.gpuData ?? null
  }

  getActiveCount(): number {
    return this.active?.gpuData.activeCount ?? 0
  }

  resolveBuffer(
    count: number,
    now: number,
    paused: boolean,
  ): TransformBufferView | null {
    if (!this.active) return null
    return this.calculateInto(
      this.active.effect,
      count,
      this.elapsedAt(now, paused),
    )
  }

  advance(now: number): void {
    if (!this.active) return
    this.active.elapsedSeconds += Math.max(0, now - this.active.lastUpdatedAt) / 1000
    this.active.lastUpdatedAt = now
    this.renderer?.setTime(this.active.elapsedSeconds)
  }

  rebaseClock(now: number): void {
    if (this.active) this.active.lastUpdatedAt = now
  }

  async reconfigure(count: number, activeLimit: number, now: number, paused: boolean): Promise<boolean> {
    if (!this.active) {
      if (this.activating) {
        this.generation += 1
        this.activating = false
        this.renderer?.disable()
      }
      return false
    }
    const active = this.active
    active.elapsedSeconds = this.elapsedAt(now, paused)
    active.lastUpdatedAt = now
    active.effect.prepare(count, activeLimit)
    const gpuData = active.effect.getGpuData()
    active.gpuData = gpuData
    const generation = ++this.generation
    try {
      const accepted = await this.renderer?.enable(gpuData)
      if (this.disposed || generation !== this.generation || this.active !== active) return false
      if (accepted === false) {
        this.deactivate()
        return false
      }
      active.gpuData = gpuData
      this.renderer?.setTime(active.elapsedSeconds)
      return true
    } catch (error) {
      if (generation === this.generation) {
        this.onError?.({ effect: active.effect.kind, phase: 'reconfigure', error })
        this.deactivate()
      }
      return false
    }
  }

  async restoreRendererState(): Promise<boolean> {
    if (!this.active || !this.renderer) return false
    const active = this.active
    const generation = ++this.generation
    try {
      const accepted = await this.renderer.enable(active.gpuData)
      if (this.disposed || generation !== this.generation || this.active !== active) return false
      if (accepted === false) return false
      this.renderer.setTime(active.elapsedSeconds)
      return true
    } catch (error) {
      if (generation === this.generation) {
        this.onError?.({ effect: active.effect.kind, phase: 'restore', error })
      }
      return false
    }
  }

  settleReducedMotion(count: number): TransformBufferView | null {
    if (!this.active) return null
    const transforms = this.calculateInto(this.active.effect, count, 0)
    this.deactivate()
    return transforms
  }

  private calculateInto(
    effect: StreamingEffect,
    count: number,
    elapsedSeconds: number,
  ): TransformBuffer {
    this.transforms.resize(count)
    effect.calculateInto(count, elapsedSeconds, this.transforms)
    return this.transforms
  }

  private elapsedAt(now: number, paused: boolean): number {
    if (!this.active) return 0
    const pendingSeconds = paused
      ? 0
      : Math.max(0, now - this.active.lastUpdatedAt) / 1000
    return this.active.elapsedSeconds + pendingSeconds
  }
}
