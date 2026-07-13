import type { Transform } from '../core/types'
import {
  createEffectParameters,
  type StreamingEffect,
  type StreamingEffectGpuData,
} from './types'

export interface RadialBurstOptions {
  sourceRadius?: number
  outerRadius?: number
  speed?: number
  z?: number
  startScale?: number
  endScale?: number
  direction?: 'in' | 'out'
  depthScale?: number
  maxActiveItems?: number
  seed?: number
}

export type RadialBurstGpuData = StreamingEffectGpuData

export class RadialBurstEffect implements StreamingEffect {
  readonly name = 'radial-burst'
  readonly kind = 'radial-burst' as const
  private readonly options: Required<RadialBurstOptions>
  private paths = new Float32Array(0)
  private speedFactors = new Float32Array(0)
  private preparedCount = -1
  private preparedActiveCount = -1

  constructor(options: RadialBurstOptions = {}) {
    this.options = {
      sourceRadius: options.sourceRadius ?? 0.12,
      outerRadius: options.outerRadius ?? 9.5,
      speed: options.speed ?? 0.22,
      z: options.z ?? 2,
      startScale: options.startScale ?? 0.12,
      endScale: options.endScale ?? 0.92,
      direction: options.direction ?? 'out',
      depthScale: options.depthScale ?? 0.32,
      maxActiveItems: options.maxActiveItems ?? 180,
      seed: options.seed ?? 2029,
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
      const azimuth = random(index * 4 + 1, this.options.seed) * Math.PI * 2
      const elevation = Math.asin(random(index * 4 + 2, this.options.seed) * 2 - 1)
      const radius = this.options.outerRadius * (0.82 + random(index * 4 + 3, this.options.seed) * 0.18)
      const offset = index < activeCount
        ? (index / Math.max(1, activeCount) + random(index * 4 + 4, this.options.seed) / Math.max(1, activeCount)) % 1
        : 0
      this.paths.set([azimuth, elevation, radius, offset], index * 4)
      this.speedFactors[index] = index < activeCount
        ? 0.9 + random(index + 11_000, this.options.seed) * 0.2
        : -1
    }
  }

  calculateTransforms(count: number, elapsedSeconds: number): Transform[] {
    if (this.preparedCount !== count) this.prepare(count)
    return Array.from({ length: count }, (_, index) => {
      const pathIndex = index * 4
      const azimuth = this.paths[pathIndex]
      const elevation = this.paths[pathIndex + 1]
      const outerRadius = this.paths[pathIndex + 2]
      const offset = this.paths[pathIndex + 3]
      const speedFactor = this.speedFactors[index]
      const enabled = speedFactor >= 0
      const progress = fract(offset + elapsedSeconds * this.options.speed * Math.abs(speedFactor))
      const travel = this.options.direction === 'out' ? progress : 1 - progress
      const distance = this.options.sourceRadius
        + (outerRadius - this.options.sourceRadius) * smoothstep(0, 1, travel)
      const horizontal = Math.cos(elevation) * distance
      return {
        x: Math.cos(azimuth) * horizontal,
        y: Math.sin(elevation) * distance,
        z: this.options.z + Math.sin(azimuth) * horizontal * this.options.depthScale,
        scale: this.options.startScale + (this.options.endScale - this.options.startScale) * travel,
        rotationX: 0,
        rotationY: 0,
        rotationZ: 0,
        opacity: enabled ? edgeFade(progress) : 0,
      }
    })
  }

  getGpuData(): RadialBurstGpuData {
    if (this.preparedCount < 0) throw new Error('RadialBurstEffect must be prepared before reading GPU data')
    return {
      kind: this.kind,
      paths: this.paths,
      speedFactors: this.speedFactors,
      parameters: createEffectParameters(
        this.options.sourceRadius,
        this.options.outerRadius,
        this.options.speed,
        this.options.z,
        this.options.startScale,
        this.options.endScale,
        this.options.direction === 'out' ? 1 : 0,
        this.options.depthScale,
      ),
    }
  }
}

export const radialBurst = (options: RadialBurstOptions = {}) => new RadialBurstEffect(options)

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
  return smoothstep(0, 0.04, progress) * (1 - smoothstep(0.86, 1, progress))
}
