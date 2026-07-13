import { describe, expect, it } from 'vitest'
import { linearShooter } from './LinearShooterEffect'

describe('LinearShooterEffect', () => {
  it('creates deterministic lanes in a fixed instance pool', () => {
    const effect = linearShooter({ directionCount: 12, maxActiveItems: 90, seed: 11 })
    effect.prepare(500)
    const data = effect.getGpuData()

    expect(data.paths).toHaveLength(1500)
    expect(data.speedFactors).toHaveLength(500)
    expect(Array.from(data.speedFactors).filter((speed) => speed >= 0)).toHaveLength(90)
  })

  it('moves active items outward on a camera-facing plane', () => {
    const effect = linearShooter({ sourceRadius: 0.1, outerRadius: 9, maxActiveItems: 100 })
    const initial = effect.calculateTransforms(300, 0)
    const later = effect.calculateTransforms(300, 0.5)

    expect(initial).toHaveLength(300)
    expect(initial.every((value) => Object.values(value).every(Number.isFinite))).toBe(true)
    expect(later.some((value, index) => Math.hypot(value.x, value.y) !== Math.hypot(initial[index].x, initial[index].y))).toBe(true)
    expect(new Set(initial.map(({ z }) => z)).size).toBe(1)
  })
})
