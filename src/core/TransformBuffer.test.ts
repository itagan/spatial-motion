import { describe, expect, it } from 'vitest'
import { defineLayout } from '../layouts/defineLayout.js'
import {
  TransformBuffer,
  calculateLayoutInto,
} from './TransformBuffer.js'

describe('TransformBuffer', () => {
  it('grows by capacity buckets and reuses typed arrays when count shrinks', () => {
    const buffer = new TransformBuffer(3)
    const positions = buffer.positions

    expect(buffer.capacity).toBe(4)
    buffer.resize(2)
    expect(buffer.positions).toBe(positions)
    buffer.resize(5)
    expect(buffer.capacity).toBe(8)
    expect(buffer.positions).not.toBe(positions)
  })

  it('writes and materializes SoA transforms into reusable objects', () => {
    const buffer = new TransformBuffer(1)
    buffer.set(0, {
      x: 1,
      y: 2,
      z: 3,
      scale: 0.5,
      rotationX: 0.1,
      rotationY: 0.2,
      rotationZ: 0.3,
      opacity: 0.8,
    })
    const first = buffer.toTransforms()
    const firstTransform = first[0]
    buffer.positions[0] = 4
    const second = buffer.toTransforms(first)

    expect(second).toBe(first)
    expect(second[0]).toBe(firstTransform)
    expect(second[0]).toMatchObject({ x: 4, y: 2, opacity: expect.closeTo(0.8) })
  })

  it('supports buffer-native layouts without an intermediate Transform array', () => {
    const layout = defineLayout({
      name: 'buffer-layout',
      calculateInto(count, _context, target) {
        for (let index = 0; index < count; index += 1) {
          target.set(index, {
            x: index,
            y: 0,
            z: 0,
            scale: 1,
            rotationX: 0,
            rotationY: 0,
            rotationZ: 0,
            opacity: 1,
          })
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
    expect(target.toTransforms().map(({ x }) => x)).toEqual([0, 1, 2])
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
