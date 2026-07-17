// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Object3D } from 'three'
import type { Layout, LayoutContext, MotionItem, Transform } from './types'
import type { StageExtensionContext } from './extensions'
import { MotionStage } from './MotionStage'
import { TunnelEffect } from '../effects/TunnelEffect'
import { radialBurst } from '../effects/RadialBurstEffect'
import type { StreamingEffect } from '../effects/types'

const stageMocks = vi.hoisted(() => ({
  cards: [] as Array<Record<string, ReturnType<typeof vi.fn>>>,
  webglRenderers: [] as Array<Record<string, unknown>>,
}))

vi.mock('../renderers/InstancedCardRenderer', () => ({
  InstancedCardRenderer: class MockInstancedCardRenderer {
    setItems = vi.fn(async () => true)
    updateItems = vi.fn(async () => true)
    setTransforms = vi.fn()
    prepareTransition = vi.fn()
    setProgress = vi.fn()
    setGroupRotation = vi.fn()
    setOrientation = vi.fn()
    setHideBackHemisphere = vi.fn()
    enableEffect = vi.fn()
    disableEffect = vi.fn()
    setEffectTime = vi.fn()
    setVisibleRatio = vi.fn()
    setHoverIndex = vi.fn()
    refreshTexture = vi.fn()
    getStats = vi.fn(() => ({
      instanceCount: 0,
      submittedInstanceCount: 0,
      textureBytes: 0,
      atlasBuilds: 0,
      atlasPatches: 0,
      atlasDiscardedBuilds: 0,
      atlasDiscardedPatches: 0,
      atlasCellsUpdated: 0,
      atlasBuildMs: 0,
      atlasPatchMs: 0,
      atlasDrawMs: 0,
      imageLoadMs: 0,
      imageRequests: 0,
      imageFailures: 0,
      estimatedTextureUploadBytes: 0,
    }))
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
    getContext = vi.fn(() => ({
      VERSION: 7938,
      getExtension: vi.fn(() => ({
        UNMASKED_VENDOR_WEBGL: 37445,
        UNMASKED_RENDERER_WEBGL: 37446,
      })),
      getParameter: vi.fn((parameter: number) => {
        if (parameter === 7938) return 'WebGL 2.0 Test'
        if (parameter === 37445) return 'Test Vendor'
        if (parameter === 37446) return 'Test Renderer'
        return null
      }),
    }))
    info = { render: { calls: 1, triangles: 2 } }
    capabilities = { maxTextureSize: 4096, getMaxAnisotropy: vi.fn(() => 8) }

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

function currentRenderer() {
  const renderer = stageMocks.webglRenderers.at(-1)
  if (!renderer) throw new Error('WebGL renderer mock was not created')
  return renderer as { render: ReturnType<typeof vi.fn> }
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
    cards.getStats.mockReturnValue({
      ...cards.getStats(),
      instanceCount: 500,
      submittedInstanceCount: 500,
      textureBytes: 1_048_576,
    })
    await stage.setItems(Array.from({ length: 520 }, (_, index) => ({ id: `item-${index}` })))

    expect(stage.getQualityMode()).toBe('low')
    expect(stage.getPerformanceStats()).toMatchObject({
      quality: 'low',
      qualityMode: 'low',
      inputItems: 520,
      renderedItems: 500,
      submittedItems: 500,
      drawCalls: 1,
      triangles: 2,
      textureBytes: 1_048_576,
      pixelRatio: 1.5,
      paused: false,
      frameTimeP95: 0,
      atlasBuilds: 0,
      atlasPatches: 0,
    })

    expect(stage.getPerformanceEnvironment()).toMatchObject({
      viewportWidth: 100,
      viewportHeight: 100,
      pixelRatio: 1.5,
      maxTextureSize: 4096,
      webglVersion: 'WebGL 2.0 Test',
      gpuVendor: 'Test Vendor',
      gpuRenderer: 'Test Renderer',
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

  it('mounts extensions on isolated roots and updates them in the Stage frame loop', async () => {
    let frame: FrameRequestCallback | null = null
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      frame = callback
      return 1
    }))
    const mount = vi.fn((context: StageExtensionContext) => {
      context.root.add(new Object3D())
    })
    const update = vi.fn()
    const resize = vi.fn()
    const dispose = vi.fn()
    const stage = createStage()
    const handle = await stage.addExtension({ name: 'test', mount, update, resize, dispose })
    const context = mount.mock.calls[0][0]

    expect(context.root.name).toBe('SpatialMotionExtension:test')
    expect(context.root.parent).not.toBeNull()
    expect(context.signal.aborted).toBe(false)
    expect(resize).toHaveBeenCalledWith({ width: 100, height: 100, pixelRatio: 1.5 })
    stage.resize()
    expect(resize).toHaveBeenCalledTimes(2)
    expect(handle.active).toBe(true)

    const firstFrame = frame as FrameRequestCallback | null
    expect(firstFrame).not.toBeNull()
    firstFrame!(1000)
    const secondFrame = frame as FrameRequestCallback | null
    secondFrame!(1016)
    expect(update).toHaveBeenLastCalledWith({ elapsed: 0.016, delta: 0.016 })
    expect(stage.getPerformanceStats()).toMatchObject({ extensions: 1 })

    handle.remove()
    handle.remove()
    expect(handle.active).toBe(false)
    expect(context.signal.aborted).toBe(true)
    expect(context.root.parent).toBeNull()
    expect(dispose).toHaveBeenCalledOnce()
    stage.destroy()
  })

  it('drives five extensions from the single Stage animation frame', async () => {
    let frame: FrameRequestCallback | null = null
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      frame = callback
      return 1
    })
    vi.stubGlobal('requestAnimationFrame', requestFrame)
    const updates = Array.from({ length: 5 }, () => vi.fn())
    const stage = createStage()

    await Promise.all(updates.map((update, index) => stage.addExtension({
      name: `extension-${index}`,
      mount: vi.fn(),
      update,
    })))

    expect(requestFrame).toHaveBeenCalledOnce()
    const renderFrame = frame as FrameRequestCallback | null
    renderFrame!(1000)
    expect(updates.every((update) => update.mock.calls.length === 1)).toBe(true)
    expect(requestFrame).toHaveBeenCalledTimes(2)
    expect(stage.getPerformanceStats().extensions).toBe(5)
    stage.destroy()
  })

  it('disables and enables an extension without disposing its resources', async () => {
    let frame: FrameRequestCallback | null = null
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      frame = callback
      return 1
    }))
    let context: StageExtensionContext | null = null
    const update = vi.fn()
    const resize = vi.fn()
    const pause = vi.fn()
    const resume = vi.fn()
    const dispose = vi.fn()
    const stage = createStage()
    const handle = await stage.addExtension({
      mount(value) { context = value },
      update,
      resize,
      pause,
      resume,
      dispose,
    })

    const firstFrame = frame as FrameRequestCallback | null
    firstFrame!(1000)
    expect(update).toHaveBeenCalledOnce()
    handle.disable()
    handle.disable()
    expect(handle.enabled).toBe(false)
    expect((context as StageExtensionContext | null)?.root.visible).toBe(false)
    expect(pause).toHaveBeenCalledOnce()
    expect(dispose).not.toHaveBeenCalled()

    const disabledFrame = frame as FrameRequestCallback | null
    disabledFrame!(1016)
    expect(update).toHaveBeenCalledOnce()
    stage.pause()
    stage.resume()
    expect(pause).toHaveBeenCalledOnce()
    expect(resume).not.toHaveBeenCalled()
    handle.enable()
    handle.enable()
    expect(handle.enabled).toBe(true)
    expect((context as StageExtensionContext | null)?.root.visible).toBe(true)
    expect(resume).toHaveBeenCalledOnce()
    expect(resize).toHaveBeenCalledTimes(2)

    const enabledFrame = frame as FrameRequestCallback | null
    enabledFrame!(1032)
    expect(update).toHaveBeenCalledTimes(2)
    handle.remove()
    expect(dispose).toHaveBeenCalledOnce()
    expect(handle.enabled).toBe(false)
    stage.destroy()
  })

  it('runs extension callbacks by order and retains mount order for ties', async () => {
    let frame: FrameRequestCallback | null = null
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      frame = callback
      return 1
    }))
    const events: string[] = []
    const stage = createStage()
    const createOrderedExtension = (name: string, order: number) => ({
      name,
      order,
      mount: vi.fn(),
      update: () => events.push(`update:${name}`),
      resize: () => events.push(`resize:${name}`),
      pause: () => events.push(`pause:${name}`),
      resume: () => events.push(`resume:${name}`),
      dispose: () => events.push(`dispose:${name}`),
    })
    await stage.addExtension(createOrderedExtension('later-a', 10))
    await stage.addExtension(createOrderedExtension('first', -1))
    await stage.addExtension(createOrderedExtension('later-b', 10))

    events.length = 0
    stage.resize()
    expect(events).toEqual(['resize:first', 'resize:later-a', 'resize:later-b'])
    events.length = 0
    const renderFrame = frame as FrameRequestCallback | null
    renderFrame!(1000)
    expect(events).toEqual(['update:first', 'update:later-a', 'update:later-b'])
    events.length = 0
    stage.pause()
    expect(events).toEqual(['pause:first', 'pause:later-a', 'pause:later-b'])
    events.length = 0
    stage.resume()
    expect(events).toEqual(['resume:first', 'resume:later-a', 'resume:later-b'])
    events.length = 0
    stage.destroy()
    expect(events).toEqual(['dispose:first', 'dispose:later-a', 'dispose:later-b'])
  })

  it('notifies extensions about current and changed quality and reduced motion', async () => {
    let motionListener: ((event: { matches: boolean }) => void) | null = null
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false,
      addEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => {
        motionListener = listener
      },
      removeEventListener: vi.fn(),
    })))
    const qualityChange = vi.fn()
    const reducedMotionChange = vi.fn()
    const stage = createStage()
    const handle = await stage.addExtension({ mount: vi.fn(), qualityChange, reducedMotionChange })

    expect(qualityChange).toHaveBeenCalledWith('high')
    expect(reducedMotionChange).toHaveBeenCalledWith(false)
    handle.disable()
    stage.setQuality('low')
    ;(motionListener as ((event: { matches: boolean }) => void) | null)?.({ matches: true })
    ;(motionListener as ((event: { matches: boolean }) => void) | null)?.({ matches: false })
    expect(qualityChange).toHaveBeenLastCalledWith('low')
    expect(reducedMotionChange.mock.calls.map(([value]) => value)).toEqual([false, true, false])
    stage.destroy()
  })

  it('reports bounded per-extension timing diagnostics and distinguishes duplicate names', async () => {
    let frame: FrameRequestCallback | null = null
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => {
      now += 3
      return now
    })
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      frame = callback
      return 1
    }))
    const stage = createStage()
    const first = await stage.addExtension({ name: 'duplicate', mount: vi.fn(), update: vi.fn() })
    await stage.addExtension({ name: 'duplicate', order: -2, mount: vi.fn(), update: vi.fn() })

    const firstFrame = frame as FrameRequestCallback | null
    firstFrame!(1000)
    const secondFrame = frame as FrameRequestCallback | null
    secondFrame!(1016)
    const activeStats = stage.getExtensionStats()
    expect(activeStats.map(({ name }) => name)).toEqual(['duplicate', 'duplicate'])
    expect(new Set(activeStats.map(({ id }) => id)).size).toBe(2)
    expect(activeStats[0]).toMatchObject({
      order: -2,
      active: true,
      enabled: true,
      updateCalls: 2,
      averageUpdateMs: 3,
      updateTimeP95: 3,
      updateTimeP99: 3,
      maximumUpdateMs: 3,
      slowFrames: 2,
      errorCount: 0,
      lastError: null,
    })

    first.remove()
    expect(stage.getExtensionStats().at(-1)).toMatchObject({
      name: 'duplicate',
      active: false,
      enabled: false,
    })
    stage.destroy()
  })

  it('bounds disposed extension diagnostics without retaining an unbounded history', async () => {
    const stage = createStage()
    for (let index = 0; index < 25; index += 1) {
      const handle = await stage.addExtension({ name: `history-${index}`, mount: vi.fn() })
      handle.remove()
    }

    const history = stage.getExtensionStats()
    expect(history).toHaveLength(20)
    expect(history[0].name).toBe('history-24')
    expect(history.at(-1)?.name).toBe('history-5')
    expect(history.every(({ active }) => !active)).toBe(true)
    stage.destroy()
  })

  it('forwards effective pause and resume transitions exactly once', async () => {
    let visibility: DocumentVisibilityState = 'visible'
    const visibilitySpy = vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
    const pause = vi.fn()
    const resume = vi.fn()
    const stage = createStage()
    await stage.addExtension({ mount: vi.fn(), pause, resume })

    stage.pause()
    stage.pause()
    expect(pause).toHaveBeenCalledOnce()
    stage.resume()
    expect(resume).toHaveBeenCalledOnce()

    visibility = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
    stage.pause()
    expect(pause).toHaveBeenCalledTimes(2)
    visibility = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
    expect(resume).toHaveBeenCalledOnce()
    stage.resume()
    expect(resume).toHaveBeenCalledTimes(2)

    stage.destroy()
    visibilitySpy.mockRestore()
  })

  it('isolates extension update errors and keeps rendering the Stage', async () => {
    let frame: FrameRequestCallback | null = null
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      frame = callback
      return 1
    }))
    const failure = new Error('extension update failed')
    const dispose = vi.fn()
    const onExtensionError = vi.fn()
    const extension = { mount: vi.fn(), update: vi.fn(() => { throw failure }), dispose }
    const stage = createStage({ onExtensionError })
    const renderer = currentRenderer()
    const handle = await stage.addExtension(extension)

    const renderFrame = frame as FrameRequestCallback | null
    renderFrame!(1000)
    expect(onExtensionError).toHaveBeenCalledWith(failure, extension)
    expect(dispose).toHaveBeenCalledOnce()
    expect(handle.active).toBe(false)
    expect(stage.getPerformanceStats().extensions).toBe(0)
    expect(stage.getExtensionStats()).toEqual([
      expect.objectContaining({ active: false, errorCount: 1, lastError: 'extension update failed' }),
    ])
    expect(renderer.render).toHaveBeenCalledOnce()
    stage.destroy()
  })

  it('isolates resize, pause, resume, and dispose callback errors', async () => {
    const onExtensionError = vi.fn()
    const stage = createStage({ onExtensionError })
    const failures = {
      resize: new Error('resize failed'),
      pause: new Error('pause failed'),
      resume: new Error('resume failed'),
      dispose: new Error('dispose failed'),
    }

    let resizeCalls = 0
    const resizeExtension = {
      mount: vi.fn(),
      resize: vi.fn(() => {
        resizeCalls += 1
        if (resizeCalls > 1) throw failures.resize
      }),
    }
    const resizeHandle = await stage.addExtension(resizeExtension)
    stage.resize()
    expect(resizeHandle.active).toBe(false)

    const pauseExtension = { mount: vi.fn(), pause: vi.fn(() => { throw failures.pause }) }
    const pauseHandle = await stage.addExtension(pauseExtension)
    stage.pause()
    expect(pauseHandle.active).toBe(false)
    stage.resume()

    const resumeExtension = { mount: vi.fn(), resume: vi.fn(() => { throw failures.resume }) }
    const resumeHandle = await stage.addExtension(resumeExtension)
    stage.pause()
    stage.resume()
    expect(resumeHandle.active).toBe(false)

    const disposeExtension = { mount: vi.fn(), dispose: vi.fn(() => { throw failures.dispose }) }
    const disposeHandle = await stage.addExtension(disposeExtension)
    disposeHandle.remove()
    expect(disposeHandle.active).toBe(false)

    expect(onExtensionError.mock.calls).toEqual([
      [failures.resize, resizeExtension],
      [failures.pause, pauseExtension],
      [failures.resume, resumeExtension],
      [failures.dispose, disposeExtension],
    ])
    expect(stage.getPerformanceStats().extensions).toBe(0)
    stage.destroy()
  })

  it('aborts and disposes an asynchronous mount when the Stage is destroyed', async () => {
    const mounted = deferred<void>()
    const dispose = vi.fn()
    let context: StageExtensionContext | null = null
    const stage = createStage()
    const adding = stage.addExtension({
      mount(value) {
        context = value
        return mounted.promise
      },
      dispose,
    })

    stage.destroy()
    expect((context as StageExtensionContext | null)?.signal.aborted).toBe(true)
    mounted.resolve()
    await expect(adding).rejects.toThrow('destroyed or the extension was removed during mount')
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('cleans up and reports a failed extension mount', async () => {
    const failure = new Error('mount failed')
    const dispose = vi.fn()
    const onExtensionError = vi.fn()
    const extension = { mount: vi.fn(async () => { throw failure }), dispose }
    const stage = createStage({ onExtensionError })

    await expect(stage.addExtension(extension)).rejects.toThrow('mount failed')
    expect(onExtensionError).toHaveBeenCalledWith(failure, extension)
    expect(dispose).toHaveBeenCalledOnce()
    expect(stage.getPerformanceStats().extensions).toBe(0)
    stage.destroy()
  })

  it('pauses on WebGL context loss and refreshes the atlas after restoration', async () => {
    const contextChanges = vi.fn()
    const stage = createStage({ onContextChange: contextChanges })
    const extensionPause = vi.fn()
    const extensionResume = vi.fn()
    await stage.addExtension({ mount: vi.fn(), pause: extensionPause, resume: extensionResume })
    const cards = currentCards()
    const canvas = document.querySelector('canvas')!
    const lost = new Event('webglcontextlost', { cancelable: true })

    canvas.dispatchEvent(lost)
    expect(lost.defaultPrevented).toBe(true)
    expect(stage.getPerformanceStats()).toMatchObject({ paused: true, contextLost: true })
    expect(contextChanges).toHaveBeenCalledWith('lost')
    expect(extensionPause).toHaveBeenCalledOnce()

    canvas.dispatchEvent(new Event('webglcontextrestored'))
    expect(cards.refreshTexture).toHaveBeenCalledOnce()
    expect(stage.getPerformanceStats()).toMatchObject({ paused: false, contextLost: false })
    expect(contextChanges).toHaveBeenLastCalledWith('restored')
    expect(extensionResume).toHaveBeenCalledOnce()

    stage.pause()
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }))
    canvas.dispatchEvent(new Event('webglcontextrestored'))
    expect(stage.getPerformanceStats()).toMatchObject({ paused: true, contextLost: false })
    stage.resume()
    expect(extensionPause).toHaveBeenCalledTimes(2)
    expect(extensionResume).toHaveBeenCalledTimes(2)

    stage.destroy()
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }))
    expect(contextChanges).toHaveBeenCalledTimes(4)
  })

  it('uses stage transition defaults when a call omits its own options', async () => {
    const stage = createStage({ transition: { duration: 0 } })
    const cards = currentCards()
    await stage.setItems([{ id: 'a' }])
    cards.prepareTransition.mockClear()

    expect(await stage.to(layout(() => [transform({ x: 5 })]))).toBe(true)
    expect(cards.setTransforms).toHaveBeenLastCalledWith([transform({ x: 5 })])
    expect(cards.prepareTransition).not.toHaveBeenCalled()
    stage.destroy()
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

  it('updates card content by stable id without rebuilding stage transforms', async () => {
    const stage = createStage()
    const cards = currentCards()
    await stage.setItems([{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }])
    cards.setTransforms.mockClear()

    expect(await stage.updateItem('b', { title: 'Updated', meta: { value: 2 } })).toBe(true)
    expect(cards.updateItems).toHaveBeenCalledWith([
      { id: 'a', title: 'A' },
      { id: 'b', title: 'Updated', meta: { value: 2 } },
    ], [1])
    expect(cards.setTransforms).not.toHaveBeenCalled()

    await expect(stage.updateItemsById([{ id: 'missing', patch: { title: 'No' } }]))
      .rejects.toThrow('Unknown MotionItem id: missing')
    expect(() => stage.updateItemsById([
      { id: 'a', patch: { title: 'one' } },
      { id: 'a', patch: { title: 'two' } },
    ])).toThrow('Duplicate MotionItem update id: a')
    stage.destroy()
  })

  it('coalesces same-turn item patches into one atlas update', async () => {
    const stage = createStage()
    const cards = currentCards()
    await stage.setItems([{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }])
    cards.updateItems.mockClear()

    const first = stage.updateItem('a', { title: 'A2' })
    const second = stage.updateItem('b', { title: 'B2' })
    const third = stage.updateItem('a', { meta: { selected: true } })

    await expect(Promise.all([first, second, third])).resolves.toEqual([true, true, true])
    expect(cards.updateItems).toHaveBeenCalledOnce()
    expect(cards.updateItems).toHaveBeenCalledWith([
      { id: 'a', title: 'A2', meta: { selected: true } },
      { id: 'b', title: 'B2' },
    ], [0, 1])
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
    expect(cards.prepareTransition.mock.calls.at(-1)?.slice(2)).toEqual([0, 1, 0, 0])
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
    expect(cards.enableEffect).toHaveBeenCalledOnce()
    expect(await stage.to(baseLayout, { duration: 0 })).toBe(true)
    expect(cards.disableEffect).toHaveBeenCalledOnce()
    const restored = cards.setTransforms.mock.calls.at(-1)?.[0] as Transform[]
    expect(restored.map(({ x }) => x)).toEqual([0, 1])
    stage.destroy()
  })

  it('uses the unified effect API and reapplies the active pool limit after a quality change', async () => {
    const stage = createStage({ quality: 'high' })
    const cards = currentCards()
    await stage.setItems(Array.from({ length: 500 }, (_, index) => ({ id: `item-${index}` })))

    expect(await stage.enterEffect(radialBurst({ maxActiveItems: 500 }), { duration: 0 })).toBe(true)
    expect(cards.enableEffect).toHaveBeenCalledOnce()
    expect(stage.getPerformanceStats()).toMatchObject({ effect: 'radial-burst', activeEffectItems: 300 })

    stage.setQuality('medium')
    expect(stage.getPerformanceStats()).toMatchObject({ effect: 'radial-burst', activeEffectItems: 220 })
    stage.setQuality('low')
    expect(cards.enableEffect).toHaveBeenCalledTimes(3)
    expect(stage.getPerformanceStats()).toMatchObject({ effect: 'radial-burst', activeEffectItems: 140 })
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

  it('reports hover changes once and clears GPU highlighting on pointer leave', async () => {
    const onItemHover = vi.fn()
    const stage = createStage({ onItemHover, hoverEffect: 'highlight' })
    const cards = currentCards()
    await stage.setItems([{ id: 'center' }])
    await stage.to(layout(() => [transform()]), { duration: 0 })
    const canvas = document.querySelector('canvas')

    canvas?.dispatchEvent(new PointerEvent('pointermove', { clientX: 50, clientY: 50 }))
    canvas?.dispatchEvent(new PointerEvent('pointermove', { clientX: 50, clientY: 50 }))
    expect(onItemHover).toHaveBeenCalledTimes(1)
    expect(onItemHover).toHaveBeenCalledWith({ id: 'center' }, 0)
    expect(cards.setHoverIndex).toHaveBeenLastCalledWith(0)

    canvas?.dispatchEvent(new PointerEvent('pointerleave'))
    expect(onItemHover).toHaveBeenLastCalledWith(null, null)
    expect(cards.setHoverIndex).toHaveBeenLastCalledWith(null)
    stage.destroy()
  })

  it('makes transitions immediate and freezes streaming effects in reduced motion mode', async () => {
    const stage = createStage({ motionPreference: 'reduced' })
    const cards = currentCards()
    await stage.setItems([{ id: 'a' }])

    expect(await stage.to(layout(() => [transform({ x: 4 })]), { duration: 1000 })).toBe(true)
    expect((cards.setTransforms.mock.calls.at(-1)?.[0] as Transform[])[0].x).toBe(4)
    expect(await stage.enterEffect(radialBurst(), { duration: 1000 })).toBe(true)
    expect(cards.enableEffect).not.toHaveBeenCalled()
    stage.autoRotate({ y: 1 })
    stage.destroy()
  })

  it('passes camera-visible world dimensions to layouts', async () => {
    let received: LayoutContext | undefined
    const stage = createStage({ cameraZ: 18 })
    await stage.setItems([{ id: 'a' }])
    await stage.to({
      name: 'context-reader',
      calculate: (_count, context) => {
        received = context
        return [transform()]
      },
    }, { duration: 0 })

    if (!received) throw new Error('Layout context was not received')
    expect(received.viewportWidth).toBeGreaterThan(0)
    expect(received.viewportHeight).toBeGreaterThan(0)
    expect(received.viewportWidth).toBeCloseTo(received.viewportHeight ?? 0)
    stage.destroy()
  })

  it('uses the projected card quad and optional padding instead of a center radius', async () => {
    const stage = createStage()
    await stage.setItems([{ id: 'card' }])
    await stage.to(layout(() => [transform({ scale: 1 })]), { duration: 0 })

    expect(stage.pick(58, 50)).toBeNull()
    expect(stage.pick(58, 50, { padding: 5 })?.item.id).toBe('card')
    expect(stage.pick(58, 50, 10)?.item.id).toBe('card')
    stage.destroy()
  })

  it('resolves overlapping projected cards by camera depth', async () => {
    const stage = createStage()
    await stage.setItems([{ id: 'far' }, { id: 'near' }])
    await stage.to(layout(() => [
      transform({ x: 0, z: 0, scale: 2 }),
      transform({ x: 0.3, z: 8, scale: 2 }),
    ]), { duration: 0 })

    expect(stage.pick(50, 50)?.item.id).toBe('near')
    expect(stage.pick(50, 50, { includeOccluded: true })?.item.id).toBe('far')
    stage.destroy()
  })

  it('rejects back-facing surface cards', async () => {
    const stage = createStage()
    await stage.setItems([{ id: 'back' }])
    await stage.to({
      name: 'back-facing',
      orientation: 'surface',
      calculate: () => [transform({ scale: 2, rotationY: Math.PI })],
    }, { duration: 0 })

    expect(stage.pick(50, 50)).toBeNull()
    stage.destroy()
  })

  it('picks from current CPU transforms while a transition or streaming effect is active', async () => {
    const callbacks: FrameRequestCallback[] = []
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      callbacks.push(callback)
      return callbacks.length
    }))
    const stage = createStage()
    await stage.setItems([{ id: 'moving' }])
    await stage.to(layout(() => [transform({ x: -2, scale: 2 })]), { duration: 0 })
    const moving = stage.to(layout(() => [transform({ x: 2, scale: 2 })]), { duration: 100 })
    now = 50
    expect(stage.pick(50, 50)?.item.id).toBe('moving')
    now = 100
    callbacks.at(-1)?.(100)
    await moving

    const fixedEffect: StreamingEffect = {
      name: 'fixed-test-effect',
      kind: 'radial-burst',
      prepare: vi.fn(),
      calculateTransforms: () => [transform({ z: 3, scale: 2 })],
      getGpuData: () => ({
        kind: 'radial-burst',
        paths: new Float32Array(4),
        speedFactors: new Float32Array([1]),
        parameters: new Float32Array(12),
      }),
    }
    expect(await stage.enterEffect(fixedEffect, { duration: 0 })).toBe(true)
    expect(stage.pick(50, 50)?.item.id).toBe('moving')
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
    expect(() => stage.enterEffect(radialBurst())).toThrow('MotionStage has been destroyed')
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
