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
})
