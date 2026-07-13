import type { Transform } from '../core/types'

export interface StreamingEffect {
  readonly name: string
  prepare(count: number): void
  calculateTransforms(count: number, elapsedSeconds: number): Transform[]
}
