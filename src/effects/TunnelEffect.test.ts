import { describe, expect, it } from 'vitest'
import { tunnel } from './TunnelEffect'
import { calculateEffectTransforms } from './transforms.test-helper'

describe('TunnelEffect', () => {
  it('keeps a fixed deterministic path buffer for the instance pool', () => {
    const effect = tunnel({ seed: 42 })
    effect.prepare(600)
    const first = effect.getGpuData()
    effect.prepare(600)
    const second = effect.getGpuData()

    expect(first.payload.paths).toBe(second.payload.paths)
    expect(first.kind).toBe('tunnel')
    expect(first.payload.paths).toHaveLength(2400)
    expect(first.payload.speedFactors).toHaveLength(600)
  })

  it('cycles finite transforms between the far and near planes', () => {
    const effect = tunnel({ farZ: -20, nearZ: 10, seed: 7 })
    const initial = calculateEffectTransforms(effect, 500, 0)
    const later = calculateEffectTransforms(effect, 500, 1)

    expect(initial).toHaveLength(500)
    expect(initial.every((value) => Object.values(value).every(Number.isFinite))).toBe(true)
    expect(initial.every(({ z }) => z >= -20 && z <= 10)).toBe(true)
    expect(later.some((value, index) => value.z !== initial[index].z)).toBe(true)
  })

  it('keeps excess pool entries dormant without reallocating the pool', () => {
    const effect = tunnel({ maxActiveItems: 120 })
    const transforms = calculateEffectTransforms(effect, 600, 0)
    const gpuData = effect.getGpuData()

    expect(transforms.filter(({ opacity }) => opacity > 0).length).toBeLessThanOrEqual(120)
    expect(Array.from(gpuData.payload.speedFactors).filter((speed) => speed >= 0)).toHaveLength(120)
  })

  it('honors the runtime quality cap below its configured pool limit', () => {
    const effect = tunnel({ maxActiveItems: 300 })
    effect.prepare(600, 140)

    expect(Array.from(effect.getGpuData().payload.speedFactors).filter((speed) => speed >= 0)).toHaveLength(140)
  })

  it('supports deterministic square cross sections', () => {
    const effect = tunnel({ crossSection: 'square', twist: 0, seed: 5 })
    const transforms = calculateEffectTransforms(effect, 120, 0.5)
      .filter(({ opacity }) => opacity > 0)
    transforms.forEach(({ x, y }) => {
      expect(Math.max(Math.abs(x), Math.abs(y))).toBeGreaterThan(0)
    })
    expect(new Set(effect.getGpuData().payload.paths.filter((_, index) => index % 4 === 3))).toEqual(new Set([1]))
  })

  it('applies burst and wave emission envelopes to CPU transforms and GPU parameters', () => {
    const burst = tunnel({ emission: { mode: 'burst', burstInterval: 2, burstDuration: 0.4 } })
    const active = calculateEffectTransforms(burst, 80, 0.1)
    const dormant = calculateEffectTransforms(burst, 80, 1)
    expect(active.some(({ opacity }) => opacity > 0)).toBe(true)
    expect(dormant.every(({ opacity }) => opacity === 0)).toBe(true)
    const parameters = Array.from(burst.getGpuData().payload.parameters.slice(7))
    ;[1, 2, 0.4, 0.35, 0.75].forEach((value, index) => {
      expect(parameters[index]).toBeCloseTo(value)
    })

    const wave = tunnel({ emission: { mode: 'wave', waveFrequency: 0.5, waveStrength: 1 } })
    expect(calculateEffectTransforms(wave, 80, 1.5).every(({ opacity }) => opacity === 0)).toBe(true)
    expect(calculateEffectTransforms(wave, 80, 0.5).some(({ opacity }) => opacity > 0)).toBe(true)
  })
})
