import { describe, expect, it, vi } from 'vitest'
import { ItemCoordinator } from './ItemCoordinator.js'

describe('ItemCoordinator', () => {
  it('validates stable ids and prepares an owned visible subset', () => {
    const coordinator = createCoordinator()
    const items = [
      { id: 'a', meta: { score: 1 } },
      { id: 'b', meta: { score: 2 } },
    ]

    coordinator.validateItems(items)
    const prepared = coordinator.prepareItems(items, 1)

    expect(prepared.visibleItems.map((item) => item.id)).toEqual(['a'])
    expect(prepared.sourceItems).not.toBe(items)
    expect(prepared.sourceItems[0]).not.toBe(items[0])
    expect(() => coordinator.validateItems([{ id: 'a' }, { id: 'a' }])).toThrow(
      'Duplicate MotionItem id: a',
    )
    expect(() => coordinator.validateItems([{ id: '' }])).toThrow(
      'MotionItem at index 0 must have a non-empty id',
    )
  })

  it('prepares stable-id patches and visible changed indices', () => {
    const coordinator = createCoordinator()
    const prepared = coordinator.preparePatch(
      [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }],
      [{ id: 'b', patch: { title: 'Updated' } }],
      2,
    )

    expect(prepared.sourceItems[1]).toEqual({ id: 'b', title: 'Updated' })
    expect(prepared.changedIndices).toEqual([1])
    expect(() => coordinator.preparePatch(
      [{ id: 'a' }],
      [{ id: 'missing', patch: { title: 'Missing' } }],
      1,
    )).toThrow('Unknown MotionItem id: missing')
  })

  it('merges same-turn patches and serializes their application', async () => {
    const applyPatches = vi.fn(async () => true)
    const coordinator = createCoordinator(applyPatches)

    const first = coordinator.queuePatches([{ id: 'a', patch: { title: 'First' } }])
    const second = coordinator.queuePatches([
      { id: 'a', patch: { image: '/a.png' } },
      { id: 'b', patch: { title: 'Second' } },
    ])

    await expect(first).resolves.toBe(true)
    await expect(second).resolves.toBe(true)
    expect(applyPatches).toHaveBeenCalledOnce()
    expect(applyPatches).toHaveBeenCalledWith([
      { id: 'a', patch: { title: 'First', image: '/a.png' } },
      { id: 'b', patch: { title: 'Second' } },
    ])
  })

  it('invalidates outdated asynchronous operations', () => {
    const coordinator = createCoordinator()
    const first = coordinator.beginOperation()
    const second = coordinator.beginOperation()

    expect(coordinator.isCurrent(first)).toBe(false)
    expect(coordinator.isCurrent(second)).toBe(true)
    coordinator.invalidate()
    expect(coordinator.isCurrent(second)).toBe(false)
  })
})

function createCoordinator(
  applyPatches = vi.fn(async () => true),
): ItemCoordinator<{ score?: number }> {
  return new ItemCoordinator({
    applyPatches,
    isDestroyed: () => false,
  })
}
