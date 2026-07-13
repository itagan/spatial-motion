import { describe, expect, it, vi } from 'vitest'
import { Timeline } from './Timeline'

describe('Timeline', () => {
  it('stops the remaining sequence when a step reports cancellation', async () => {
    const finalStep = vi.fn()
    await new Timeline()
      .add(() => true)
      .add(() => false)
      .add(finalStep)
      .play()

    expect(finalStep).not.toHaveBeenCalled()
  })

  it('cancels a pending wait immediately and skips later steps', async () => {
    vi.useFakeTimers()
    const finalStep = vi.fn()
    const timeline = new Timeline().wait(10_000).add(finalStep)

    const playing = timeline.play()
    await Promise.resolve()
    timeline.cancel()
    await playing

    expect(finalStep).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
  })

  it('invalidates an earlier run when play is called again', async () => {
    vi.useFakeTimers()
    const finalStep = vi.fn()
    const timeline = new Timeline().wait(100).add(finalStep)

    const firstRun = timeline.play()
    await Promise.resolve()
    const secondRun = timeline.play()
    await vi.runAllTimersAsync()
    await Promise.all([firstRun, secondRun])

    expect(finalStep).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})
