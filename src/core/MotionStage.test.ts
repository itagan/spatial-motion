// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Layout, MotionItem, Transform } from './types'
import { MotionStage } from './MotionStage'
import { TunnelEffect } from '../effects/TunnelEffect'

const stageMocks = vi.hoisted(() => ({
  cards: [] as Array<Record<string, ReturnType<typeof vi.fn>>>,
  webglRenderers: [] as Array<Record<string, unknown>>,
}))

vi.mock('../renderers/InstancedCardRenderer', () => ({
  InstancedCardRenderer: class MockInstancedCardRenderer {
    setItems = vi.fn(async () => true)
    setTransforms = vi.fn()
    prepareTransition = vi.fn()
    setProgress = vi.fn()
    setGroupRotation = vi.fn()
    setOrientation = vi.fn()
    setHideBackHemisphere = vi.fn()
    enableTunnel = vi.fn()
    enableLinearShooter = vi.fn()
    disableEffect = vi.fn()
    setEffectTime = vi.fn()
    setVisibleRatio = vi.fn()
    getStats = vi.fn(() => ({ instanceCount: 0, textureBytes: 0 }))
    dispose = vi.fn()

    constructor() {
      stageMocks.cards.push(this as unknown as Record<string, ReturnType<typeof vi.fn>>)
    }
  },
}))

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>()
  class MockWebGLRenderer {
    domElement = document.createElement('canvas')
    setPixelRatio = vi.fn()
    setSize = vi.fn()
    render = vi.fn()
    dispose = vi.fn()
    getPixelRatio = vi.fn(() => 1.5)
    info = { render: { calls: 1, triangles: 2 } }

    constructor() {
      this.domElement.getBoundingClientRect = () => ({
        bottom: 100,
        height: 100,
        left: 0,
        right: 100,
        top: 0,
        width: 100,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      })
      stageMocks.webglRenderers.push(this as unknown as Record<string, unknown>)
    }
  }
  return { ...actual, WebGLRenderer: MockWebGLRenderer }
})

