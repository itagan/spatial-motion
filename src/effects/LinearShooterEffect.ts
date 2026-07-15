import type { Transform } from '../core/types.js'
import {
  createEffectParameters,
  effectEdgeFade,
  effectTravel,
  emissionEnvelope,
  emissionModeCode,
  resolveEmissionOptions,
  type EmissionOptions,
  type ResolvedEmissionOptions,
  type StreamingEffect,
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

export type LinearShooterGpuData = StreamingEffectGpuData

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
      const travel = effectTravel(progress)
      const distance = this.options.sourceRadius
        + (outerRadius - this.options.sourceRadius) * travel
      return {
        x: Math.cos(angle) * distance,
        y: Math.sin(angle) * distance,
        z: this.options.z,
        scale: this.options.startScale + (this.options.endScale - this.options.startScale) * travel,
        rotationX: 0,
        rotationY: 0,
        rotationZ: 0,
        opacity: enabled ? effectEdgeFade(progress, 0.06, 0.22) * emissionEnvelope(this.options.emission, elapsedSeconds) : 0,
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
        0,
        0,
        emissionModeCode(this.options.emission.mode),
        this.options.emission.burstInterval,
        this.options.emission.burstDuration,
        this.options.emission.waveFrequency,
        this.options.emission.waveStrength,
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
