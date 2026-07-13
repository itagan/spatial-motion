import { describe, expect, it } from 'vitest'
import { vortex } from './VortexEffect'

describe('VortexEffect', () => {
  it('builds deterministic paths in a quality-capped fixed pool', () => {
    const effect = vortex({ maxActiveItems: 260, seed: 31 })
    effect.prepare(600, 140)
    const first = effect.getGpuData()
    effect.prepare(600, 140)
    const second = effect.getGpuData()

    expect(first.kind).toBe('vortex')
    expect(first.paths).toBe(second.paths)
    expect(first.paths).toHaveLength(2400)
    expect(Array.from(first.speedFactors).filter((speed) => speed >= 0)).toHaveLength(140)
  })

  it('spirals finite transforms between the configured inner and outer bounds', () => {
    const effect = vortex({ innerRadius: 0.2, outerRadius: 6, farZ: -9, nearZ: 4, seed: 5 })
    const initial = effect.calculateTransforms(180, 0)
    const later = effect.calculateTransforms(180, 0.5)

    expect(initial).toHaveLength(180)
    expect(initial.every((value) => Object.values(value).every(Number.isFinite))).toBe(true)
    expect(initial.every(({ x, y }) => Math.hypot(x, y) >= 0.2 && Math.hypot(x, y) <= 6)).toBe(true)
    expect(initial.every(({ z }) => z >= -9 && z <= 4)).toBe(true)
    expect(later.some((value, index) => value.x !== initial[index].x || value.y !== initial[index].y)).toBe(true)
  })

  it('supports complementary inward and outward travel', () => {
    const inward = vortex({ direction: 'in', seed: 19 }).calculateTransforms(20, 0)
    const outward = vortex({ direction: 'out', seed: 19 }).calculateTransforms(20, 0)

    expect(Math.hypot(inward[0].x, inward[0].y)).toBeGreaterThan(
      Math.hypot(outward[0].x, outward[0].y),
    )
  })
})
