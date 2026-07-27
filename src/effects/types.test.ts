import { describe, expect, it } from 'vitest'
import { linearShooter } from './LinearShooterEffect'
import { radialBurst } from './RadialBurstEffect'
import { tunnel } from './TunnelEffect'
import { vortex } from './VortexEffect'
import {
  effectEdgeFade,
  effectTravel,
  emissionEnvelope,
  resolveEmissionOptions,
  stableEffectPhase,
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

  it('uses a stable low-discrepancy phase for active-pool prefixes', () => {
    const phases = Array.from({ length: 200 }, (_, index) => stableEffectPhase(index, 42))
    expect(phases).toEqual(Array.from({ length: 200 }, (_, index) => stableEffectPhase(index, 42)))
    expect(new Set(phases.map((phase) => phase.toFixed(8))).size).toBe(200)
    const buckets = Array.from({ length: 10 }, (_, bucket) =>
      phases.filter((phase) => phase >= bucket / 10 && phase < (bucket + 1) / 10).length,
    )
    expect(Math.max(...buckets) - Math.min(...buckets)).toBeLessThanOrEqual(4)
  })

  it.each([
    tunnel({ seed: 12, maxActiveItems: 100 }),
    linearShooter({ seed: 12, maxActiveItems: 100 }),
    vortex({ seed: 12, maxActiveItems: 100 }),
    radialBurst({ seed: 12, maxActiveItems: 100 }),
  ])('$name preserves active trajectories when the quality cap changes', (effect) => {
    effect.prepare(100, 30)
    const paths = Array.from(effect.getGpuData().payload.paths.slice(0, 30 * 4))
    const speeds = Array.from(effect.getGpuData().payload.speedFactors.slice(0, 30))
    effect.prepare(100, 60)
    expect(Array.from(effect.getGpuData().payload.paths.slice(0, 30 * 4))).toEqual(paths)
    expect(Array.from(effect.getGpuData().payload.speedFactors.slice(0, 30))).toEqual(speeds)
  })
})
