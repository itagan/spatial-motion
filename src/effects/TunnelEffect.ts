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

export interface TunnelOptions {
  farZ?: number
  nearZ?: number
  innerRadius?: number
  outerRadius?: number
  directionCount?: number
  speed?: number
  twist?: number
  farScale?: number
  nearScale?: number
  maxActiveItems?: number
  seed?: number
  emission?: EmissionOptions
  crossSection?: 'circle' | 'square'
}

export type TunnelGpuData = StreamingEffectGpuData<BuiltinStreamingEffectPayload>

export class TunnelEffect implements StreamingEffect {
  readonly name = 'tunnel'
  readonly kind = 'tunnel' as const
  private readonly options: Omit<Required<TunnelOptions>, 'emission'> & { emission: ResolvedEmissionOptions }
  private paths = new Float32Array(0)
  private speedFactors = new Float32Array(0)
  private preparedCount = -1
  private preparedActiveCount = -1

  constructor(options: TunnelOptions = {}) {
    this.options = {
      farZ: options.farZ ?? -18,
      nearZ: options.nearZ ?? 12,
      innerRadius: options.innerRadius ?? 0.18,
      outerRadius: options.outerRadius ?? 5,
      directionCount: options.directionCount ?? 18,
      speed: options.speed ?? 0.16,
      twist: options.twist ?? 0.08,
      farScale: options.farScale ?? 0.22,
      nearScale: options.nearScale ?? 0.72,
      maxActiveItems: options.maxActiveItems ?? 240,
      seed: options.seed ?? 2026,
      emission: resolveEmissionOptions(options.emission),
      crossSection: options.crossSection ?? 'circle',
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
      const lane = index % this.options.directionCount
      const randomAngle = random(index * 3 + 1, this.options.seed)
      const randomRadius = random(index * 3 + 2, this.options.seed)
      const angle = (lane / this.options.directionCount) * Math.PI * 2
        + (randomAngle - 0.5) * (Math.PI * 2 / this.options.directionCount) * 0.7
      const radius = this.options.outerRadius * (0.62 + randomRadius * 0.38)
      const offset = index < activeCount
        ? stableEffectPhase(index, this.options.seed)
        : 0
      const pathIndex = index * 4
      this.paths[pathIndex] = angle
      this.paths[pathIndex + 1] = radius
      this.paths[pathIndex + 2] = offset
      this.paths[pathIndex + 3] = this.options.crossSection === 'square' ? 1 : 0
      this.speedFactors[index] = index < activeCount
        ? 0.88 + random(index + 8000, this.options.seed) * 0.24
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
      const spread = smoothstep(0, 1, travel)
      const currentAngle = angle + progress * this.options.twist
      const radius = this.options.innerRadius + (outerRadius - this.options.innerRadius) * spread
      let x = Math.cos(currentAngle)
      let y = Math.sin(currentAngle)
      if (this.options.crossSection === 'square') {
        const divisor = Math.max(Math.abs(x), Math.abs(y), Number.EPSILON)
        x /= divisor
        y /= divisor
      }
      target.setValues(
        index,
        x * radius,
        y * radius,
        this.options.farZ + (this.options.nearZ - this.options.farZ) * travel,
        this.options.farScale + (this.options.nearScale - this.options.farScale) * travel,
        0,
        0,
        0,
        enabled ? effectEdgeFade(progress, 0.08, 0.18) * emission : 0,
      )
    }
  }

  getGpuData(): TunnelGpuData {
    if (this.preparedCount < 0) throw new Error('TunnelEffect must be prepared before reading GPU data')
    return {
      kind: this.kind,
      activeCount: this.preparedActiveCount,
      payload: {
        paths: this.paths,
        speedFactors: this.speedFactors,
        parameters: createEffectParameters(
          this.options.farZ,
          this.options.nearZ,
          this.options.innerRadius,
          this.options.speed,
          this.options.twist,
          this.options.farScale,
          this.options.nearScale,
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

export const tunnel = (options: TunnelOptions = {}) => new TunnelEffect(options)

function random(index: number, seed: number): number {
  const value = Math.sin(index * 12.9898 + seed * 78.233) * 43758.5453
  return fract(value)
}

function fract(value: number): number {
  return value - Math.floor(value)
}

function smoothstep(min: number, max: number, value: number): number {
  const normalized = Math.min(1, Math.max(0, (value - min) / (max - min)))
  return normalized * normalized * (3 - 2 * normalized)
}
