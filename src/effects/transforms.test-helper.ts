import { TransformBuffer } from '../core/TransformBuffer.js'
import type { Transform } from '../core/types.js'
import type { StreamingEffect } from './types.js'

export function calculateEffectTransforms(
  effect: Pick<StreamingEffect, 'calculateInto'>,
  count: number,
  elapsedSeconds: number,
): Transform[] {
  const buffer = new TransformBuffer(count)
  effect.calculateInto(count, elapsedSeconds, buffer)
  return Array.from({ length: count }, (_, index) => {
    const offset = index * 3
    return {
      x: buffer.positions[offset],
      y: buffer.positions[offset + 1],
      z: buffer.positions[offset + 2],
      scale: buffer.scales[index],
      rotationX: buffer.rotations[offset],
      rotationY: buffer.rotations[offset + 1],
      rotationZ: buffer.rotations[offset + 2],
      opacity: buffer.opacities[index],
    }
  })
}
