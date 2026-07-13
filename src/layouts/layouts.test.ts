import { describe, expect, it } from 'vitest'
import {
  calculateConeRingDistribution,
  calculateOrbitalRingDistribution,
  calculateRingCount,
  calculateRingDistribution,
  cone,
  cylinder,
  grid,
  helix,
  ring,
  sphere,
} from './index'

const context = { width: 1920, height: 1080 }

describe('layouts', () => {
  it.each([sphere(), cylinder(), grid(), ring(), helix(), cone()])('$name returns one finite transform per item', (layout) => {
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

  it.each([sphere(), cylinder(), grid(), ring(), helix(), cone()])(
    '$name handles empty and single-item data',
    (layout) => {
      expect(layout.calculate(0, context)).toEqual([])
      const single = layout.calculate(1, context)
      expect(single).toHaveLength(1)
      expect(Object.values(single[0]).every(Number.isFinite)).toBe(true)
    },
  )

  it('ring distributes every item across distinct concentric orbits', () => {
    const count = 600
    const rings = 12
    const distribution = calculateOrbitalRingDistribution(count, rings, 0.8, 0.42)
    const result = ring({ rings, innerRadius: 0.8, spacing: 0.42 }).calculate(count, context)
    const radii = new Set(result.map(({ x, y }) => Math.hypot(x, y).toFixed(6)))

    expect(distribution).toHaveLength(rings)
    expect(distribution.reduce((sum, value) => sum + value, 0)).toBe(count)
    expect(radii.size).toBe(rings)
  })

  it('ring tangent orientation follows the orbit', () => {
    const result = ring({ rings: 1, orientation: 'tangent', startAngle: 0 }).calculate(4, context)
    expect(result.map(({ rotationZ }) => rotationZ)).toEqual([
      Math.PI / 2,
      Math.PI,
      Math.PI * 1.5,
      Math.PI * 2,
    ])
  })

  it('helix spans the requested height and number of turns', () => {
    const result = helix({ radius: 3, height: 8, turns: 2, startAngle: 0 }).calculate(101, context)
    expect(result[0].y).toBeCloseTo(4)
    expect(result.at(-1)?.y).toBeCloseTo(-4)
    expect(result[0].x).toBeCloseTo(result.at(-1)?.x ?? Number.NaN)
    expect(result[0].z).toBeCloseTo(result.at(-1)?.z ?? Number.NaN)
    result.forEach(({ x, z }) => expect(Math.hypot(x, z)).toBeCloseTo(3, 5))
  })

  it('cone distributes items from one apex to the requested base radius', () => {
    const count = 600
    const rings = 20
    const distribution = calculateConeRingDistribution(count, rings)
    const result = cone({ radius: 5, height: 9, rings }).calculate(count, context)

    expect(distribution.reduce((sum, value) => sum + value, 0)).toBe(count)
    expect(distribution[0]).toBe(1)
    expect(Math.hypot(result[0].x, result[0].z)).toBeCloseTo(0)
    expect(Math.max(...result.map(({ x, z }) => Math.hypot(x, z)))).toBeCloseTo(5, 5)
  })
})
