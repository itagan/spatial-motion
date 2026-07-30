import { describe, expect, it } from 'vitest'
import { linearShooter } from './LinearShooterEffect'
import { calculateEffectTransforms } from './transforms.test-helper'

describe('LinearShooterEffect', () => {
  it('creates deterministic lanes in a fixed instance pool', () => {
    const effect = linearShooter({ directionCount: 12, maxActiveItems: 90, seed: 11 })
    effect.prepare(500)
    const data = effect.getGpuData()

    expect(data.kind).toBe('linear-shooter')
    expect(data.payload.paths).toHaveLength(2000)
    expect(data.payload.speedFactors).toHaveLength(500)
    expect(Array.from(data.payload.speedFactors).filter((speed) => speed >= 0)).toHaveLength(90)
  })

  it('moves active items outward on a camera-facing plane', () => {
    const effect = linearShooter({ sourceRadius: 0.1, outerRadius: 9, maxActiveItems: 100 })
    const initial = calculateEffectTransforms(effect, 300, 0)
    const later = calculateEffectTransforms(effect, 300, 0.5)

    expect(initial).toHaveLength(300)
    expect(initial.every((value) => Object.values(value).every(Number.isFinite))).toBe(true)
    expect(later.some((value, index) => Math.hypot(value.x, value.y) !== Math.hypot(initial[index].x, initial[index].y))).toBe(true)
    expect(new Set(initial.map(({ z }) => z)).size).toBe(1)
  })

  it('shares burst emission semantics with the GPU parameter buffer', () => {
    const effect = linearShooter({
      emission: { mode: 'burst', burstInterval: 1.5, burstDuration: 0.3 },
    })
    expect(calculateEffectTransforms(effect, 100, 0.1).some(({ opacity }) => opacity > 0)).toBe(true)
    expect(calculateEffectTransforms(effect, 100, 0.8).every(({ opacity }) => opacity === 0)).toBe(true)
    const parameters = Array.from(effect.getGpuData().payload.parameters.slice(7))
    ;[1, 1.5, 0.3, 0.35, 0.75].forEach((value, index) => {
      expect(parameters[index]).toBeCloseTo(value)
    })
  })
})
