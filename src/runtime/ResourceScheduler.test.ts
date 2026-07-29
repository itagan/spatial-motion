import { describe, expect, it, vi } from 'vitest'
import { ResourceScheduler } from './ResourceScheduler.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

describe('ResourceScheduler', () => {
  it('runs independent channels concurrently and keeps the latest channel task', async () => {
    const scheduler = new ResourceScheduler()
    const gate = deferred<void>()
    const order: string[] = []
    const critical = scheduler.scheduleLatest('shared', {
      prepare: () => gate.promise,
      commit: () => order.push('critical'),
    })
    const background = scheduler.scheduleLatest('shared', {
      prepare: () => 'background',
      commit: (value) => order.push(value),
    })
    const parallel = scheduler.scheduleLatest('parallel', {
      prepare: () => 'parallel',
      commit: (value) => order.push(value),
    })

    gate.resolve()
    await Promise.all([critical, background, parallel])

    expect(order).toEqual(['background', 'parallel'])
    await expect(critical).resolves.toEqual({ status: 'superseded' })
    await expect(background).resolves.toEqual({
      status: 'committed',
      value: 1,
    })
    scheduler.dispose()
  })

  it('aborts the previous channel task and discards stale prepared data', async () => {
    const scheduler = new ResourceScheduler()
    const gate = deferred<string>()
    const discard = vi.fn()
    let signal: AbortSignal | null = null
    const stale = scheduler.scheduleLatest('atlas', {
      prepare(nextSignal) {
        signal = nextSignal
        return gate.promise
      },
      commit: vi.fn(),
      discard,
    })
    const latest = scheduler.scheduleLatest('atlas', {
      prepare: () => 'latest',
      commit: (value) => value,
    })
    gate.resolve('stale')

    await expect(stale).resolves.toEqual({ status: 'superseded' })
    await expect(latest).resolves.toEqual({ status: 'committed', value: 'latest' })
    expect((signal as AbortSignal | null)?.aborted).toBe(true)
    expect(discard).toHaveBeenCalledWith('stale')
    expect(scheduler.getStats()).toMatchObject({
      scheduled: 2,
      committed: 1,
      superseded: 1,
    })
  })

  it('isolates failures and cancels active work on dispose', async () => {
    const scheduler = new ResourceScheduler()
    await expect(scheduler.scheduleLatest('failure', {
      prepare: () => {
        throw new Error('prepare failed')
      },
      commit: vi.fn(),
    })).rejects.toThrow('prepare failed')
    const gate = deferred<void>()
    const pending = scheduler.scheduleLatest('pending', {
      prepare: () => gate.promise,
      commit: vi.fn(),
    })
    scheduler.dispose()
    gate.resolve()

    await expect(pending).resolves.toEqual({ status: 'aborted' })
    expect(scheduler.getStats()).toMatchObject({
      failures: 1,
      aborted: 1,
    })
  })

  it('allows a new task immediately after explicit cancellation', async () => {
    const scheduler = new ResourceScheduler()
    const gate = deferred<string>()
    const cancelled = scheduler.scheduleLatest('atlas', {
      prepare: () => gate.promise,
      commit: vi.fn(),
    })
    scheduler.cancel('atlas')
    const replacement = scheduler.scheduleLatest('atlas', {
      prepare: () => 'replacement',
      commit: (value) => value,
    })
    gate.resolve('cancelled')

    await expect(cancelled).resolves.toEqual({ status: 'aborted' })
    await expect(replacement).resolves.toEqual({
      status: 'committed',
      value: 'replacement',
    })
  })
})
