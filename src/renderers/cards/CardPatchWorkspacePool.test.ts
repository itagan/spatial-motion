import { describe, expect, it } from 'vitest'
import { CardPatchWorkspacePool } from './CardPatchWorkspacePool'

describe('CardPatchWorkspacePool', () => {
  it('reuses cleared workspaces', () => {
    const pool = new CardPatchWorkspacePool()
    const first = pool.acquire()
    first.indices.push(1)
    first.fingerprints.push('one')
    pool.release(first)
    expect(first.indices).toEqual([1])

    const second = pool.acquire()
    expect(second).toBe(first)
    expect(second.indices).toEqual([])
    expect(second.fingerprints).toEqual([])
    expect(pool.getStats()).toEqual({ allocations: 1, reuses: 1, available: 0 })
  })

  it('bounds retained workspaces and clears them on dispose', () => {
    const pool = new CardPatchWorkspacePool()
    const leases = Array.from({ length: 6 }, () => pool.acquire())
    leases.forEach((lease) => pool.release(lease))
    expect(pool.getStats().available).toBe(4)

    pool.dispose()
    expect(pool.getStats().available).toBe(0)
    expect(() => pool.acquire()).toThrow('disposed')
  })

  it('normalizes valid unique indices directly into a lease', () => {
    const pool = new CardPatchWorkspacePool()
    expect(pool.acquire([3, 1, 3, -1, 4, 2.5], 4).indices).toEqual([1, 3])
  })
})
