import { describe, expect, it } from 'vitest'
import { Euler, Quaternion, Vector3 } from 'three'
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

  it('sphere surface orientation keeps every card tangent to the sphere', () => {
    const result = sphere({ radius: 7, rings: 14, orientation: 'surface' }).calculate(240, context)
    const quaternion = new Quaternion()
    const normal = new Vector3()
    const cardUp = new Vector3()
    const surfaceUp = new Vector3()

    result.forEach((transform) => {
      quaternion.setFromEuler(new Euler(
        transform.rotationX,
        transform.rotationY,
        transform.rotationZ,
        'XYZ',
      ))
      normal.set(0, 0, 1).applyQuaternion(quaternion)
      const radial = new Vector3(transform.x, transform.y, transform.z).normalize()
      expect(normal.dot(radial)).toBeCloseTo(1, 6)

      if (Math.abs(radial.y) < 1 - 1e-8) {
        cardUp.set(0, 1, 0).applyQuaternion(quaternion)
        surfaceUp.set(0, 1, 0).addScaledVector(radial, -radial.y).normalize()
        expect(cardUp.dot(surfaceUp)).toBeCloseTo(1, 6)
      }
    })
  })

  it('sphere uses surface orientation by default while retaining upright mode', () => {
    const defaultTransforms = sphere({ radius: 5, rings: 7 }).calculate(60, context)
    const defaultTransform = defaultTransforms.find(
      ({ x, y, z }) => Math.abs(x) > 0.1 && Math.abs(y) > 0.1 && Math.abs(z) > 0.1,
    )!
    const defaultIndex = defaultTransforms.indexOf(defaultTransform)
    const uprightTransform = sphere({
      radius: 5,
      rings: 7,
      orientation: 'upright-surface',
    }).calculate(60, context)[defaultIndex]

    expect(defaultTransform.rotationX).not.toBe(0)
    expect(uprightTransform.rotationX).toBe(0)
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

  it('sphere limits latitude bands and can exclude exact poles', () => {
    const result = sphere({
      radius: 5,
      rings: 9,
      minLatitude: -Math.PI / 4,
      maxLatitude: Math.PI / 3,
      poleMode: 'exclude',
    }).calculate(120, context)
    const latitudes = result.map(({ y }) => Math.asin(y / 5))

    expect(Math.min(...latitudes)).toBeGreaterThanOrEqual(-Math.PI / 4 - 1e-8)
    expect(Math.max(...latitudes)).toBeLessThanOrEqual(Math.PI / 3 + 1e-8)
    expect(result.every(({ y }) => Math.abs(y) < 5)).toBe(true)
  })

  it('sphere fibonacci mode is deterministic, equal-area, and avoids exact poles', () => {
    const layout = sphere({ distribution: 'fibonacci', radius: 6 })
    const first = layout.calculate(500, context)
    const second = layout.calculate(500, context)
    const normalizedY = first.map(({ y }) => y / 6)
    const steps = normalizedY.slice(1).map((value, index) => normalizedY[index] - value)

    expect(first).toEqual(second)
    expect(Math.max(...normalizedY)).toBeLessThan(1)
    expect(Math.min(...normalizedY)).toBeGreaterThan(-1)
    expect(Math.max(...steps) - Math.min(...steps)).toBeLessThan(1e-10)
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

  it('ring supports equal allocation, explicit staggering, and clockwise ordering', () => {
    const distribution = calculateOrbitalRingDistribution(20, 4, 1, 1, 'equal')
    const counterclockwise = ring({ rings: 1, startAngle: 0, stagger: false }).calculate(4, context)
    const clockwise = ring({ rings: 1, startAngle: 0, stagger: false, clockwise: true }).calculate(4, context)

    expect(distribution).toEqual([5, 5, 5, 5])
    expect(Math.atan2(counterclockwise[1].y, counterclockwise[1].x)).toBeCloseTo(Math.PI / 2)
    expect(Math.atan2(clockwise[1].y, clockwise[1].x)).toBeCloseTo(-Math.PI / 2)
    expect(ring({ rings: 2, stagger: false }).calculate(20, context)[1].rotationZ).toBe(0)
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

  it('cone supports frustums and the equal-radius cylinder limit', () => {
    const frustum = cone({ radius: 5, topRadius: 2, height: 8, rings: 8 }).calculate(160, context)
    const radii = frustum.map(({ x, z }) => Math.hypot(x, z))
    const cylinderLimit = cone({ radius: 4, topRadius: 4, height: 8, rings: 6, orientation: 'surface' })
      .calculate(120, context)

    expect(Math.min(...radii)).toBeCloseTo(2, 5)
    expect(Math.max(...radii)).toBeCloseTo(5, 5)
    expect(cylinderLimit.every(({ x, z }) => Math.hypot(x, z).toFixed(6) === '4.000000')).toBe(true)
    expect(cylinderLimit.every(({ rotationX }) => rotationX === 0)).toBe(true)
  })

  it('cylinder closes incomplete rows and staggers adjacent seams', () => {
    const result = cylinder({ radius: 5, columns: 4 }).calculate(10, context)
    const finalRowAngles = result.slice(8).map(({ x, z }) => Math.atan2(x, z))
    expect(Math.abs(finalRowAngles[1] - finalRowAngles[0])).toBeCloseTo(Math.PI)
    expect(result[0].x).not.toBeCloseTo(result[4].x)
  })

  it('cylinder supports bounded arcs, explicit rows, density, and camera orientation', () => {
    const result = cylinder({
      radius: 5,
      rows: 3,
      startAngle: -Math.PI / 2,
      arcAngle: Math.PI,
      density: 0.5,
      orientation: 'camera',
    }).calculate(10, context)
    const yLevels = new Set(result.map(({ y }) => y.toFixed(6)))
    const firstRow = result.slice(0, 4)

    expect(yLevels.size).toBe(3)
    expect(Math.atan2(firstRow[0].x, firstRow[0].z)).toBeCloseTo(-Math.PI / 2)
    expect(Math.atan2(firstRow.at(-1)!.x, firstRow.at(-1)!.z)).toBeCloseTo(Math.PI / 2)
    expect(result.every(({ rotationY }) => rotationY === 0)).toBe(true)
    expect(result.every(({ scale }) => scale <= 0.5)).toBe(true)
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

  it('box supports face selection, edge padding, and weighted allocation', () => {
    const distribution = calculateBoxFaceDistribution(
      120,
      10,
      8,
      6,
      ['front', 'right'],
      { front: 1, right: 3 },
    )
    const result = box({
      width: 10,
      height: 8,
      depth: 6,
      faces: ['front'],
      edgePadding: 1,
    }).calculate(100, context)

    expect(distribution[0]).toBeGreaterThan(0)
    expect(distribution[2]).toBeGreaterThan(distribution[0])
    expect(distribution[1] + distribution[3] + distribution[4] + distribution[5]).toBe(0)
    expect(result.every(({ z }) => z === 3)).toBe(true)
    expect(Math.max(...result.map(({ x }) => Math.abs(x)))).toBeLessThan(5)
    expect(Math.max(...result.map(({ y }) => Math.abs(y)))).toBeLessThan(4)
  })

  it('modified layouts normalize invalid direct options to finite transforms', () => {
    const invalid = Number.NaN
    const layouts = [
      sphere({ radius: invalid, rings: invalid, density: invalid }),
      cylinder({ radius: invalid, rows: invalid, arcAngle: invalid, density: invalid }),
      ring({ innerRadius: invalid, spacing: invalid, rings: invalid, density: invalid }),
      box({ width: invalid, edgePadding: invalid, density: invalid, faces: [] }),
      cone({ radius: invalid, topRadius: invalid, height: invalid, rings: invalid, density: invalid }),
    ]
    layouts.forEach((layout) => {
      const result = layout.calculate(50, context)
      expect(result).toHaveLength(50)
      expect(result.every((transform) => Object.values(transform).every(Number.isFinite))).toBe(true)
    })
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
