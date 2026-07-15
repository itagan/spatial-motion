import type { Transform } from '../core/types.js'

export type EmissionMode = 'continuous' | 'burst' | 'wave'

export interface EmissionOptions {
  mode?: EmissionMode
  burstInterval?: number
  burstDuration?: number
  waveFrequency?: number
  waveStrength?: number
}

export interface ResolvedEmissionOptions {
  mode: EmissionMode
  burstInterval: number
  burstDuration: number
  waveFrequency: number
  waveStrength: number
}

export type StreamingEffectKind = 'tunnel' | 'linear-shooter' | 'vortex' | 'radial-burst'

export interface StreamingEffectGpuData {
  kind: StreamingEffectKind
  /** Four floats per instance. Their meaning is owned by the built-in effect kind. */
  paths: Float32Array
  /** Negative values mark dormant pool entries. */
  speedFactors: Float32Array
  /** Three vec4 uniforms shared by every built-in effect. */
  parameters: Float32Array
}

export interface StreamingEffect {
  readonly name: string
  readonly kind: StreamingEffectKind
  prepare(count: number, activeLimit?: number): void
  calculateTransforms(count: number, elapsedSeconds: number): Transform[]
  getGpuData(): StreamingEffectGpuData
}

export function createEffectParameters(...values: number[]): Float32Array {
  const parameters = new Float32Array(12)
  parameters.set(values.slice(0, parameters.length))
  return parameters
}

export function resolveEmissionOptions(options: EmissionOptions = {}): ResolvedEmissionOptions {
  const burstInterval = positive(options.burstInterval, 2)
  return {
    mode: options.mode ?? 'continuous',
    burstInterval,
    burstDuration: Math.min(burstInterval, positive(options.burstDuration, 0.45)),
    waveFrequency: positive(options.waveFrequency, 0.35),
    waveStrength: Math.min(1, Math.max(0, options.waveStrength ?? 0.75)),
  }
}

export function emissionModeCode(mode: EmissionMode): number {
  if (mode === 'burst') return 1
  if (mode === 'wave') return 2
  return 0
}

export function emissionEnvelope(options: ResolvedEmissionOptions, elapsedSeconds: number): number {
  if (options.mode === 'continuous') return 1
  if (options.mode === 'wave') {
    const wave = Math.sin(elapsedSeconds * options.waveFrequency * Math.PI * 2) * 0.5 + 0.5
    return 1 - options.waveStrength + wave * options.waveStrength
  }
  const phase = modulo(elapsedSeconds, options.burstInterval)
  const edge = Math.min(0.1, options.burstDuration * 0.25)
  return smoothstep(0, edge, phase)
    * (1 - smoothstep(options.burstDuration - edge, options.burstDuration, phase))
}

/** Smooth travel with zero velocity at both ends, hidden by the effect edge fade before wrapping. */
export function effectTravel(progress: number): number {
  const value = Math.min(1, Math.max(0, progress))
  return value * value * value * (value * (value * 6 - 15) + 10)
}

export function effectEdgeFade(progress: number, fadeIn: number, fadeOut: number): number {
  return smoothstep(0, fadeIn, progress)
    * (1 - smoothstep(1 - fadeOut, 1, progress))
}

function positive(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && (value ?? 0) > 0 ? value as number : fallback
}

function modulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor
}

function smoothstep(min: number, max: number, value: number): number {
  if (max <= min) return value < min ? 0 : 1
  const normalized = Math.min(1, Math.max(0, (value - min) / (max - min)))
  return normalized * normalized * (3 - 2 * normalized)
}
