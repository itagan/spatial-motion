// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StageRuntime } from './StageRuntime.js'

describe('StageRuntime', () => {
  let frame: FrameRequestCallback | null

  beforeEach(() => {
    frame = null
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      frame = callback
      return 1
    }))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('owns the frame loop and resets elapsed time across manual pauses', () => {
    const onFrame = vi.fn()
    const onResume = vi.fn()
    const runtime = createRuntime({ onFrame, onResume })

    runtime.start()
    expect(requestAnimationFrame).toHaveBeenCalledOnce()
    ;(frame as unknown as FrameRequestCallback)(100)
    expect(onFrame).toHaveBeenLastCalledWith(
      100,
      expect.any(Number),
      expect.any(Number),
    )

    runtime.pause()
    expect(runtime.isPaused()).toBe(true)
    expect(cancelAnimationFrame).toHaveBeenCalledOnce()
    runtime.resume()
    expect(runtime.isPaused()).toBe(false)
    expect(onResume).toHaveBeenCalledTimes(2)
    runtime.dispose()
  })

  it('pauses for visibility and resumes without bypassing a user pause', () => {
    const runtime = createRuntime()
    runtime.start()
    runtime.pause()
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    })
    document.dispatchEvent(new Event('visibilitychange'))
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })
    document.dispatchEvent(new Event('visibilitychange'))

    expect(runtime.isPaused()).toBe(true)
    runtime.resume()
    expect(runtime.isPaused()).toBe(false)
    runtime.dispose()
  })

  it('coordinates context loss, resource restoration, and cleanup', () => {
    const element = document.createElement('canvas')
    const onContextLost = vi.fn()
    const onContextRestored = vi.fn()
    const onContextChange = vi.fn()
    const runtime = createRuntime({
      element,
      onContextLost,
      onContextRestored,
      onContextChange,
    })
    runtime.start()

    const lost = new Event('webglcontextlost', { cancelable: true })
    element.dispatchEvent(lost)
    expect(lost.defaultPrevented).toBe(true)
    expect(runtime.isContextLost()).toBe(true)
    expect(onContextLost).toHaveBeenCalledOnce()
    element.dispatchEvent(new Event('webglcontextrestored'))
    expect(runtime.isContextLost()).toBe(false)
    expect(onContextRestored).toHaveBeenCalledOnce()
    expect(onContextChange.mock.calls.map(([state]) => state)).toEqual(['lost', 'restored'])

    runtime.dispose()
    element.dispatchEvent(new Event('webglcontextlost', { cancelable: true }))
    expect(onContextLost).toHaveBeenCalledOnce()
  })
})

function createRuntime(overrides: Partial<ConstructorParameters<typeof StageRuntime>[0]> = {}) {
  return new StageRuntime({
    element: document.createElement('canvas'),
    onFrame: vi.fn(),
    onPauseChange: vi.fn(),
    onResume: vi.fn(),
    onContextLost: vi.fn(),
    onContextRestored: vi.fn(),
    ...overrides,
  })
}
