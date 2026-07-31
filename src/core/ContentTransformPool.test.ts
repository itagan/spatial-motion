import { describe, expect, it } from 'vitest'
import { ContentTransformPool } from './ContentTransformPool'

describe('ContentTransformPool', () => {
  it('reuses Buffer objects and retains grown capacity', () => {
    const pool = new ContentTransformPool()
    const first = pool.acquire(1)
    pool.release(first)

    const grown = pool.acquire(5)
    expect(grown).toBe(first)
    expect(grown.positions.length).toBe(24)
    pool.release(grown)
    const shrunk = pool.acquire(1)

    expect(shrunk).toBe(first)
    expect(shrunk.positions.length).toBe(24)
    expect(pool.getStats()).toEqual({ allocations: 1, reuses: 2, available: 0 })
  })

  it('bounds retained idle Buffers after concurrent work', () => {
    const pool = new ContentTransformPool()
    const buffers = Array.from({ length: 6 }, () => pool.acquire(1))
    buffers.forEach((buffer) => pool.release(buffer))

    expect(pool.getStats()).toEqual({ allocations: 6, reuses: 0, available: 4 })
    const reused = Array.from({ length: 4 }, () => pool.acquire(1))
    expect(new Set(reused).size).toBe(4)
    expect(pool.getStats()).toEqual({ allocations: 6, reuses: 4, available: 0 })
  })

  it('drops retained Buffers and rejects new leases after dispose', () => {
    const pool = new ContentTransformPool()
    const buffer = pool.acquire(1)
    pool.release(buffer)
    pool.dispose()
    pool.release(buffer)

    expect(pool.getStats().available).toBe(0)
    expect(() => pool.acquire(1)).toThrow('disposed')
  })
})
