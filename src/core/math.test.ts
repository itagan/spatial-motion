import { describe, expect, it } from 'vitest'
import { identityTransform, interpolateTransform } from './math'

describe('transform interpolation', () => {
  it('uses the shortest rotation path when a transition crosses the turn boundary', () => {
    const from = { ...identityTransform(), rotationY: Math.PI * 1.9 }
    const to = { ...identityTransform(), rotationY: Math.PI * 0.1 }
    const middle = interpolateTransform(from, to, 0.5)

    expect(middle.rotationY).toBeCloseTo(Math.PI * 2)
  })

  it('preserves exact transform endpoints', () => {
    const from = { ...identityTransform(), rotationX: -2, rotationY: 4, rotationZ: 1 }
    const to = { ...identityTransform(), rotationX: 2, rotationY: -4, rotationZ: -1 }
    expect(interpolateTransform(from, to, 0)).toEqual(from)
    const end = interpolateTransform(from, to, 1)
    expect(Math.sin(end.rotationX)).toBeCloseTo(Math.sin(to.rotationX))
    expect(Math.cos(end.rotationX)).toBeCloseTo(Math.cos(to.rotationX))
  })
})
