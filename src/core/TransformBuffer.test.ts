import { describe, expect, it } from 'vitest'
import { defineLayout } from '../layouts/defineLayout.js'
import {
  TransformBuffer,
  calculateLayoutInto,
} from './TransformBuffer.js'
import type { Transform } from './types.js'

describe('TransformBuffer', () => {
  it('grows by capacity buckets and reuses typed arrays when count shrinks', () => {
    const buffer = new TransformBuffer(3)
    const positions = buffer.positions

    expect(buffer.scales.length).toBe(4)
    buffer.resize(2)
    expect(buffer.positions).toBe(positions)
    buffer.resize(5)
    expect(buffer.scales.length).toBe(8)
    expect(buffer.positions).not.toBe(positions)
  })

  it('writes and materializes SoA transforms into reusable objects', () => {
    const buffer = new TransformBuffer(1)
    buffer.setValues(0, 1, 2, 3, 0.5, 0.1, 0.2, 0.3, 0.8)
    const first = materialize(buffer)
    const firstTransform = first[0]
    buffer.positions[0] = 4
    const second = materialize(buffer, first)

    expect(second).toBe(first)
    expect(second[0]).toBe(firstTransform)
    expect(second[0]).toMatchObject({ x: 4, y: 2, opacity: expect.closeTo(0.8) })
  })

  it('supports buffer-native layouts without an intermediate Transform array', () => {
    const layout = defineLayout({
      name: 'buffer-layout',
      calculateInto(count, _context, target) {
        for (let index = 0; index < count; index += 1) {
          target.setValues(index, index, 0, 0, 1, 0, 0, 0, 1)
        }
      },
    })
    const target = new TransformBuffer(0)

    expect(calculateLayoutInto(
      layout,
      3,
      { width: 100, height: 100 },
      target,
    )).toBe(target)
    expect(materialize(target).map(({ x }) => x)).toEqual([0, 1, 2])
    expect(layout.calculate(2, { width: 100, height: 100 })).toHaveLength(2)
  })

  it('rejects non-finite buffer output', () => {
    const layout = defineLayout({
      name: 'invalid-buffer',
      calculateInto(_count, _context, target) {
        target.positions[0] = Number.NaN
      },
    })

    expect(() => layout.calculateInto?.(
      1,
      { width: 1, height: 1 },
      new TransformBuffer(1),
    )).toThrow('transform 0 must be finite')
  })
})

function materialize(buffer: TransformBuffer, target: Transform[] = []): Transform[] {
  target.length = buffer.count
  for (let index = 0; index < buffer.count; index += 1) {
    const offset = index * 3
    const transform = target[index] ?? {} as Transform
    Object.assign(transform, {
      x: buffer.positions[offset],
      y: buffer.positions[offset + 1],
      z: buffer.positions[offset + 2],
      scale: buffer.scales[index],
      rotationX: buffer.rotations[offset],
      rotationY: buffer.rotations[offset + 1],
      rotationZ: buffer.rotations[offset + 2],
      opacity: buffer.opacities[index],
    })
    target[index] = transform
  }
  return target
}
