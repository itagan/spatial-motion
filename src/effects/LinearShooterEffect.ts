import type { TransformBuffer } from '../core/TransformBuffer.js'
import {
  createEffectParameters,
  effectEdgeFade,
  effectTravel,
  emissionEnvelope,
  emissionModeCode,
  resolveEmissionOptions,
  stableEffectPhase,
  type EmissionOptions,
  type ResolvedEmissionOptions,
  type StreamingEffect,
  type BuiltinStreamingEffectPayload,
  type StreamingEffectGpuData,
} from './types.js'

export interface LinearShooterOptions {
  sourceRadius?: number
  outerRadius?: number
  directionCount?: number
  speed?: number
  startScale?: number
  endScale?: number
  z?: number
  maxActiveItems?: number
  directionJitter?: number
  seed?: number
  emission?: EmissionOptions
}

export type LinearShooterGpuData = StreamingEffectGpuData<BuiltinStreamingEffectPayload>

export class LinearShooterEffect implements StreamingEffect {
  readonly name = 'linear-shooter'
  readonly kind = 'linear-shooter' as const
  private readonly options: Omit<Required<LinearShooterOptions>, 'emission'> & { emission: ResolvedEmissionOptions }
  private paths = new Float32Array(0)
  private speedFactors = new Float32Array(0)
  private preparedCount = -1
  private preparedActiveCount = -1

  constructor(options: LinearShooterOptions = {}) {
    this.options = {
      sourceRadius: options.sourceRadius ?? 0.15,
      outerRadius: options.outerRadius ?? 10,
      directionCount: options.directionCount ?? 18,
      speed: options.speed ?? 0.24,
      startScale: options.startScale ?? 0.16,
      endScale: options.endScale ?? 1,
      z: options.z ?? 1.5,
      maxActiveItems: options.maxActiveItems ?? 180,
      directionJitter: options.directionJitter ?? 0.45,
      seed: options.seed ?? 2027,
      emission: resolveEmissionOptions(options.emission),
    }
  }

  prepare(count: number, activeLimit = Number.POSITIVE_INFINITY): void {
    const activeCount = Math.floor(Math.min(count, this.options.maxActiveItems, Math.max(0, activeLimit)))
    if (this.preparedCount === count && this.preparedActiveCount === activeCount) return
    this.preparedCount = count
    this.preparedActiveCount = activeCount
    if (this.speedFactors.length !== count) {
      this.paths = new Float32Array(count * 4)
      this.speedFactors = new Float32Array(count)
    }
    for (let index = 0; index < count; index += 1) {
      const direction = index % this.options.directionCount
      const laneAngle = (direction / this.options.directionCount) * Math.PI * 2
      const laneWidth = (Math.PI * 2) / this.options.directionCount
      const jitter = (random(index * 2 + 1, this.options.seed) - 0.5)
        * laneWidth
        * this.options.directionJitter
      const radius = this.options.outerRadius * (0.88 + random(index * 2 + 2, this.options.seed) * 0.18)
      const offset = index < activeCount
        ? stableEffectPhase(index, this.options.seed)
        : 0
      const pathIndex = index * 4
      this.paths[pathIndex] = laneAngle + jitter
      this.paths[pathIndex + 1] = radius
      this.paths[pathIndex + 2] = offset
      this.paths[pathIndex + 3] = 0
      this.speedFactors[index] = index < activeCount
        ? 0.9 + random(index + 9000, this.options.seed) * 0.2
        : -1
    }
  }

  calculateInto(
    count: number,
    elapsedSeconds: number,
    target: TransformBuffer,
  ): void {
    if (this.preparedCount !== count) this.prepare(count)
    target.resize(count)
    const emission = emissionEnvelope(this.options.emission, elapsedSeconds)
    for (let index = 0; index < count; index += 1) {
      const pathIndex = index * 4
      const angle = this.paths[pathIndex]
      const outerRadius = this.paths[pathIndex + 1]
      const offset = this.paths[pathIndex + 2]
      const enabled = this.speedFactors[index] >= 0
      const progress = fract(offset + elapsedSeconds * this.options.speed * Math.abs(this.speedFactors[index]))
      const travel = effectTravel(progress)
      const distance = this.options.sourceRadius
        + (outerRadius - this.options.sourceRadius) * travel
      target.setValues(
        index,
        Math.cos(angle) * distance,
        Math.sin(angle) * distance,
        this.options.z,
        this.options.startScale + (this.options.endScale - this.options.startScale) * travel,
        0,
        0,
        0,
        enabled ? effectEdgeFade(progress, 0.06, 0.22) * emission : 0,
      )
    }
  }

  getGpuData(): LinearShooterGpuData {
    if (this.preparedCount < 0) throw new Error('LinearShooterEffect must be prepared before reading GPU data')
    return {
      kind: this.kind,
      activeCount: this.preparedActiveCount,
      payload: {
        paths: this.paths,
        speedFactors: this.speedFactors,
        parameters: createEffectParameters(
          this.options.sourceRadius,
          this.options.speed,
          this.options.startScale,
          this.options.endScale,
          this.options.z,
          0,
          0,
          emissionModeCode(this.options.emission.mode),
          this.options.emission.burstInterval,
          this.options.emission.burstDuration,
          this.options.emission.waveFrequency,
          this.options.emission.waveStrength,
        ),
      },
    }
  }
}

export const linearShooter = (options: LinearShooterOptions = {}) => new LinearShooterEffect(options)

function random(index: number, seed: number): number {
  const value = Math.sin(index * 12.9898 + seed * 78.233) * 43758.5453
  return fract(value)
}

function fract(value: number): number {
  return value - Math.floor(value)
}
