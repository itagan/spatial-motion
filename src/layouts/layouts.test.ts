import { describe, expect, it } from 'vitest'
import { calculateRingCount, calculateRingDistribution, cylinder, grid, sphere } from './index'

const context = { width: 1920, height: 1080 }

describe('layouts', () => {
  it.each([sphere(), cylinder(), grid()])('$name returns one finite transform per item', (layout) => {
    const result = layout.calculate(500, context)
    expect(result).toHaveLength(500)
    expect(result.every((value) => Object.values(value).every(Number.isFinite))).toBe(true)
  })

  it('sphere keeps every item on the requested radius', () => {
    const radius = 7
    const result = sphere({ radius }).calculate(100, context)
    result.forEach(({ x, y, z }) => {
      expect(Math.hypot(x, y, z)).toBeCloseTo(radius, 5)
    })
  })

  it('sphere arranges items into explicit latitude rings', () => {
    const count = 600
    const rings = calculateRingCount(count)
    const distribution = calculateRingDistribution(count, rings)
    const result = sphere({ rings }).calculate(count, context)
    const latitudeLevels = new Set(result.map(({ y }) => y.toFixed(6)))

    expect(distribution.reduce((sum, value) => sum + value, 0)).toBe(count)
    expect(latitudeLevels.size).toBe(rings)
    expect(distribution[0]).toBe(1)
    expect(distribution[distribution.length - 1]).toBe(1)
  })

  it('grid creates unique positions', () => {
    const result = grid({ columns: 10 }).calculate(100, context)
    expect(new Set(result.map(({ x, y }) => `${x},${y}`)).size).toBe(100)
  })
})
