import type { Transform } from '../core/types'
import {
  createEffectParameters,
  type StreamingEffect,
  type StreamingEffectGpuData,
} from './types'

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
}

export type LinearShooterGpuData = StreamingEffectGpuData

export class LinearShooterEffect implements StreamingEffect {
  readonly name = 'linear-shooter'
  readonly kind = 'linear-shooter' as const
  private readonly options: Required<LinearShooterOptions>
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
    }
  }

  prepare(count: number, activeLimit = Number.POSITIVE_INFINITY): void {
    const activeCount = Math.floor(Math.min(count, this.options.maxActiveItems, Math.max(0, activeLimit)))
    if (this.preparedCount === count && this.preparedActiveCount === activeCount) return
    this.preparedCount = count
    this.preparedActiveCount = activeCount
    this.paths = new Float32Array(count * 4)
    this.speedFactors = new Float32Array(count)
    const activeRows = Math.max(1, Math.ceil(activeCount / this.options.directionCount))

    for (let index = 0; index < count; index += 1) {
      const direction = index % this.options.directionCount
      const sequence = Math.floor(index / this.options.directionCount)
      const laneAngle = (direction / this.options.directionCount) * Math.PI * 2
      const laneWidth = (Math.PI * 2) / this.options.directionCount
      const jitter = (random(index * 2 + 1, this.options.seed) - 0.5)
        * laneWidth
        * this.options.directionJitter
      const radius = this.options.outerRadius * (0.88 + random(index * 2 + 2, this.options.seed) * 0.18)
      const offset = index < activeCount
        ? (sequence / activeRows + direction / (activeRows * this.options.directionCount)) % 1
        : 0
      this.paths.set([laneAngle + jitter, radius, offset, 0], index * 4)
      this.speedFactors[index] = index < activeCount
        ? 0.9 + random(index + 9000, this.options.seed) * 0.2
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
      const distance = this.options.sourceRadius
        + (outerRadius - this.options.sourceRadius) * progress
      return {
        x: Math.cos(angle) * distance,
        y: Math.sin(angle) * distance,
        z: this.options.z,
        scale: this.options.startScale + (this.options.endScale - this.options.startScale) * progress,
        rotationX: 0,
        rotationY: 0,
        rotationZ: 0,
        opacity: enabled ? edgeFade(progress) : 0,
      }
    })
  }

  getGpuData(): LinearShooterGpuData {
    if (this.preparedCount < 0) throw new Error('LinearShooterEffect must be prepared before reading GPU data')
    return {
      kind: this.kind,
      paths: this.paths,
      speedFactors: this.speedFactors,
      parameters: createEffectParameters(
        this.options.sourceRadius,
        this.options.speed,
        this.options.startScale,
        this.options.endScale,
        this.options.z,
      ),
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

function smoothstep(min: number, max: number, value: number): number {
  const normalized = Math.min(1, Math.max(0, (value - min) / (max - min)))
  return normalized * normalized * (3 - 2 * normalized)
}

function edgeFade(progress: number): number {
  return smoothstep(0, 0.04, progress) * (1 - smoothstep(0.82, 1, progress))
}
