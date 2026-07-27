import { describe, expect, it } from 'vitest'
import { radialBurst } from './RadialBurstEffect'

describe('RadialBurstEffect', () => {
  it('creates deterministic 3D rays without exceeding the active pool cap', () => {
    const effect = radialBurst({ maxActiveItems: 200, seed: 77 })
    effect.prepare(500, 120)
    const data = effect.getGpuData()

    expect(data.kind).toBe('radial-burst')
    expect(data.payload.paths).toHaveLength(2000)
    expect(data.payload.speedFactors).toHaveLength(500)
    expect(Array.from(data.payload.speedFactors).filter((speed) => speed >= 0)).toHaveLength(120)
  })

  it('moves active cards along finite radial paths with depth variation', () => {
    const effect = radialBurst({ outerRadius: 8, depthScale: 0.4, maxActiveItems: 90 })
    const initial = effect.calculateTransforms(300, 0)
    const later = effect.calculateTransforms(300, 0.4)

    expect(initial).toHaveLength(300)
    expect(initial.every((value) => Object.values(value).every(Number.isFinite))).toBe(true)
    expect(new Set(initial.slice(0, 90).map(({ z }) => z.toFixed(4))).size).toBeGreaterThan(1)
    expect(later.some((value, index) => value.x !== initial[index].x || value.y !== initial[index].y)).toBe(true)
    expect(initial.slice(90).every(({ opacity }) => opacity === 0)).toBe(true)
  })

  it('reverses travel for aggregation without rebuilding the data pool', () => {
    const inward = radialBurst({ direction: 'in', seed: 9 }).calculateTransforms(30, 0)
    const outward = radialBurst({ direction: 'out', seed: 9 }).calculateTransforms(30, 0)
    const radius = (value: (typeof inward)[number]) => Math.hypot(value.x, value.y)

    expect(radius(inward[0])).toBeGreaterThan(radius(outward[0]))
  })
})
