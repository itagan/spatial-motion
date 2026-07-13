import type { Transform } from '../core/types.js'
import {
  createEffectParameters,
  type StreamingEffect,
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
}

export type TunnelGpuData = StreamingEffectGpuData

export class TunnelEffect implements StreamingEffect {
  readonly name = 'tunnel'
  readonly kind = 'tunnel' as const
  private readonly options: Required<TunnelOptions>
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
    }
  }

  prepare(count: number, activeLimit = Number.POSITIVE_INFINITY): void {
    const activeCount = Math.floor(Math.min(count, this.options.maxActiveItems, Math.max(0, activeLimit)))
    if (this.preparedCount === count && this.preparedActiveCount === activeCount) return
    this.preparedCount = count
    this.preparedActiveCount = activeCount
    this.paths = new Float32Array(count * 4)
    this.speedFactors = new Float32Array(count)
    for (let index = 0; index < count; index += 1) {
      const lane = index % this.options.directionCount
      const randomAngle = random(index * 3 + 1, this.options.seed)
      const randomRadius = random(index * 3 + 2, this.options.seed)
      const randomOffset = random(index * 3 + 3, this.options.seed)
      const angle = (lane / this.options.directionCount) * Math.PI * 2
        + (randomAngle - 0.5) * (Math.PI * 2 / this.options.directionCount) * 0.7
      const radius = this.options.outerRadius * (0.62 + randomRadius * 0.38)
      const offset = index < activeCount
        ? (index / activeCount + randomOffset / activeCount) % 1
        : 0
      this.paths.set([angle, radius, offset, 0], index * 4)
      this.speedFactors[index] = index < activeCount
        ? 0.88 + random(index + 8000, this.options.seed) * 0.24
        : -1
    }
  }

  calculateTransforms(count: number, elapsedSeconds: number): Transform[] {
    if (this.preparedCount !== count) this.prepare(count)
    return Array.from({ length: count }, (_, index) => {
      const pathIndex = index * 4
      const angle = this.paths[pathIndex]
      const outerRadius = this.paths[pathIndex + 1]
      const offset = this.paths[pathIndex + 2]
      const enabled = this.speedFactors[index] >= 0
      const progress = fract(offset + elapsedSeconds * this.options.speed * Math.abs(this.speedFactors[index]))
      const spread = smoothstep(0, 1, progress)
      const currentAngle = angle + progress * this.options.twist
      const radius = this.options.innerRadius + (outerRadius - this.options.innerRadius) * spread
      return {
        x: Math.cos(currentAngle) * radius,
        y: Math.sin(currentAngle) * radius,
        z: this.options.farZ + (this.options.nearZ - this.options.farZ) * progress,
        scale: this.options.farScale + (this.options.nearScale - this.options.farScale) * progress,
        rotationX: 0,
        rotationY: 0,
        rotationZ: 0,
        opacity: enabled ? edgeFade(progress) : 0,
      }
    })
  }

  getGpuData(): TunnelGpuData {
    if (this.preparedCount < 0) throw new Error('TunnelEffect must be prepared before reading GPU data')
    return {
      kind: this.kind,
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
      ),
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

function edgeFade(progress: number): number {
  return smoothstep(0, 0.06, progress) * (1 - smoothstep(0.9, 1, progress))
}
