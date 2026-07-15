import { describe, expect, it } from 'vitest'
import {
  box,
  calculateBoxFaceDistribution,
  calculateConeRingDistribution,
  calculateOrbitalRingDistribution,
  calculateRingCount,
  calculateRingDistribution,
  cone,
  cylinder,
  grid,
  helix,
  ring,
  scatter,
  sphere,
} from './index'

const context = { width: 1920, height: 1080 }

describe('layouts', () => {
  it.each([sphere(), cylinder(), grid(), ring(), helix(), cone(), box(), scatter()])('$name returns one finite transform per item', (layout) => {
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

  it('sphere gives the singular poles breathing room without changing ring density', () => {
    const result = sphere({ radius: 5, rings: 8 }).calculate(100, context)
    const northPole = result[0]
    const firstNonPolar = result.find(({ y }) => y < northPole.y)!

    expect(northPole.scale).toBeLessThan(firstNonPolar.scale)
    expect(result.at(-1)?.scale).toBeCloseTo(northPole.scale)
  })

  it('grid creates unique positions', () => {
    const result = grid({ columns: 10 }).calculate(100, context)
    expect(new Set(result.map(({ x, y }) => `${x},${y}`)).size).toBe(100)
  })

  it('grid contain stays inside the camera-visible world bounds', () => {
    const viewportContext = { width: 1600, height: 900, viewportWidth: 16, viewportHeight: 9 }
    const result = grid({ fit: 'contain' }).calculate(37, viewportContext)
    result.forEach(({ x, y, scale }) => {
      expect(Math.abs(x) + scale / 2).toBeLessThanOrEqual(8)
      expect(Math.abs(y) + scale / 2).toBeLessThanOrEqual(4.5)
    })
  })

  it('grid cover spans the complete camera-visible world bounds', () => {
    const viewportContext = { width: 1600, height: 900, viewportWidth: 16, viewportHeight: 9 }
    const result = grid({ fit: 'cover' }).calculate(37, viewportContext)
    const width = Math.max(...result.map(({ x, scale }) => x + scale / 2))
      - Math.min(...result.map(({ x, scale }) => x - scale / 2))
    const height = Math.max(...result.map(({ y, scale }) => y + scale / 2))
      - Math.min(...result.map(({ y, scale }) => y - scale / 2))
    expect(width >= 16 || height >= 9).toBe(true)
  })

  it.each(['fixed', 'contain', 'cover'] as const)('grid %s centers an incomplete final row', (fit) => {
    const result = grid({ columns: 4, fit }).calculate(10, {
      ...context,
      viewportWidth: 16,
      viewportHeight: 9,
    })
    expect(result[8].x).toBeCloseTo(-result[9].x)
  })

  it.each([sphere(), cylinder(), grid(), ring(), helix(), cone(), box(), scatter()])(
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

  it('cone reduces the apex card at the surface singularity', () => {
    const result = cone({ radius: 5, height: 9, rings: 10 }).calculate(100, context)
    expect(result[0].scale).toBeLessThan(result[1].scale)
  })

  it('cylinder closes incomplete rows and staggers adjacent seams', () => {
    const result = cylinder({ radius: 5, columns: 4 }).calculate(10, context)
    const finalRowAngles = result.slice(8).map(({ x, z }) => Math.atan2(x, z))
    expect(Math.abs(finalRowAngles[1] - finalRowAngles[0])).toBeCloseTo(Math.PI)
    expect(result[0].x).not.toBeCloseTo(result[4].x)
  })

  it('box distributes items by face area and keeps them on the six surfaces', () => {
    const dimensions = { width: 12, height: 8, depth: 4 }
    const distribution = calculateBoxFaceDistribution(600, dimensions.width, dimensions.height, dimensions.depth)
    const result = box(dimensions).calculate(600, context)

    expect(distribution).toHaveLength(6)
    expect(distribution.reduce((sum, value) => sum + value, 0)).toBe(600)
    expect(distribution[0]).toBe(distribution[1])
    expect(distribution[2]).toBe(distribution[3])
    expect(distribution[4]).toBe(distribution[5])
    expect(distribution[0]).toBeGreaterThan(distribution[2])
    result.forEach(({ x, y, z }) => {
      expect(
        Math.abs(Math.abs(x) - dimensions.width / 2) < 1e-8
        || Math.abs(Math.abs(y) - dimensions.height / 2) < 1e-8
        || Math.abs(Math.abs(z) - dimensions.depth / 2) < 1e-8,
      ).toBe(true)
    })
  })

  it('box uses unique finite transforms for small data and supports camera orientation', () => {
    const result = box({ width: 8, height: 6, depth: 4, orientation: 'camera' }).calculate(5, context)
    expect(result).toHaveLength(5)
    expect(new Set(result.map(({ x, y, z }) => `${x},${y},${z}`)).size).toBe(5)
    result.forEach((transform) => {
      expect(Object.values(transform).every(Number.isFinite)).toBe(true)
      expect([transform.rotationX, transform.rotationY, transform.rotationZ]).toEqual([0, 0, 0])
    })
  })

  it('box keeps card scale continuous across all occupied faces', () => {
    const result = box({ width: 12, height: 8, depth: 4 }).calculate(600, context)
    expect(new Set(result.map(({ scale }) => scale.toFixed(8))).size).toBe(1)
  })

  it('scatter is deterministic for the same seed and changes with another seed', () => {
    const options = { direction: 'radial' as const, distance: 12, depth: 5, seed: 42 }
    const first = scatter(options).calculate(500, context)
    const second = scatter(options).calculate(500, context)
    const changed = scatter({ ...options, seed: 43 }).calculate(500, context)

    expect(first).toEqual(second)
    expect(changed).not.toEqual(first)
    expect(new Set(first.map(({ x, y, z }) => `${x},${y},${z}`)).size).toBe(500)
  })

  it.each(['left', 'right'] as const)('scatter %s keeps every item on the requested side', (direction) => {
    const result = scatter({ direction, distance: 8, seed: 7 }).calculate(100, context)
    expect(result.every(({ x }) => direction === 'left' ? x < 0 : x > 0)).toBe(true)
  })

  it('scatter exposes spin through surface orientation and deterministic distance layers', () => {
    const layout = scatter({
      direction: 'radial',
      distance: 10,
      depth: 10,
      spinMode: 'directional',
      layers: 3,
      seed: 12,
    })
    const result = layout.calculate(30, context)
    const layerMeans = Array.from({ length: 3 }, (_, layerIndex) => {
      const radii = result
        .filter((_transform, index) => index % 3 === layerIndex)
        .map(({ x, y, z }) => Math.hypot(x, y, z))
      return radii.reduce((sum, radius) => sum + radius, 0) / radii.length
    })

    expect(layout.orientation).toBe('surface')
    expect(layerMeans[0]).toBeLessThan(layerMeans[1])
    expect(layerMeans[1]).toBeLessThan(layerMeans[2])
    expect(result.every(({ rotationZ }) => rotationZ > 0)).toBe(true)
  })

  it('directional left scatter rotates opposite to right scatter', () => {
    const left = scatter({ direction: 'left', spinMode: 'directional', seed: 9 }).calculate(20, context)
    const right = scatter({ direction: 'right', spinMode: 'directional', seed: 9 }).calculate(20, context)
    expect(left.every(({ rotationZ }) => rotationZ < 0)).toBe(true)
    expect(right.every(({ rotationZ }) => rotationZ > 0)).toBe(true)
  })

  it('scatter clamps visual values and handles invalid distances safely', () => {
    const result = scatter({ distance: -1, depth: -1, scale: -2, opacity: 5 }).calculate(3, context)
    result.forEach((transform) => {
      expect(Object.values(transform).every(Number.isFinite)).toBe(true)
      expect(transform.scale).toBe(0)
      expect(transform.opacity).toBe(1)
      expect(transform.z).toBeCloseTo(0)
    })
  })
})
