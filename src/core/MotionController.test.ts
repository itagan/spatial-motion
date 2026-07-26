import { describe, expect, it, vi } from 'vitest'
import { MotionController } from './MotionController.js'
import type { Layout, Transform } from './types.js'

const layout: Layout = {
  name: 'target',
  calculate: () => [],
}
const visual = {
  billboard: 0,
  hideBackHemisphere: 0,
  hemisphereEdgeFade: 0,
}

describe('MotionController', () => {
  it('interpolates, advances, and completes a transition', async () => {
    const motion = new MotionController()
    const finished = motion.start({
      from: [transform({ x: 0 })],
      to: [transform({ x: 10 })],
      fromVisual: visual,
      toVisual: { ...visual, billboard: 1 },
      targetLayout: layout,
      duration: 100,
      easing: (value) => value,
      now: 0,
    })

    expect(motion.resolveTransforms([], 50, false)[0].x).toBe(5)
    expect(motion.resolveVisualState(visual, 50, false).billboard).toBe(0.5)
    expect(motion.advance(50, vi.fn())).toBeNull()
    expect(motion.advance(100, vi.fn())?.[0].x).toBe(10)
    await expect(finished).resolves.toEqual({ completed: true, status: 'completed' })
  })

  it('freezes pending progress while paused and rebases on resume', () => {
    const motion = new MotionController()
    void motion.start({
      from: [transform({ x: 0 })],
      to: [transform({ x: 10 })],
      fromVisual: visual,
      toVisual: visual,
      targetLayout: layout,
      duration: 100,
      easing: (value) => value,
      now: 0,
    })

    motion.advance(20, vi.fn())
    expect(motion.getState(80, true).progress).toBe(0.2)
    motion.rebaseClock(80)
    expect(motion.getState(90, false).progress).toBe(0.3)
  })

  it('settles interruptions and abort signals deterministically', async () => {
    const motion = new MotionController()
    const controller = new AbortController()
    const finished = motion.start({
      from: [transform()],
      to: [transform({ x: 1 })],
      fromVisual: visual,
      toVisual: visual,
      targetLayout: layout,
      duration: 100,
      easing: (value) => value,
      now: 0,
      signal: controller.signal,
    })

    controller.abort()
    await expect(finished).resolves.toEqual({ completed: false, status: 'aborted' })
    expect(motion.getState(0, false)).toMatchObject({
      active: false,
      status: 'aborted',
      layout: 'target',
    })
  })

  it('records immediate completion without creating active state', () => {
    const motion = new MotionController()
    expect(motion.settle('instant', 'completed')).toEqual({ completed: true, status: 'completed' })
    expect(motion.hasActiveTransition()).toBe(false)
    expect(motion.getState(0, false)).toMatchObject({
      active: false,
      status: 'completed',
      layout: 'instant',
      progress: 1,
    })
  })
})

function transform(overrides: Partial<Transform> = {}): Transform {
  return {
    x: 0,
    y: 0,
    z: 0,
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,
    scale: 1,
    opacity: 1,
    ...overrides,
  }
}
