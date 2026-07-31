import { describe, expect, it } from 'vitest'
import { ArrayAtlasUploadPolicy } from './CardAtlasUploadPolicy'

const BASE_BUDGET = 768 * 1024

describe('ArrayAtlasUploadPolicy', () => {
  it('ramps stable frames from the conservative budget to the bounded maximum', () => {
    const policy = new ArrayAtlasUploadPolicy()

    expect(policy.nextBudget(1 / 60, BASE_BUDGET)).toBe(BASE_BUDGET)
    expect(policy.nextBudget(1 / 60, BASE_BUDGET)).toBe(BASE_BUDGET * 2)
    expect(policy.nextBudget(1 / 60, BASE_BUDGET)).toBe(BASE_BUDGET * 2)
    expect(policy.nextBudget(1 / 60, BASE_BUDGET)).toBe(BASE_BUDGET * 4)
    expect(policy.nextBudget(1 / 120, BASE_BUDGET)).toBe(BASE_BUDGET * 4)
    expect(policy.snapshot()).toEqual({
      arrayUploadBudgetBytes: BASE_BUDGET * 4,
      arrayUploadPeakBudgetBytes: BASE_BUDGET * 4,
      arrayUploadBackoffs: 0,
    })
  })

  it('backs off under frame pressure and requires a stable cooldown before growing', () => {
    const policy = new ArrayAtlasUploadPolicy()
    for (let frame = 0; frame < 4; frame += 1) policy.nextBudget(1 / 60, BASE_BUDGET)

    expect(policy.nextBudget(0.025, BASE_BUDGET)).toBe(BASE_BUDGET * 2)
    expect(policy.nextBudget(0.034, BASE_BUDGET)).toBe(BASE_BUDGET)
    for (let frame = 0; frame < 6; frame += 1) {
      expect(policy.nextBudget(1 / 60, BASE_BUDGET)).toBe(BASE_BUDGET)
    }
    expect(policy.nextBudget(1 / 60, BASE_BUDGET)).toBe(BASE_BUDGET)
    expect(policy.nextBudget(1 / 60, BASE_BUDGET)).toBe(BASE_BUDGET * 2)
    expect(policy.snapshot().arrayUploadBackoffs).toBe(2)
  })

  it('ignores invalid timing samples and resets all adaptive state', () => {
    const policy = new ArrayAtlasUploadPolicy()

    expect(policy.nextBudget(0, BASE_BUDGET)).toBe(BASE_BUDGET)
    expect(policy.nextBudget(Number.NaN, BASE_BUDGET)).toBe(BASE_BUDGET)
    policy.nextBudget(1 / 60, BASE_BUDGET)
    policy.nextBudget(1 / 60, BASE_BUDGET)
    policy.reset()

    expect(policy.snapshot()).toEqual({
      arrayUploadBudgetBytes: 0,
      arrayUploadPeakBudgetBytes: 0,
      arrayUploadBackoffs: 0,
    })
    expect(policy.nextBudget(1 / 60, BASE_BUDGET)).toBe(BASE_BUDGET)
  })
})
