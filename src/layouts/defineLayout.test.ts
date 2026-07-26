import { describe, expect, it } from 'vitest'
import { identityTransform } from '../core/math'
import { defineLayout } from './defineLayout'

describe('defineLayout', () => {
  it('creates an immutable validated layout', () => {
    const layout = defineLayout({
      name: ' custom ',
      orientation: 'camera',
      calculate: (count) => Array.from({ length: count }, identityTransform),
    })
    expect(layout.name).toBe('custom')
    expect(layout.calculate(2, { width: 100, height: 100 })).toHaveLength(2)
    expect(Object.isFrozen(layout)).toBe(true)
  })

  it('rejects invalid definitions, counts and transform output', () => {
    expect(() => defineLayout({ name: '', calculate: () => [] })).toThrow(TypeError)
    expect(() => defineLayout({
      name: 'bad-orientation',
      orientation: 'diagonal' as never,
      calculate: () => [],
    })).toThrow(TypeError)
    expect(() => defineLayout({
      name: 'bad-fade',
      hemisphereEdgeFade: 0.6,
      calculate: () => [],
    })).toThrow(RangeError)

    const wrongCount = defineLayout({ name: 'wrong-count', calculate: () => [] })
    expect(() => wrongCount.calculate(1, { width: 1, height: 1 })).toThrow(RangeError)
    expect(() => wrongCount.calculate(-1, { width: 1, height: 1 })).toThrow(RangeError)

    const nonFinite = defineLayout({
      name: 'non-finite',
      calculate: () => [{ ...identityTransform(), x: Number.NaN }],
    })
    expect(() => nonFinite.calculate(1, { width: 1, height: 1 })).toThrow(RangeError)
  })
})
