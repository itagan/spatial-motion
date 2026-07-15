import type { Transform } from '../core/types.js'
import {
  createEffectParameters,
  effectEdgeFade,
  effectTravel,
  stableEffectPhase,
  type StreamingEffect,
  type StreamingEffectGpuData,
} from './types.js'

export interface VortexOptions {
  innerRadius?: number
  outerRadius?: number
  farZ?: number
  nearZ?: number
  speed?: number
  turns?: number
  startScale?: number
  endScale?: number
  direction?: 'in' | 'out'
  maxActiveItems?: number
  seed?: number
}

export type VortexGpuData = StreamingEffectGpuData

export class VortexEffect implements StreamingEffect {
  readonly name = 'vortex'
  readonly kind = 'vortex' as const
  private readonly options: Required<VortexOptions>
  private paths = new Float32Array(0)
  private speedFactors = new Float32Array(0)
  private preparedCount = -1
  private preparedActiveCount = -1

  constructor(options: VortexOptions = {}) {
    this.options = {
      innerRadius: options.innerRadius ?? 0.18,
      outerRadius: options.outerRadius ?? 5.6,
      farZ: options.farZ ?? -8,
      nearZ: options.nearZ ?? 5,
      speed: options.speed ?? 0.13,
      turns: options.turns ?? 2.4,
      startScale: options.startScale ?? 0.14,
      endScale: options.endScale ?? 0.82,
      direction: options.direction ?? 'in',
      maxActiveItems: options.maxActiveItems ?? 220,
      seed: options.seed ?? 2028,
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
      const angle = random(index * 3 + 1, this.options.seed) * Math.PI * 2
      const radius = this.options.outerRadius * (0.82 + random(index * 3 + 2, this.options.seed) * 0.18)
      const offset = index < activeCount
        ? stableEffectPhase(index, this.options.seed)
        : 0
      this.paths.set([angle, radius, offset, 0], index * 4)
      this.speedFactors[index] = index < activeCount
        ? 0.88 + random(index + 10_000, this.options.seed) * 0.24
        : -1
    }
  }

  calculateTransforms(count: number, elapsedSeconds: number): Transform[] {
    if (this.preparedCount !== count) this.prepare(count)
    return Array.from({ length: count }, (_, index) => {
      const pathIndex = index * 4
      const baseAngle = this.paths[pathIndex]
      const outerRadius = this.paths[pathIndex + 1]
      const offset = this.paths[pathIndex + 2]
      const speedFactor = this.speedFactors[index]
      const enabled = speedFactor >= 0
      const progress = fract(offset + elapsedSeconds * this.options.speed * Math.abs(speedFactor))
      const curvedProgress = effectTravel(progress)
      const travel = this.options.direction === 'out' ? curvedProgress : 1 - curvedProgress
      const spread = smoothstep(0, 1, travel)
      const angleDirection = this.options.direction === 'out' ? 1 : -1
      const angle = baseAngle + progress * this.options.turns * Math.PI * 2 * angleDirection
      const radius = this.options.innerRadius + (outerRadius - this.options.innerRadius) * spread
      return {
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        z: this.options.nearZ + (this.options.farZ - this.options.nearZ) * travel,
        scale: this.options.startScale + (this.options.endScale - this.options.startScale) * travel,
        rotationX: 0,
        rotationY: 0,
        rotationZ: 0,
        opacity: enabled ? effectEdgeFade(progress, 0.07, 0.18) : 0,
      }
    })
  }

  getGpuData(): VortexGpuData {
    if (this.preparedCount < 0) throw new Error('VortexEffect must be prepared before reading GPU data')
    return {
      kind: this.kind,
      paths: this.paths,
      speedFactors: this.speedFactors,
      parameters: createEffectParameters(
        this.options.innerRadius,
        this.options.outerRadius,
        this.options.farZ,
        this.options.nearZ,
        this.options.speed,
        this.options.turns,
        this.options.startScale,
        this.options.endScale,
        this.options.direction === 'out' ? 1 : 0,
      ),
    }
  }
}

export const vortex = (options: VortexOptions = {}) => new VortexEffect(options)

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
