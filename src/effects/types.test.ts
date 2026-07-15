import { describe, expect, it } from 'vitest'
import {
  effectEdgeFade,
  effectTravel,
  emissionEnvelope,
  resolveEmissionOptions,
} from './types'

describe('shared effect motion curves', () => {
  it('uses a monotonic travel curve with stationary endpoints', () => {
    expect(effectTravel(0)).toBe(0)
    expect(effectTravel(0.5)).toBeCloseTo(0.5)
    expect(effectTravel(1)).toBe(1)
    expect(effectTravel(0.01)).toBeLessThan(0.001)
    expect(1 - effectTravel(0.99)).toBeLessThan(0.001)
    expect(Array.from({ length: 100 }, (_, index) => effectTravel(index / 99)))
      .toEqual([...Array.from({ length: 100 }, (_, index) => effectTravel(index / 99))].sort((a, b) => a - b))
  })

  it('fades both sides of a loop before the progress wraps', () => {
    expect(effectEdgeFade(0, 0.08, 0.18)).toBe(0)
    expect(effectEdgeFade(0.5, 0.08, 0.18)).toBe(1)
    expect(effectEdgeFade(1, 0.08, 0.18)).toBe(0)
  })

  it('keeps burst emission continuous across its interval boundary', () => {
    const emission = resolveEmissionOptions({
      mode: 'burst',
      burstInterval: 2,
      burstDuration: 0.5,
    })
    expect(emissionEnvelope(emission, 0)).toBe(0)
    expect(emissionEnvelope(emission, 0.25)).toBe(1)
    expect(emissionEnvelope(emission, 1.999)).toBe(0)
    expect(emissionEnvelope(emission, 2)).toBe(0)
  })
})