class MockResizeObserver {
  observe = vi.fn()
  disconnect = vi.fn()
  unobserve = vi.fn()
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

function transform(overrides: Partial<Transform> = {}): Transform {
  return {
    x: 0,
    y: 0,
    z: 0,
    scale: 1,
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,
    opacity: 1,
    ...overrides,
  }
}

function layout(calculate: (count: number) => Transform[], name = 'test'): Layout {
  return { name, orientation: 'camera', calculate }
}

function createStage(options: Partial<ConstructorParameters<typeof MotionStage>[0]> = {}) {
  const container = document.createElement('div')
  Object.defineProperties(container, {
    clientHeight: { value: 100 },
    clientWidth: { value: 100 },
  })
  document.body.appendChild(container)
  return new MotionStage({ container, quality: 'high', adaptivePerformance: false, ...options })
}

function currentCards() {
  const cards = stageMocks.cards.at(-1)
  if (!cards) throw new Error('Card renderer mock was not created')
  return cards
}

describe('MotionStage', () => {
  beforeEach(() => {
    stageMocks.cards.length = 0
    stageMocks.webglRenderers.length = 0
    vi.stubGlobal('ResizeObserver', MockResizeObserver)
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  afterEach(() => {
    document.body.replaceChildren()
    vi.unstubAllGlobals()
  })

  it('validates every item before changing renderer state', () => {
    const stage = createStage()
    const cards = currentCards()

    expect(() => stage.setItems([{ id: ' ' }])).toThrow('non-empty id')
    expect(() => stage.updateItems([{ id: 'same' }, { id: 'same' }])).toThrow(
      'Duplicate MotionItem id: same',
    )
    expect(cards.setItems).not.toHaveBeenCalled()
    stage.destroy()
  })

  it('accepts empty data and applies the quality item cap', async () => {
    const stage = createStage({ quality: 'low' })
    const cards = currentCards()
    await stage.setItems([])
    const items = Array.from({ length: 520 }, (_, index) => ({ id: `item-${index}` }))
    await stage.setItems(items)

    expect(cards.setItems).toHaveBeenNthCalledWith(1, [])
    expect((cards.setItems.mock.calls[1][0] as MotionItem[])).toHaveLength(500)
    stage.destroy()
  })

  it('reports render metrics and supports manual quality locking', async () => {
    const stage = createStage({ quality: 'low' })
    const cards = currentCards()
    cards.getStats.mockReturnValue({ instanceCount: 500, textureBytes: 1_048_576 })
    await stage.setItems(Array.from({ length: 520 }, (_, index) => ({ id: `item-${index}` })))

    expect(stage.getQualityMode()).toBe('low')
    expect(stage.getPerformanceStats()).toMatchObject({
      quality: 'low',
      qualityMode: 'low',
      inputItems: 520,
      renderedItems: 500,
      drawCalls: 1,
      triangles: 2,
      textureBytes: 1_048_576,
      pixelRatio: 1.5,
      paused: false,
    })

    stage.setQuality('high')
    expect(stage.getQuality()).toBe('high')
    expect(stage.getQualityMode()).toBe('high')
    expect(cards.setVisibleRatio).toHaveBeenLastCalledWith(1)
    stage.setQuality('auto')
    expect(stage.getQualityMode()).toBe('auto')
    stage.destroy()
  })

  it('pauses manually and while the document is hidden', () => {
    let visibility: DocumentVisibilityState = 'visible'
    const visibilitySpy = vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
    const stage = createStage()
    const requestFrame = vi.mocked(requestAnimationFrame)
    const cancelFrame = vi.mocked(cancelAnimationFrame)

    stage.pause()
    expect(cancelFrame).toHaveBeenCalled()
    expect(stage.getPerformanceStats().paused).toBe(true)
    stage.resume()
    expect(requestFrame).toHaveBeenCalledTimes(2)

    visibility = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
    expect(stage.getPerformanceStats().paused).toBe(true)
    visibility = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
    expect(stage.getPerformanceStats().paused).toBe(false)

    stage.destroy()
    visibilitySpy.mockRestore()
  })

  it('allows only the newest concurrent item update to mutate stage transforms', async () => {
    const stage = createStage()
    const cards = currentCards()
    const first = deferred<boolean>()
    const second = deferred<boolean>()
    cards.setItems.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    const firstUpdate = stage.setItems([{ id: 'old' }])
    const secondUpdate = stage.setItems([{ id: 'new-1' }, { id: 'new-2' }])
    second.resolve(true)
    await secondUpdate
    first.resolve(true)
    await firstUpdate

    expect(cards.setTransforms).toHaveBeenCalledTimes(1)
    expect(cards.setTransforms.mock.calls[0][0]).toHaveLength(2)
    stage.destroy()
  })

  it('inherits current transforms by stable id when items are reordered', async () => {
    const stage = createStage()
    const cards = currentCards()
    await stage.setItems([{ id: 'a' }, { id: 'b' }])
    const baseLayout = layout((count) =>
      Array.from({ length: count }, (_, index) => transform({ x: 10 + index })),
    )
    await stage.to(baseLayout, { duration: 0 })
    cards.setTransforms.mockClear()

    await stage.updateItems([{ id: 'b' }, { id: 'a' }, { id: 'c' }], { duration: 0 })
    const inherited = cards.setTransforms.mock.calls[1][0] as Transform[]

    expect(inherited.map(({ x, scale }) => ({ x, scale }))).toEqual([
      { x: 11, scale: 1 },
      { x: 10, scale: 1 },
      { x: 0, scale: 0.01 },
    ])
    stage.destroy()
  })

  it('focuses matching ids and restores the last business layout', async () => {
    const stage = createStage()
    const cards = currentCards()
    await stage.setItems([{ id: 'a' }, { id: 'b' }])
    const baseLayout = layout((count) =>
      Array.from({ length: count }, (_, index) => transform({ x: index - 0.5 })),
      'base',
    )
    await stage.to(baseLayout, { duration: 0 })

    expect(await stage.focusItems(['missing'], { duration: 0 })).toBe(false)
    expect(await stage.focusItems(['b'], { duration: 0 })).toBe(true)
    const focused = cards.setTransforms.mock.calls.at(-1)?.[0] as Transform[]
    expect(focused[0].opacity).toBe(0.08)
    expect(focused[1]).toMatchObject({ x: 0, y: 0, z: 8, scale: 1.45, opacity: 1 })

    expect(await stage.restoreLayout({ duration: 0 })).toBe(true)
    const restored = cards.setTransforms.mock.calls.at(-1)?.[0] as Transform[]
    expect(restored.map(({ x }) => x)).toEqual([-0.5, 0.5])
    stage.destroy()
  })

  it('cancels an interrupted layout transition and keeps the newer layout', async () => {
    const callbacks: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      callbacks.push(callback)
      return callbacks.length
    }))
    const stage = createStage()
    const cards = currentCards()
    await stage.setItems([{ id: 'a' }])
    const firstLayout = layout(() => [transform({ x: -5 })], 'first')
    const secondLayout = layout(() => [transform({ x: 5 })], 'second')

    const firstTransition = stage.to(firstLayout, { duration: 100 })
    const secondTransition = stage.to(secondLayout, { duration: 0 })
    callbacks.at(-1)?.(100)

    expect(await firstTransition).toBe(false)
    expect(await secondTransition).toBe(true)
    const finalTransforms = cards.setTransforms.mock.calls.at(-1)?.[0] as Transform[]
    expect(finalTransforms[0].x).toBe(5)
    stage.destroy()
  })

  it('returns from a streaming effect to the current business layout', async () => {
    const stage = createStage()
    const cards = currentCards()
    await stage.setItems([{ id: 'a' }, { id: 'b' }])
    const baseLayout = layout((count) =>
      Array.from({ length: count }, (_, index) => transform({ x: index })),
      'base',
    )
    await stage.to(baseLayout, { duration: 0 })
    cards.disableEffect.mockClear()

    expect(await stage.enterTunnel(new TunnelEffect(), { duration: 0 })).toBe(true)
    expect(cards.enableTunnel).toHaveBeenCalledOnce()
    expect(await stage.to(baseLayout, { duration: 0 })).toBe(true)
    expect(cards.disableEffect).toHaveBeenCalledOnce()
    const restored = cards.setTransforms.mock.calls.at(-1)?.[0] as Transform[]
    expect(restored.map(({ x }) => x)).toEqual([0, 1])
    stage.destroy()
  })

  it('picks visible items and forwards pointer clicks', async () => {
    const onItemClick = vi.fn()
    const stage = createStage({ onItemClick })
    await stage.setItems([{ id: 'center' }])
    await stage.to(layout(() => [transform()]), { duration: 0 })

    expect(stage.pick(50, 50)?.item.id).toBe('center')
    expect(stage.pick(0, 0, 10)).toBeNull()
    const canvas = document.querySelector('canvas')
    canvas?.dispatchEvent(new PointerEvent('pointerup', { clientX: 50, clientY: 50 }))
    expect(onItemClick).toHaveBeenCalledWith({ id: 'center' }, 0)

    await stage.to(layout(() => [transform({ opacity: 0.01 })]), { duration: 0 })
    expect(stage.pick(50, 50)).toBeNull()
    stage.destroy()
  })

  it('does not pick instances hidden by the low-quality visibility ratio', async () => {
    const stage = createStage({ quality: 'low' })
    await stage.setItems([{ id: 'far' }, { id: 'hidden-center' }])
    await stage.to(
      layout(() => [transform({ x: 100 }), transform()]),
      { duration: 0 },
    )

    expect(stage.pick(50, 50)).toBeNull()
    stage.destroy()
  })

  it('is idempotent on destroy and rejects later public API use', () => {
    const stage = createStage()
    const cards = currentCards()
    stage.destroy()
    stage.destroy()

    expect(cards.dispose).toHaveBeenCalledOnce()
    expect(() => stage.getQuality()).toThrow('MotionStage has been destroyed')
    expect(() => stage.setItems([])).toThrow('MotionStage has been destroyed')
    expect(() => stage.to(layout(() => []))).toThrow('MotionStage has been destroyed')
  })

  it('ignores an item load that finishes after destroy', async () => {
    const stage = createStage()
    const cards = currentCards()
    const pending = deferred<boolean>()
    cards.setItems.mockReturnValueOnce(pending.promise)

    const loading = stage.setItems([{ id: 'late' }])
    stage.destroy()
    pending.resolve(true)
    await loading

    expect(cards.setTransforms).not.toHaveBeenCalled()
    expect(cards.dispose).toHaveBeenCalledOnce()
  })
})
