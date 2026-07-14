import type { Transform } from '../core/types.js'

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
