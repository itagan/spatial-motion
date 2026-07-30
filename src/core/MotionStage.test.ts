// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BufferGeometry,
  Float32BufferAttribute,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  ShaderMaterial,
  Texture,
  Vector3,
} from 'three'
import type { Layout, LayoutContext, MotionItem, Transform } from './types'
import type { StageExtensionContext } from './extensions'
import type { TransformBufferView } from './TransformBuffer'
import { MotionStage } from './MotionStage'
import { TunnelEffect } from '../effects/TunnelEffect'
import { radialBurst } from '../effects/RadialBurstEffect'
import type { StreamingEffect } from '../effects/types'
import {
  type MotionRenderer,
  type MotionRendererFactory,
} from '../renderers/MotionRenderer'
import { cardsRenderer } from '../renderers/cards'

const stageMocks = vi.hoisted(() => ({
  cards: [] as Array<Record<string, ReturnType<typeof vi.fn>>>,
  cardOptions: [] as unknown[],
  webglRenderers: [] as Array<Record<string, unknown>>,
}))

vi.mock('../renderers/InstancedCardRenderer', () => ({
  InstancedCardRenderer: class MockInstancedCardRenderer {
    descriptor = {
      itemBounds: { kind: 'quad', width: 1, height: 1, facing: 'layout' },
    }
    setItems = vi.fn(async () => true)
    updateItems = vi.fn(async () => true)
    setTransforms = vi.fn()
    prepareTransition = vi.fn()
    setProgress = vi.fn()
    setVisualState = vi.fn()
    prepareVisualTransition = vi.fn()
    setOrientation = vi.fn()
    setHideBackHemisphere = vi.fn()
    setHemisphereEdgeFade = vi.fn()
    enableEffect = vi.fn()
    disableEffect = vi.fn()
    setEffectTime = vi.fn()
    setVisibleRatio = vi.fn()
    setHoverIndex = vi.fn()
    refreshTexture = vi.fn()
    refreshResources = vi.fn()
    resize = vi.fn()
    capabilities = {
      patch: { updateItems: this.updateItems },
      visual: {
        setVisualState: this.setVisualState,
        prepareVisualTransition: this.prepareVisualTransition,
      },
      highlight: { setHighlightIndex: this.setHoverIndex },
      viewport: { resize: this.resize },
      resourceRecovery: { refreshResources: this.refreshResources },
      streamingEffects: {
        enable: this.enableEffect,
        disable: this.disableEffect,
        setTime: this.setEffectTime,
      },
    }
    getStats = vi.fn(() => ({
      instanceCount: 0,
      submittedInstanceCount: 0,
      gpuBytes: 0,
      metrics: {
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
      },
    }))
    dispose = vi.fn()

    constructor(_scene: unknown, options: unknown) {
      const aspectRatio = (options as { aspectRatio?: number }).aspectRatio ?? 1
      this.descriptor = {
        itemBounds: {
          kind: 'quad',
          width: aspectRatio >= 1 ? 1 : aspectRatio,
          height: aspectRatio >= 1 ? 1 / aspectRatio : 1,
          facing: 'layout',
        },
      }
      stageMocks.cards.push(this as unknown as Record<string, ReturnType<typeof vi.fn>>)
      stageMocks.cardOptions.push(options)
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
    initTexture = vi.fn()
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

function bufferTransforms(buffer: TransformBufferView): Transform[] {
  return Array.from({ length: buffer.count }, (_, index) => {
    const offset = index * 3
    return transform({
      x: buffer.positions[offset],
      y: buffer.positions[offset + 1],
      z: buffer.positions[offset + 2],
      scale: buffer.scales[index],
      rotationX: buffer.rotations[offset],
      rotationY: buffer.rotations[offset + 1],
      rotationZ: buffer.rotations[offset + 2],
      opacity: buffer.opacities[index],
    })
  })
}

function lastTransformBuffer(
  spy: ReturnType<typeof vi.fn>,
): TransformBufferView {
  const buffer = spy.mock.calls.at(-1)?.[0] as TransformBufferView | undefined
  if (!buffer) throw new Error('Expected a transform buffer submission')
  return buffer
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
  const renderer = options.renderer ?? cardsRenderer()
  return new MotionStage({
    container,
    quality: 'high',
    adaptivePerformance: false,
    ...options,
    renderer,
  })
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

function mockMotionRenderer(overrides: Partial<MotionRenderer> = {}): MotionRenderer {
  const patch = vi.fn(async () => true)
  const setVisualState = vi.fn()
  const prepareVisualTransition = vi.fn()
  const setHighlightIndex = vi.fn()
  const resize = vi.fn()
  const refreshResources = vi.fn()
  return {
    descriptor: {
      itemBounds: { kind: 'disc', diameter: 1, facing: 'camera' },
    },
    capabilities: {
      patch: { updateItems: patch },
      visual: { setVisualState, prepareVisualTransition },
      highlight: { setHighlightIndex },
      viewport: { resize },
      resourceRecovery: { refreshResources },
    },
    setItems: vi.fn(async () => true),
    setTransforms: vi.fn(),
    prepareTransition: vi.fn(),
    setProgress: vi.fn(),
    setVisibleRatio: vi.fn(),
    getStats: vi.fn(() => ({ instanceCount: 1, submittedInstanceCount: 1 })),
    dispose: vi.fn(),
    ...overrides,
  }
}

function createCustomStage(
  factory: MotionRendererFactory,
  options: Omit<
    Partial<ConstructorParameters<typeof MotionStage>[0]>,
    'container' | 'renderer'
  > = {},
) {
  const container = document.createElement('div')
  Object.defineProperties(container, {
    clientHeight: { value: 100 },
    clientWidth: { value: 100 },
  })
  document.body.appendChild(container)
  return {
    container,
    stage: new MotionStage({
      container,
      renderer: factory,
      quality: 'high',
      adaptivePerformance: false,
      ...options,
    }),
  }
}

function lineRendererFixture() {
  const geometry = new BufferGeometry()
  const material = new LineBasicMaterial()
  const lines = new LineSegments(geometry, material)
  const disposeGeometry = vi.spyOn(geometry, 'dispose')
  const disposeMaterial = vi.spyOn(material, 'dispose')
  let count = 0
  const setItems = vi.fn(async (items: MotionItem[]) => {
    count = items.length
    geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(count * 6), 3))
    return true
  })
  const setTransforms = vi.fn((transforms: TransformBufferView) => {
    const positions = geometry.getAttribute('position')
    for (let index = 0; index < transforms.count; index += 1) {
      const offset = index * 3
      positions.setXYZ(
        index * 2,
        transforms.positions[offset] - 0.25,
        transforms.positions[offset + 1],
        transforms.positions[offset + 2],
      )
      positions.setXYZ(
        index * 2 + 1,
        transforms.positions[offset] + 0.25,
        transforms.positions[offset + 1],
        transforms.positions[offset + 2],
      )
    }
    positions.needsUpdate = true
  })
  const factory: MotionRendererFactory = ({ root }) => {
    root.add(lines)
    return {
      descriptor: { itemBounds: null },
      capabilities: {},
      setItems,
      setTransforms,
      prepareTransition: vi.fn(),
      setProgress: vi.fn(),
      setVisibleRatio: vi.fn(),
      getStats: () => ({
        instanceCount: count,
        submittedInstanceCount: count,
        gpuBytes: geometry.getAttribute('position')?.array.byteLength ?? 0,
      }),
      dispose() {
        root.remove(lines)
        geometry.dispose()
        material.dispose()
      },
    }
  }
  return {
    setItems,
    setTransforms,
    disposeGeometry,
    disposeMaterial,
    factory,
  }
}

function shapeRendererFixture() {
  const geometry = new PlaneGeometry(1, 0.5)
  const material = new MeshBasicMaterial()
  const shapes = new InstancedMesh(geometry, material, 2000)
  shapes.count = 0
  const matrix = new Matrix4()
  const patch = vi.fn(async () => true)
  const highlight = vi.fn()
  const refreshResources = vi.fn()
  const disposeGeometry = vi.spyOn(geometry, 'dispose')
  const disposeMaterial = vi.spyOn(material, 'dispose')
  const factory: MotionRendererFactory = ({ root }) => {
    root.add(shapes)
    return {
      descriptor: {
        itemBounds: { kind: 'quad', width: 1, height: 0.5, facing: 'camera' },
      },
      capabilities: {
        patch: { updateItems: patch },
        highlight: { setHighlightIndex: highlight },
        resourceRecovery: { refreshResources },
      },
      async setItems(items) {
        shapes.count = items.length
        return true
      },
      setTransforms(transforms) {
        for (let index = 0; index < transforms.count; index += 1) {
          const offset = index * 3
          matrix.makeScale(
            transforms.scales[index],
            transforms.scales[index],
            transforms.scales[index],
          )
          matrix.setPosition(
            transforms.positions[offset],
            transforms.positions[offset + 1],
            transforms.positions[offset + 2],
          )
          shapes.setMatrixAt(index, matrix)
        }
        shapes.instanceMatrix.needsUpdate = true
      },
      prepareTransition: vi.fn(),
      setProgress: vi.fn(),
      setVisibleRatio: vi.fn(),
      getStats: () => ({
        instanceCount: shapes.count,
        submittedInstanceCount: shapes.count,
        gpuBytes: geometry.getAttribute('position').array.byteLength
          + shapes.instanceMatrix.array.byteLength,
      }),
      dispose() {
        root.remove(shapes)
        geometry.dispose()
        material.dispose()
      },
    }
  }
  return {
    patch,
    highlight,
    refreshResources,
    disposeGeometry,
    disposeMaterial,
    factory,
  }
}

describe('MotionStage', () => {
  beforeEach(() => {
    stageMocks.cards.length = 0
    stageMocks.cardOptions.length = 0
    stageMocks.webglRenderers.length = 0
    vi.stubGlobal('ResizeObserver', MockResizeObserver)
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  afterEach(() => {
    document.body.replaceChildren()
    vi.unstubAllGlobals()
  })

  it('requires an explicit renderer factory before allocating WebGL resources', () => {
    const container = document.createElement('div')
    expect(() => new MotionStage({ container } as never)).toThrow(
      'MotionStage renderer must be a renderer factory',
    )
    expect(stageMocks.webglRenderers).toHaveLength(0)
  })

  it('provides renderer factories with a scoped texture preparation callback', () => {
    const renderer = mockMotionRenderer()
    const texture = new Texture()
    let elapsed = -1
    const { stage } = createCustomStage((context) => {
      elapsed = context.prepareTexture(texture)
      return renderer
    })

    expect(stageMocks.webglRenderers.at(-1)?.initTexture).toHaveBeenCalledWith(texture)
    expect(elapsed).toBeGreaterThanOrEqual(0)
    stage.destroy()
  })

  it('initializes constructor items through the renderer and exposes readiness', async () => {
    const stage = createStage({ items: [{ id: 'initial', meta: { score: 7 } }] })
    await stage.ready
    expect(currentCards().setItems).toHaveBeenCalledWith([
      { id: 'initial', meta: { score: 7 } },
    ])
    expect(stage.getPerformanceStats().inputItems).toBe(1)
    stage.destroy()
  })

  it('rejects ambiguous card content configuration before allocating WebGL resources', () => {
    expect(() => cardsRenderer({
      draw: () => {},
      content: { prepare: () => ({ draw: () => {} }) },
    })).toThrow('content and draw cannot be used together')
    expect(stageMocks.webglRenderers).toHaveLength(0)
  })

  it('passes a card content renderer to the shared Atlas renderer', () => {
    const cardContent = { prepare: vi.fn(() => ({ draw: vi.fn() })) }
    const stage = createStage({ renderer: cardsRenderer({ content: cardContent }) })
    expect(stageMocks.cardOptions.at(-1)).toMatchObject({ cardContent })
    stage.destroy()
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
      gpuBytes: 1_048_576,
      metrics: { textureBytes: 1_048_576 },
    })
    await stage.setItems(Array.from({ length: 520 }, (_, index) => ({ id: `item-${index}` })))

    expect(stage.getQualityMode()).toBe('low')
    expect(stage.getPerformanceStats()).toMatchObject({
      quality: 'low',
      qualityMode: 'low',
      inputItems: 520,
      render: { drawCalls: 1, triangles: 2 },
      renderer: {
        instanceCount: 500,
        submittedInstanceCount: 500,
        gpuBytes: 1_048_576,
        metrics: { textureBytes: 1_048_576 },
      },
      pixelRatio: 1.5,
      paused: false,
      frameTimeP95: 0,
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

  it('retains the resident item pool while quality reduces submitted visibility', async () => {
    const stage = createStage({ quality: 'high' })
    const cards = currentCards()
    const items = Array.from({ length: 3000 }, (_, index) => ({ id: `item-${index}` }))
    await stage.setItems(items)
    await stage.to(layout((count) => Array.from({ length: count }, () => transform())), { duration: 0 })

    expect((cards.setItems.mock.calls[0][0] as MotionItem[])).toHaveLength(2000)
    expect(cards.setVisibleRatio).toHaveBeenLastCalledWith(1)

    stage.setQuality('medium')
    expect(cards.setItems).toHaveBeenCalledTimes(1)
    expect(cards.setVisibleRatio).toHaveBeenLastCalledWith(0.5)

    stage.setQuality('low')
    expect(cards.setItems).toHaveBeenCalledTimes(1)
    expect(cards.setVisibleRatio).toHaveBeenLastCalledWith(0.25)

    stage.setQuality('high')
    expect(cards.setItems).toHaveBeenCalledTimes(1)
    expect(cards.setVisibleRatio).toHaveBeenLastCalledWith(1)
    stage.destroy()
  })

  it('grows an initially constrained resident pool when quality increases', async () => {
    const stage = createStage({ quality: 'low' })
    const cards = currentCards()
    const items = Array.from({ length: 3000 }, (_, index) => ({ id: `item-${index}` }))
    await stage.setItems(items)
    await stage.to(layout((count) =>
      Array.from({ length: count }, (_, index) => transform({ x: index }))), { duration: 0 })
    const high = deferred<boolean>()
    cards.setItems.mockReturnValueOnce(high.promise)
    stage.setQuality('high')
    const transformsBeforeReconcile = cards.setTransforms.mock.calls.length
    expect((cards.setItems.mock.calls.at(-1)?.[0] as MotionItem[])).toHaveLength(2000)

    high.resolve(true)
    await vi.waitFor(() =>
      expect(cards.setTransforms.mock.calls.length).toBe(transformsBeforeReconcile + 2))
    expect(lastTransformBuffer(cards.setTransforms).count).toBe(2000)
    stage.destroy()
  })

  it('ignores a pending quality reconciliation after destroy', async () => {
    const stage = createStage({ quality: 'low' })
    const cards = currentCards()
    await stage.setItems(Array.from({ length: 3000 }, (_, index) => ({ id: `item-${index}` })))
    const pending = deferred<boolean>()
    cards.setItems.mockReturnValueOnce(pending.promise)
    stage.setQuality('high')
    const transformsBefore = cards.setTransforms.mock.calls.length
    stage.destroy()
    pending.resolve(true)
    await Promise.resolve()

    expect(cards.setTransforms.mock.calls.length).toBe(transformsBefore)
  })

  it('patches the resident pool without undoing a lower visible ratio', async () => {
    const stage = createStage({ quality: 'high' })
    const cards = currentCards()
    await stage.setItems(Array.from({ length: 3000 }, (_, index) => ({
      id: `item-${index}`,
      title: `Item ${index}`,
    })))
    stage.setQuality('low')
    expect(cards.setVisibleRatio).toHaveBeenLastCalledWith(0.25)
    await expect(stage.updateItem('item-0', { title: 'Updated' })).resolves.toBe(true)
    expect(cards.updateItems).toHaveBeenLastCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: 'item-0', title: 'Updated' })]),
      [0],
    )
    expect(cards.setVisibleRatio).toHaveBeenLastCalledWith(0.25)
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

  it('drives transitions from the Stage frame loop and excludes paused time', async () => {
    let now = 0
    let frame: FrameRequestCallback | null = null
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      frame = callback
      return requestFrame.mock.calls.length
    })
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    vi.stubGlobal('requestAnimationFrame', requestFrame)
    const stage = createStage()
    const cards = currentCards()
    await stage.setItems([{ id: 'a' }])

    const transition = stage.to(layout(() => [transform({ x: 4 })]), { duration: 100 })
    expect(requestFrame).toHaveBeenCalledOnce()
    const firstFrame = frame as FrameRequestCallback | null
    now = 50
    firstFrame!(now)
    expect(cards.setProgress.mock.calls.at(-1)?.[0]).toBeCloseTo(0.5)

    stage.pause()
    now = 1050
    stage.resume()
    const resumedFrame = frame as FrameRequestCallback | null
    now = 1100
    resumedFrame!(now)

    await expect(transition).resolves.toBe(true)
    expect(cards.setProgress).toHaveBeenLastCalledWith(1)
    stage.destroy()
  })

  it('settles an active transition immediately when the Stage is destroyed', async () => {
    const stage = createStage()
    await stage.setItems([{ id: 'a' }])
    const transition = stage.startTransition(layout(() => [transform({ x: 4 })]), { duration: 100 })

    stage.destroy()

    await expect(transition.finished).resolves.toEqual({ completed: false, status: 'destroyed' })
    expect(requestAnimationFrame).toHaveBeenCalledOnce()
  })

  it('exposes cancellable transition handles, progress, and completion reasons', async () => {
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const stage = createStage()
    await stage.setItems([{ id: 'a' }])
    const handle = stage.startTransition(layout(() => [transform({ x: 4 })], 'target'), { duration: 100 })

    now = 40
    expect(stage.getTransitionState()).toMatchObject({
      active: true,
      status: 'running',
      layout: 'target',
      progress: 0.4,
    })
    handle.cancel()

    await expect(handle.finished).resolves.toEqual({ completed: false, status: 'aborted' })
    expect(handle.status).toBe('aborted')
    expect(stage.getTransitionState()).toMatchObject({ active: false, status: 'aborted', layout: 'target' })
    const completed = stage.startTransition(layout(() => [transform({ x: 1 })], 'complete'), { duration: 0 })
    await expect(completed.finished).resolves.toEqual({ completed: true, status: 'completed' })
    expect(completed.status).toBe('completed')
    stage.destroy()
  })

  it('accepts AbortSignal on the compatible Promise transition API', async () => {
    const stage = createStage()
    await stage.setItems([{ id: 'a' }])
    const controller = new AbortController()
    const transition = stage.to(layout(() => [transform({ x: 2 })], 'abortable'), {
      duration: 100,
      signal: controller.signal,
    })

    controller.abort()

    await expect(transition).resolves.toBe(false)
    expect(stage.getTransitionState().status).toBe('aborted')
    stage.destroy()
  })

  it('distinguishes a newer layout interruption from explicit cancellation', async () => {
    const stage = createStage()
    await stage.setItems([{ id: 'a' }])
    const first = stage.startTransition(layout(() => [transform({ x: -2 })], 'first'), { duration: 100 })

    await stage.to(layout(() => [transform({ x: 2 })], 'second'), { duration: 0 })

    await expect(first.finished).resolves.toEqual({ completed: false, status: 'interrupted' })
    expect(stage.getTransitionState()).toMatchObject({ status: 'completed', layout: 'second', progress: 1 })
    stage.destroy()
  })

  it('keeps streaming effect time stable while paused', async () => {
    let now = 0
    let frame: FrameRequestCallback | null = null
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      frame = callback
      return 1
    }))
    const stage = createStage()
    const cards = currentCards()
    await stage.setItems([{ id: 'a' }])
    await stage.enterEffect(radialBurst(), { duration: 0 })

    now = 500
    const firstFrame = frame as FrameRequestCallback | null
    firstFrame!(now)
    expect(cards.setEffectTime).toHaveBeenLastCalledWith(0.5)
    stage.pause()
    now = 10_500
    stage.resume()
    const resumedFrame = frame as FrameRequestCallback | null
    now = 11_000
    resumedFrame!(now)

    expect(cards.setEffectTime).toHaveBeenLastCalledWith(1)
    stage.destroy()
  })

  it('drives Timeline waits from the pause-aware Stage clock', async () => {
    let now = 0
    let frame: FrameRequestCallback | null = null
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      frame = callback
      return 1
    }))
    const stage = createStage()
    const finalStep = vi.fn()
    const playing = stage.timeline().wait(100).add(finalStep).play()
    await Promise.resolve()

    now = 50
    ;(frame as FrameRequestCallback | null)!(now)
    stage.pause()
    now = 1050
    stage.resume()
    now = 1100
    ;(frame as FrameRequestCallback | null)!(now)
    await playing

    expect(finalStep).toHaveBeenCalledOnce()
    stage.destroy()
  })

  it('stops Stage Timeline steps that are waiting when destroyed', async () => {
    const stage = createStage()
    const finalStep = vi.fn()
    const playing = stage.timeline().wait(10_000).add(finalStep).play()
    await Promise.resolve()

    stage.destroy()
    await playing

    expect(finalStep).not.toHaveBeenCalled()
  })

  it('keeps the canvas CSS size pinned to its container at high pixel ratios', () => {
    const stage = createStage()
    const canvas = document.querySelector('canvas')!
    const renderer = stageMocks.webglRenderers.at(-1) as { setSize: ReturnType<typeof vi.fn> }

    expect(canvas.style.width).toBe('100%')
    expect(canvas.style.height).toBe('100%')
    expect(renderer.setSize).toHaveBeenCalledWith(100, 100, false)
    stage.destroy()
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
    const firstContext = update.mock.calls[0][0]
    const secondFrame = frame as FrameRequestCallback | null
    secondFrame!(1016)
    expect(update.mock.calls[1][0]).toBe(firstContext)
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
      beforeRender: () => events.push(`before:${name}`),
      afterRender: () => events.push(`after:${name}`),
      resize: () => events.push(`resize:${name}`),
      pause: () => events.push(`pause:${name}`),
      resume: () => events.push(`resume:${name}`),
      dispose: () => events.push(`dispose:${name}`),
    })
    await stage.addExtension(createOrderedExtension('later-a', 10))
    await stage.addExtension(createOrderedExtension('first', -1))
    await stage.addExtension(createOrderedExtension('later-b', 10))
    currentRenderer().render.mockImplementation(() => events.push('render'))

    events.length = 0
    stage.resize()
    expect(events).toEqual(['resize:first', 'resize:later-a', 'resize:later-b'])
    events.length = 0
    const renderFrame = frame as FrameRequestCallback | null
    renderFrame!(1000)
    expect(events).toEqual([
      'update:first',
      'update:later-a',
      'update:later-b',
      'before:first',
      'before:later-a',
      'before:later-b',
      'render',
      'after:first',
      'after:later-a',
      'after:later-b',
    ])
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

  it('throttles repeated extension budget overruns without losing active elapsed time', async () => {
    let frame: FrameRequestCallback | null = null
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => ++now)
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      frame = callback
      return 1
    }))
    const deltas: number[] = []
    const stage = createStage()
    await stage.addExtension({
      name: 'budgeted',
      updateBudgetMs: 0.5,
      mount: vi.fn(),
      update: ({ delta }) => deltas.push(delta),
    })

    for (const timestamp of [1000, 1016, 1032, 1048, 1064]) {
      const renderFrame = frame as FrameRequestCallback | null
      renderFrame!(timestamp)
    }

    expect(deltas).toHaveLength(4)
    expect(deltas.at(-1)).toBeCloseTo(0.032)
    expect(stage.getExtensionStats()[0]).toMatchObject({
      updateBudgetMs: 0.5,
      overBudgetFrames: 4,
      throttledFrames: 1,
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
    const stage = createStage()
    stage.on('extensionerror', ({ error, extension: failedExtension }) =>
      onExtensionError(error, failedExtension))
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
    const stage = createStage()
    stage.on('extensionerror', ({ error, extension }) => onExtensionError(error, extension))
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
    await vi.waitFor(() => expect(context).not.toBeNull())

    stage.destroy()
    expect((context as StageExtensionContext | null)?.signal.aborted).toBe(true)
    mounted.resolve()
    await expect(adding).rejects.toThrow('destroyed or the extension was removed during mount')
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('does not mount an extension when the Stage is destroyed during lazy Host loading', async () => {
    const stage = createStage()
    const mount = vi.fn()
    const adding = stage.addExtension({ mount })

    stage.destroy()

    await expect(adding).rejects.toThrow('MotionStage has been destroyed')
    expect(mount).not.toHaveBeenCalled()
  })

  it('cleans up and reports a failed extension mount', async () => {
    const failure = new Error('mount failed')
    const dispose = vi.fn()
    const onExtensionError = vi.fn()
    const extension = { mount: vi.fn(async () => { throw failure }), dispose }
    const stage = createStage()
    stage.on('extensionerror', ({ error, extension: failedExtension }) =>
      onExtensionError(error, failedExtension))

    await expect(stage.addExtension(extension)).rejects.toThrow('mount failed')
    expect(onExtensionError).toHaveBeenCalledWith(failure, extension)
    expect(dispose).toHaveBeenCalledOnce()
    expect(stage.getPerformanceStats().extensions).toBe(0)
    stage.destroy()
  })

  it('pauses on WebGL context loss and refreshes the atlas after restoration', async () => {
    const contextChanges = vi.fn()
    const stage = createStage()
    stage.on('contextchange', ({ state }) => contextChanges(state))
    const extensionPause = vi.fn()
    const extensionResume = vi.fn()
    const extensionContextLost = vi.fn()
    const extensionContextRestored = vi.fn()
    await stage.addExtension({
      mount: vi.fn(),
      pause: extensionPause,
      resume: extensionResume,
      contextLost: extensionContextLost,
      contextRestored: extensionContextRestored,
    })
    const cards = currentCards()
    const canvas = document.querySelector('canvas')!
    const lost = new Event('webglcontextlost', { cancelable: true })

    canvas.dispatchEvent(lost)
    expect(lost.defaultPrevented).toBe(true)
    expect(stage.getPerformanceStats()).toMatchObject({ paused: true, contextLost: true })
    expect(contextChanges).toHaveBeenCalledWith('lost')
    expect(extensionPause).toHaveBeenCalledOnce()
    expect(extensionContextLost).toHaveBeenCalledOnce()

    canvas.dispatchEvent(new Event('webglcontextrestored'))
    expect(cards.refreshResources).toHaveBeenCalledOnce()
    expect(stage.getPerformanceStats()).toMatchObject({ paused: false, contextLost: false })
    expect(contextChanges).toHaveBeenLastCalledWith('restored')
    expect(extensionResume).toHaveBeenCalledOnce()
    expect(extensionContextRestored).toHaveBeenCalledOnce()

    stage.pause()
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }))
    canvas.dispatchEvent(new Event('webglcontextrestored'))
    expect(stage.getPerformanceStats()).toMatchObject({ paused: true, contextLost: false })
    stage.resume()
    expect(extensionPause).toHaveBeenCalledTimes(2)
    expect(extensionResume).toHaveBeenCalledTimes(2)
    expect(extensionContextLost).toHaveBeenCalledTimes(2)
    expect(extensionContextRestored).toHaveBeenCalledTimes(2)

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
    expect(bufferTransforms(lastTransformBuffer(cards.setTransforms))).toEqual([
      transform({ x: 5 }),
    ])
    expect(cards.prepareTransition).not.toHaveBeenCalled()
    stage.destroy()
  })

  it('reuses the same transition Buffer workspaces across interruptions', async () => {
    const stage = createStage()
    const cards = currentCards()
    await stage.setItems([{ id: 'a' }, { id: 'b' }])

    const first = stage.to(
      layout((count) =>
        Array.from({ length: count }, (_, index) => transform({ x: index }))),
      { duration: 100 },
    )
    const [firstFrom, firstTarget] = cards.prepareTransition.mock.calls.at(-1) as [
      TransformBufferView,
      TransformBufferView,
    ]
    const firstPositions = firstTarget.positions
    const second = stage.to(
      layout((count) =>
        Array.from({ length: count }, (_, index) => transform({ x: -index }))),
      { duration: 100 },
    )
    const [secondFrom, secondTarget] = cards.prepareTransition.mock.calls.at(-1) as [
      TransformBufferView,
      TransformBufferView,
    ]

    expect(secondFrom).toBe(firstFrom)
    expect(secondTarget).toBe(firstTarget)
    expect(secondTarget.positions).toBe(firstPositions)
    await expect(first).resolves.toBe(false)
    stage.destroy()
    await expect(second).resolves.toBe(false)
  })

  it('retains grown transition Buffer capacity when item counts shrink', async () => {
    const stage = createStage()
    const cards = currentCards()
    await stage.setItems([{ id: 'a' }])
    await stage.to(layout(() => [transform()]), { duration: 0 })
    const workspace = lastTransformBuffer(cards.setTransforms)

    await stage.setItems(Array.from({ length: 8 }, (_, index) => ({ id: `${index}` })))
    await stage.to(
      layout((count) => Array.from({ length: count }, () => transform())),
      { duration: 0 },
    )
    const grown = lastTransformBuffer(cards.setTransforms)
    const grownPositions = grown.positions
    await stage.setItems([{ id: 'next' }])
    await stage.to(layout(() => [transform()]), { duration: 0 })
    const shrunk = lastTransformBuffer(cards.setTransforms)

    expect(grown).toBe(workspace)
    expect(shrunk).toBe(workspace)
    expect(shrunk.positions).toBe(grownPositions)
    expect(shrunk.positions.length).toBe(24)
    expect(shrunk.count).toBe(1)
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
    expect((cards.setTransforms.mock.calls[0][0] as TransformBufferView).count).toBe(2)
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
    const inherited = bufferTransforms(
      cards.setTransforms.mock.calls[1][0] as TransformBufferView,
    )

    expect(inherited.map(({ x }) => x)).toEqual([11, 10, 0])
    expect(inherited[0].scale).toBeCloseTo(1)
    expect(inherited[1].scale).toBeCloseTo(1)
    expect(inherited[2].scale).toBeCloseTo(0.01)
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
    const focused = bufferTransforms(lastTransformBuffer(cards.setTransforms))
    expect(focused[0].opacity).toBeCloseTo(0.08)
    expect(focused[1]).toMatchObject({ x: 0, y: 0, z: 8, opacity: 1 })
    expect(focused[1].scale).toBeCloseTo(1.45)

    expect(await stage.restoreLayout({ duration: 0 })).toBe(true)
    const restored = bufferTransforms(lastTransformBuffer(cards.setTransforms))
    expect(restored.map(({ x }) => x)).toEqual([-0.5, 0.5])
    stage.destroy()
  })

  it('discards a lazy focus layout after items change or the stage is destroyed', async () => {
    const stage = createStage()
    await stage.setItems([{ id: 'a' }, { id: 'b' }])

    const staleFocus = stage.focusItems(['b'], { duration: 0 })
    await stage.setItems([{ id: 'next' }])
    await expect(staleFocus).resolves.toBe(false)

    const destroyedFocus = stage.focusItems(['next'], { duration: 0 })
    stage.destroy()
    await expect(destroyedFocus).resolves.toBe(false)
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
    expect(cards.prepareVisualTransition.mock.calls.at(-1)).toEqual([
      { billboard: 0, hideBackHemisphere: 0, hemisphereEdgeFade: 0 },
      { billboard: 1, hideBackHemisphere: 0, hemisphereEdgeFade: 0 },
    ])
    const secondTransition = stage.to(secondLayout, { duration: 0 })
    callbacks.at(-1)?.(100)

    expect(await firstTransition).toBe(false)
    expect(await secondTransition).toBe(true)
    const finalTransforms = bufferTransforms(lastTransformBuffer(cards.setTransforms))
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

    expect(await stage.enterEffect(new TunnelEffect(), { duration: 0 })).toBe(true)
    expect(cards.enableEffect).toHaveBeenCalledOnce()
    expect(await stage.to(baseLayout, { duration: 0 })).toBe(true)
    expect(cards.disableEffect).toHaveBeenCalledOnce()
    const restored = bufferTransforms(lastTransformBuffer(cards.setTransforms))
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

  it('emits effecterror and keeps the CPU entry frame when Program activation fails', async () => {
    const stage = createStage()
    const cards = currentCards()
    const errors = vi.fn()
    stage.on('effecterror', errors)
    await stage.setItems([{ id: 'fallback' }])
    cards.enableEffect.mockRejectedValueOnce(new Error('shader compile failed'))
    cards.setTransforms.mockClear()

    await expect(stage.enterEffect(new TunnelEffect(), { duration: 0 })).resolves.toBe(true)
    expect(stage.getPerformanceStats().effect).toBeNull()
    expect(errors).toHaveBeenCalledWith(expect.objectContaining({
      effect: 'tunnel',
      phase: 'activate',
    }))
    expect(cards.setTransforms).toHaveBeenCalledOnce()
    stage.destroy()
  })

  it('discards a lazy Effect entry when a newer layout wins', async () => {
    const stage = createStage()
    const cards = currentCards()
    await stage.setItems([{ id: 'item' }])
    const entering = stage.enterEffect(new TunnelEffect(), { duration: 0 })
    const newerLayout = stage.to(
      layout(() => [transform({ x: 7 })], 'newer-layout'),
      { duration: 0 },
    )

    await expect(entering).resolves.toBe(false)
    await expect(newerLayout).resolves.toBe(true)
    expect(cards.enableEffect).not.toHaveBeenCalled()
    expect(bufferTransforms(lastTransformBuffer(cards.setTransforms))[0].x).toBe(7)
    stage.destroy()
  })

  it('discards a lazy Effect entry after content changes or destroy', async () => {
    const stage = createStage()
    const cards = currentCards()
    await stage.setItems([{ id: 'old' }])
    const staleEntry = stage.enterEffect(new TunnelEffect(), { duration: 0 })
    await stage.setItems([{ id: 'new' }])

    await expect(staleEntry).resolves.toBe(false)
    expect(cards.enableEffect).not.toHaveBeenCalled()

    const destroyedEntry = stage.enterEffect(new TunnelEffect(), { duration: 0 })
    stage.destroy()
    await expect(destroyedEntry).resolves.toBe(false)
    expect(cards.enableEffect).not.toHaveBeenCalled()
  })

  it('does not let slow Effect activation overwrite a newer layout', async () => {
    const activation = deferred<boolean>()
    const stage = createStage()
    const cards = currentCards()
    cards.enableEffect.mockReturnValueOnce(activation.promise)
    await stage.setItems([{ id: 'item' }])
    const entering = stage.enterEffect(new TunnelEffect(), { duration: 0 })
    await vi.waitFor(() => expect(cards.enableEffect).toHaveBeenCalledOnce())

    await stage.to(
      layout(() => [transform({ x: 9 })], 'latest-layout'),
      { duration: 0 },
    )
    activation.resolve(true)

    await expect(entering).resolves.toBe(false)
    expect(stage.getPerformanceStats().effect).toBeNull()
    expect(bufferTransforms(lastTransformBuffer(cards.setTransforms))[0].x).toBe(9)
    stage.destroy()
  })

  it('picks visible items and forwards pointer clicks', async () => {
    const onItemClick = vi.fn()
    const stage = createStage()
    stage.on('itemclick', ({ item, index }) => onItemClick(item, index))
    await stage.setItems([{ id: 'center' }])
    await stage.to(layout(() => [transform()]), { duration: 0 })

    expect((await stage.pick(50, 50))?.item.id).toBe('center')
    expect(await stage.pick(0, 0, 10)).toBeNull()
    const canvas = document.querySelector('canvas')
    canvas?.dispatchEvent(new PointerEvent('pointerup', { clientX: 50, clientY: 50 }))
    await Promise.resolve()
    expect(onItemClick).toHaveBeenCalledWith({ id: 'center' }, 0)

    await stage.to(layout(() => [transform({ opacity: 0.01 })]), { duration: 0 })
    expect(await stage.pick(50, 50)).toBeNull()
    stage.destroy()
  })

  it('reuses settled transforms for repeated interaction reads', async () => {
    const stage = createStage()
    await stage.setItems([{ id: 'center' }])
    await stage.to(layout(() => [transform()]), { duration: 0 })
    const internals = stage as unknown as {
      contentState: { transforms: TransformBufferView }
      motionCoordinator: {
        resolveTransformBuffer(now: number): TransformBufferView
      }
    }
    const settled = internals.contentState.transforms
    const first = internals.motionCoordinator.resolveTransformBuffer(performance.now())

    expect(internals.motionCoordinator.resolveTransformBuffer(performance.now())).toBe(first)
    await stage.pick(50, 50)
    expect(internals.contentState.transforms).toBe(settled)
    stage.destroy()
  })

  it('does not publish a cold pointer result after destroy', async () => {
    const onItemClick = vi.fn()
    const stage = createStage()
    stage.on('itemclick', ({ item, index }) => onItemClick(item, index))
    const canvas = document.querySelector('canvas')

    canvas?.dispatchEvent(new PointerEvent('pointerup', { clientX: 50, clientY: 50 }))
    stage.destroy()
    await Promise.resolve()
    await Promise.resolve()

    expect(onItemClick).not.toHaveBeenCalled()
  })

  it('reports hover changes once and clears GPU highlighting on pointer leave', async () => {
    let frame: FrameRequestCallback | null = null
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      frame = callback
      return 1
    }))
    const onItemHover = vi.fn()
    const stage = createStage({ hover: true, hoverEffect: 'highlight' })
    stage.on('itemhover', ({ item, index }) => onItemHover(item, index))
    const cards = currentCards()
    await stage.setItems([{ id: 'center' }])
    await stage.to(layout(() => [transform()]), { duration: 0 })
    const canvas = document.querySelector('canvas')

    canvas?.dispatchEvent(new PointerEvent('pointermove', { clientX: 50, clientY: 50 }))
    canvas?.dispatchEvent(new PointerEvent('pointerleave'))
    ;(frame as unknown as FrameRequestCallback)(performance.now())
    expect(onItemHover).not.toHaveBeenCalled()

    canvas?.dispatchEvent(new PointerEvent('pointermove', { clientX: 50, clientY: 50 }))
    canvas?.dispatchEvent(new PointerEvent('pointermove', { clientX: 50, clientY: 50 }))
    expect(onItemHover).not.toHaveBeenCalled()
    expect(frame).not.toBeNull()
    ;(frame as unknown as FrameRequestCallback)(performance.now())
    await vi.waitFor(() => expect(onItemHover).toHaveBeenCalledTimes(1))
    expect(onItemHover).toHaveBeenCalledWith({ id: 'center' }, 0)
    expect(cards.setHoverIndex).toHaveBeenLastCalledWith(0)

    canvas?.dispatchEvent(new PointerEvent('pointerleave'))
    expect(onItemHover).toHaveBeenLastCalledWith(null, null)
    expect(cards.setHoverIndex).toHaveBeenLastCalledWith(null)

    stage.pause()
    canvas?.dispatchEvent(new PointerEvent('pointermove', { clientX: 50, clientY: 50 }))
    await Promise.resolve()
    expect(onItemHover).toHaveBeenCalledTimes(3)
    expect(onItemHover).toHaveBeenLastCalledWith({ id: 'center' }, 0)
    stage.destroy()
  })

  it('supports keyboard focus, navigation, activation, and accessible labeling', async () => {
    const onItemFocus = vi.fn()
    const onItemClick = vi.fn()
    const stage = createStage({ ariaLabel: 'Guests' })
    stage.on('itemfocus', ({ item, index }) => onItemFocus(item, index))
    stage.on('itemclick', ({ item, index }) => onItemClick(item, index))
    const cards = currentCards()
    await stage.setItems([
      { id: 'a', title: 'Alice' },
      { id: 'b', title: 'Bob' },
      { id: 'c', title: 'Carol' },
    ])
    const canvas = document.querySelector('canvas')!

    expect(canvas.tabIndex).toBe(0)
    expect(canvas.getAttribute('role')).toBe('region')
    canvas.focus()
    expect(stage.getFocusedItem()?.id).toBe('a')
    expect(canvas.getAttribute('aria-label')).toContain('Alice (1 of 3)')
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(stage.getFocusedItem()?.id).toBe('b')
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(onItemClick).toHaveBeenLastCalledWith({ id: 'b', title: 'Bob' }, 1)
    expect(stage.focusItem('c')).toBe(true)
    expect(cards.setHoverIndex).toHaveBeenLastCalledWith(2)
    canvas.blur()
    expect(stage.getFocusedItem()).toBeNull()
    expect(onItemFocus).toHaveBeenLastCalledWith(null, null)
    stage.destroy()
  })

  it('keeps focused ids indexed across item reordering', async () => {
    const stage = createStage()
    const cards = currentCards()
    await stage.setItems([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
    expect(stage.focusItem('b')).toBe(true)
    expect(cards.setHoverIndex).toHaveBeenLastCalledWith(1)

    await stage.setItems([{ id: 'b' }, { id: 'c' }, { id: 'a' }])

    expect(stage.getFocusedItem()?.id).toBe('b')
    expect(cards.setHoverIndex).toHaveBeenLastCalledWith(0)
    stage.destroy()
  })

  it('makes transitions immediate and freezes streaming effects in reduced motion mode', async () => {
    const stage = createStage({ motionPreference: 'reduced' })
    const cards = currentCards()
    await stage.setItems([{ id: 'a' }])

    expect(await stage.to(layout(() => [transform({ x: 4 })]), { duration: 1000 })).toBe(true)
    expect(lastTransformBuffer(cards.setTransforms).positions[0]).toBe(4)
    expect(await stage.enterEffect(radialBurst(), { duration: 1000 })).toBe(true)
    expect(cards.enableEffect).not.toHaveBeenCalled()
    stage.autoRotate({ y: 1 })
    stage.destroy()
  })

  it('settles a slow Effect activation when Reduced Motion changes during prepare', async () => {
    let motionListener: ((event: { matches: boolean }) => void) | null = null
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false,
      addEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => {
        motionListener = listener
      },
      removeEventListener: vi.fn(),
    })))
    const activation = deferred<boolean>()
    const stage = createStage()
    const cards = currentCards()
    cards.enableEffect.mockReturnValueOnce(activation.promise)
    await stage.setItems([{ id: 'a' }])
    const entering = stage.enterEffect(radialBurst(), { duration: 0 })
    await vi.waitFor(() => expect(cards.enableEffect).toHaveBeenCalledOnce())

    ;(motionListener as ((event: { matches: boolean }) => void) | null)?.({
      matches: true,
    })
    activation.resolve(true)

    await expect(entering).resolves.toBe(true)
    expect(cards.disableEffect).toHaveBeenCalledOnce()
    expect(stage.getPerformanceStats()).toMatchObject({
      effect: null,
      activeEffectItems: 0,
    })
    stage.destroy()
  })

  it('passes camera-visible world dimensions to layouts', async () => {
    let received: LayoutContext | undefined
    const resolveCardStyle = vi.fn(() => ({ borderColor: '#ffd700' }))
    const stage = createStage({
      cameraZ: 18,
      renderer: cardsRenderer({ aspectRatio: 0.75, resolveStyle: resolveCardStyle }),
    })
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
    expect(received.itemWidth).toBe(0.75)
    expect(received.itemHeight).toBe(1)
    expect(received.items).toEqual([{ id: 'a' }])
    expect(received.quality).toBe('high')
    expect(stageMocks.cardOptions.at(-1)).toMatchObject({
      aspectRatio: 0.75,
      resolveCardStyle,
    })
    stage.destroy()
  })

  it('uses the normalized card aspect ratio for billboard and surface picking', async () => {
    const billboard = createStage({ renderer: cardsRenderer({ aspectRatio: 0.25 }) })
    await billboard.setItems([{ id: 'portrait' }])
    await billboard.to(layout(() => [transform()]), { duration: 0 })

    expect(await billboard.pick(52, 50)).toBeNull()
    expect((await billboard.pick(50, 52))?.item.id).toBe('portrait')
    billboard.destroy()

    const surface = createStage({ renderer: cardsRenderer({ aspectRatio: 0.25 }) })
    await surface.setItems([{ id: 'portrait' }])
    await surface.to({
      name: 'surface',
      orientation: 'surface',
      calculate: () => [transform()],
    }, { duration: 0 })
    expect(await surface.pick(52, 50)).toBeNull()
    expect((await surface.pick(50, 52))?.item.id).toBe('portrait')
    surface.destroy()
  })

  it('runs an injected disc renderer and falls back to a static effect frame', async () => {
    const renderer = mockMotionRenderer()
    let root: Object3D | undefined
    let signal: AbortSignal | undefined
    const { stage } = createCustomStage((context) => {
      root = context.root
      signal = context.signal
      return renderer
    })
    await stage.setItems([{ id: 'point' }])
    await stage.to(layout(() => [transform()]), { duration: 0 })

    expect(stageMocks.cards).toHaveLength(0)
    expect(renderer.capabilities.viewport?.resize).toHaveBeenCalled()
    expect((await stage.pick(52, 50))?.item.id).toBe('point')
    expect(await stage.pick(58, 50)).toBeNull()
    stage.setRotation(0.25, 0.5)
    expect(root?.rotation.x).toBeCloseTo(0.25)
    expect(root?.rotation.y).toBeCloseTo(0.5)

    expect(await stage.enterEffect(radialBurst(), { duration: 0 })).toBe(true)
    expect(renderer.capabilities.streamingEffects).toBeUndefined()
    expect(stage.getPerformanceStats()).toMatchObject({
      effect: null,
      renderer: { metrics: {} },
    })

    stage.destroy()
    expect(signal?.aborted).toBe(true)
    expect(renderer.dispose).toHaveBeenCalledOnce()
    expect(root?.parent).toBeNull()
  })

  it('updates, restores quality, highlights, and refreshes an injected renderer', async () => {
    const renderer = mockMotionRenderer({
      getStats: vi.fn(() => ({ instanceCount: 500, submittedInstanceCount: 500 })),
    })
    const { container, stage } = createCustomStage(() => renderer, {
      hoverEffect: 'highlight',
    })
    const data = Array.from({ length: 600 }, (_value, index) => ({ id: `point-${index}` }))
    await stage.setItems(data)
    await stage.updateItem('point-0', { meta: { color: '#fff' } })
    stage.setQuality('low')
    await Promise.resolve()
    container.querySelector('canvas')?.dispatchEvent(new Event('webglcontextlost', { cancelable: true }))
    container.querySelector('canvas')?.dispatchEvent(new Event('webglcontextrestored'))

    expect(renderer.capabilities.patch?.updateItems).toHaveBeenCalled()
    expect(renderer.setVisibleRatio).toHaveBeenCalled()
    expect(renderer.capabilities.resourceRecovery?.refreshResources).toHaveBeenCalledOnce()
    stage.focusItem('point-0')
    expect(renderer.capabilities.highlight?.setHighlightIndex).toHaveBeenLastCalledWith(0)
    stage.destroy()
  })

  it('advances an optional renderer frame capability from the shared Stage RAF', () => {
    let frame: FrameRequestCallback | null = null
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      frame = callback
      return 1
    }))
    const update = vi.fn()
    const renderer = mockMotionRenderer({
      capabilities: { frame: { update } },
    })
    const { stage } = createCustomStage(() => renderer)

    const renderFrame = frame as FrameRequestCallback | null
    renderFrame!(1000)

    expect(update).toHaveBeenCalledOnce()
    expect(update.mock.calls[0][0]).toBeGreaterThanOrEqual(0)
    stage.destroy()
  })

  it('supports a minimal LineSegments renderer and restores state after full-update fallback', async () => {
    const fixture = lineRendererFixture()
    const { stage } = createCustomStage(fixture.factory)
    await stage.setItems([{ id: 'line', title: 'before' }])
    await stage.to(layout(() => [transform({ x: 2 })]), { duration: 0 })
    await expect(stage.updateItem('line', { title: 'after' })).resolves.toBe(true)

    expect(fixture.setItems).toHaveBeenCalledTimes(2)
    expect(bufferTransforms(lastTransformBuffer(fixture.setTransforms))[0].x).toBe(2)
    expect(await stage.pick(50, 50)).toBeNull()
    expect(stage.focusItem('line')).toBe(true)
    stage.destroy()
    expect(fixture.disposeGeometry).toHaveBeenCalledOnce()
    expect(fixture.disposeMaterial).toHaveBeenCalledOnce()
  })

  it('lets only the newest asynchronous no-patch fallback update Stage data', async () => {
    const first = deferred<boolean>()
    const second = deferred<boolean>()
    const renderer = mockMotionRenderer({ capabilities: {} })
    const setItems = renderer.setItems as ReturnType<typeof vi.fn>
    setItems
      .mockResolvedValueOnce(true)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const { stage } = createCustomStage(() => renderer)
    await stage.setItems([{ id: 'point', title: 'initial' }])
    await stage.to(layout(() => [transform()]), { duration: 0 })

    const older = stage.updateItem('point', { title: 'older' }, {
      layout: layout(() => [transform()], 'older'),
      duration: 0,
    })
    const newer = stage.updateItem('point', { title: 'newer' }, {
      layout: layout(() => [transform()], 'newer'),
      duration: 0,
    })
    second.resolve(true)
    await expect(newer).resolves.toBe(true)
    first.resolve(true)
    await expect(older).resolves.toBe(false)
    expect((await stage.pick(50, 50))?.item.title).toBe('newer')
    stage.destroy()
  })

  it('supports a partially capable batched Shape renderer without changing Stage behavior', async () => {
    const fixture = shapeRendererFixture()
    const { container, stage } = createCustomStage(fixture.factory, {
      hoverEffect: 'highlight',
    })
    await stage.setItems([{ id: 'shape', title: 'Shape' }])
    await stage.to(layout(() => [transform()]), { duration: 0 })
    await stage.updateItem('shape', { title: 'Updated' })

    expect(fixture.patch).toHaveBeenCalledOnce()
    expect((await stage.pick(50, 50))?.item.id).toBe('shape')
    stage.focusItem('shape')
    expect(fixture.highlight).toHaveBeenLastCalledWith(0)
    container.querySelector('canvas')?.dispatchEvent(new Event('webglcontextlost', { cancelable: true }))
    container.querySelector('canvas')?.dispatchEvent(new Event('webglcontextrestored'))
    expect(fixture.refreshResources).toHaveBeenCalledOnce()
    expect(stage.getPerformanceStats().renderer.gpuBytes).toBeGreaterThan(0)

    stage.destroy()
    expect(fixture.disposeGeometry).toHaveBeenCalledOnce()
    expect(fixture.disposeMaterial).toHaveBeenCalledOnce()
  })

  it('normalizes renderer metrics and rejects incomplete optional capabilities', () => {
    const metrics = Object.fromEntries(
      Array.from({ length: 70 }, (_value, index) => [
        `metric-${index}`,
        index === 0 ? Number.NaN : index === 1 ? -2 : index,
      ]),
    )
    const renderer = mockMotionRenderer({
      getStats: vi.fn(() => ({
        instanceCount: Number.NaN,
        submittedInstanceCount: -1,
        gpuBytes: Number.POSITIVE_INFINITY,
        metrics,
      })),
    })
    const { stage } = createCustomStage(() => renderer)
    const stats = stage.getPerformanceStats()
    expect(stats).toMatchObject({
      renderer: {
        instanceCount: 0,
        submittedInstanceCount: 0,
        gpuBytes: 0,
      },
    })
    expect(Object.keys(stats.renderer.metrics)).toHaveLength(64)
    expect(Object.values(stats.renderer.metrics).every((value) => value >= 0)).toBe(true)
    stage.destroy()

    const partial = mockMotionRenderer({
      capabilities: {
        visual: { setVisualState: vi.fn() } as never,
      },
    })
    expect(() => createCustomStage(() => partial)).toThrow(
      'Motion renderer capability visual is missing method: prepareVisualTransition',
    )
    expect(partial.dispose).toHaveBeenCalledOnce()
  })

  it.each([
    ['patch', {}, 'updateItems'],
    ['visual', { setVisualState: vi.fn() }, 'prepareVisualTransition'],
    ['highlight', {}, 'setHighlightIndex'],
    ['viewport', {}, 'resize'],
    ['resourceRecovery', {}, 'refreshResources'],
    ['streamingEffects', { enable: vi.fn(), disable: vi.fn() }, 'setTime'],
    ['frame', {}, 'update'],
  ] as const)('rejects an incomplete %s renderer capability', (name, capability, missing) => {
    const renderer = mockMotionRenderer({
      capabilities: { [name]: capability },
    })
    expect(() => createCustomStage(() => renderer)).toThrow(
      `Motion renderer capability ${name} is missing method: ${missing}`,
    )
    expect(renderer.dispose).toHaveBeenCalledOnce()
  })

  it('cleans up WebGL and renderer resources when a factory or protocol fails', () => {
    const failure = new Error('factory failed')
    const geometry = new BufferGeometry()
    const material = new ShaderMaterial()
    const disposeGeometry = vi.spyOn(geometry, 'dispose')
    const disposeMaterial = vi.spyOn(material, 'dispose')
    expect(() => createCustomStage(() => {
      throw failure
    })).toThrow(failure)
    expect(stageMocks.webglRenderers.at(-1)?.dispose).toHaveBeenCalledOnce()
    expect(document.querySelectorAll('canvas')).toHaveLength(0)

    expect(() => createCustomStage(({ root }) => {
      root.add(new Mesh(geometry, material))
      throw failure
    })).toThrow(failure)
    expect(disposeGeometry).toHaveBeenCalledOnce()
    expect(disposeMaterial).toHaveBeenCalledOnce()

    const partial = { dispose: vi.fn() }
    expect(() => createCustomStage(() => partial as never)).toThrow(
      'Motion renderer is missing required method: setItems',
    )
    expect(partial.dispose).toHaveBeenCalledOnce()
    expect(stageMocks.webglRenderers.at(-1)?.dispose).toHaveBeenCalledOnce()
    expect(document.querySelectorAll('canvas')).toHaveLength(0)
  })

  it('clamps invalid and extreme Stage card aspect ratios', () => {
    const wide = createStage({ renderer: cardsRenderer({ aspectRatio: 10 }) })
    expect(stageMocks.cardOptions.at(-1)).toMatchObject({ aspectRatio: 4 })
    wide.destroy()
    const fallback = createStage({ renderer: cardsRenderer({ aspectRatio: Number.NaN }) })
    expect(stageMocks.cardOptions.at(-1)).toMatchObject({ aspectRatio: 1 })
    fallback.destroy()
  })

  it('uses the projected card quad and optional padding instead of a center radius', async () => {
    const stage = createStage()
    await stage.setItems([{ id: 'card' }])
    await stage.to(layout(() => [transform({ scale: 1 })]), { duration: 0 })

    expect(await stage.pick(58, 50)).toBeNull()
    expect((await stage.pick(58, 50, { padding: 5 }))?.item.id).toBe('card')
    expect((await stage.pick(58, 50, 10))?.item.id).toBe('card')
    stage.destroy()
  })

  it('keeps the projected broad phase conservative for tilted surface cards', async () => {
    const stage = createStage()
    await stage.setItems([{ id: 'tilted' }])
    await stage.to({
      name: 'tilted-surface',
      orientation: 'surface',
      calculate: () => [transform({ scale: 4, rotationY: 1.2 })],
    }, { duration: 0 })

    expect((await stage.pick(50, 50))?.item.id).toBe('tilted')
    expect((await stage.pick(58, 50, { padding: 4 }))?.item.id).toBe('tilted')
    stage.destroy()
  })

  it('does not clone per-item vectors while picking settled transforms', async () => {
    const stage = createStage()
    await stage.setItems(Array.from({ length: 100 }, (_, index) => ({
      id: `item-${index}`,
    })))
    await stage.to(layout((count) => Array.from(
      { length: count },
      (_value, index) => transform({ x: index ? 100 : 0 }),
    )), { duration: 0 })
    const clone = vi.spyOn(Vector3.prototype, 'clone')

    expect((await stage.pick(50, 50))?.item.id).toBe('item-0')
    expect(clone).not.toHaveBeenCalled()
    stage.destroy()
  })

  it('resolves overlapping projected cards by camera depth', async () => {
    const stage = createStage()
    await stage.setItems([{ id: 'far' }, { id: 'near' }])
    await stage.to(layout(() => [
      transform({ x: 0, z: 0, scale: 2 }),
      transform({ x: 0.3, z: 8, scale: 2 }),
    ]), { duration: 0 })

    expect((await stage.pick(50, 50))?.item.id).toBe('near')
    expect((await stage.pick(50, 50, { includeOccluded: true }))?.item.id).toBe('far')
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

    expect(await stage.pick(50, 50)).toBeNull()
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
    expect((await stage.pick(50, 50))?.item.id).toBe('moving')
    now = 100
    callbacks.at(-1)?.(100)
    await moving

    const fixedEffect: StreamingEffect = {
      name: 'fixed-test-effect',
      kind: 'radial-burst',
      prepare: vi.fn(),
      calculateInto: (_count, _elapsedSeconds, target) => {
        target.setValues(0, 0, 0, 3, 2, 0, 0, 0, 1)
      },
      getGpuData: () => ({
        kind: 'radial-burst',
        activeCount: 1,
        payload: {
          paths: new Float32Array(4),
          speedFactors: new Float32Array([1]),
          parameters: new Float32Array(12),
        },
      }),
    }
    expect(await stage.enterEffect(fixedEffect, { duration: 0 })).toBe(true)
    expect((await stage.pick(50, 50))?.item.id).toBe('moving')
    stage.destroy()
  })

  it('immediately excludes instances above the pending lower-quality cap from picking', async () => {
    const stage = createStage({ quality: 'high' })
    const items = Array.from({ length: 2000 }, (_, index) => ({ id: `item-${index}` }))
    await stage.setItems(items)
    await stage.to(
      layout((count) => Array.from(
        { length: count },
        (_, index) => transform({ x: index === 1 ? 0 : 100 }),
      )),
      { duration: 0 },
    )

    stage.setQuality('low')
    expect(await stage.pick(50, 50)).toBeNull()
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

  it('supports multiple typed event subscribers and transition lifecycle events', async () => {
    const stage = createStage()
    await stage.setItems([{ id: 'event-item' }])
    const first = vi.fn()
    const second = vi.fn()
    const started = vi.fn()
    const ended = vi.fn()
    const unsubscribe = stage.on('itemclick', first)
    stage.on('itemclick', second)
    stage.on('transitionstart', started)
    stage.on('transitionend', ended)

    const canvas = Array.from(document.querySelectorAll('canvas')).at(-1)
    canvas?.dispatchEvent(new PointerEvent('pointerup', { clientX: 50, clientY: 50 }))
    await vi.waitFor(() => expect(first).toHaveBeenCalledOnce())
    unsubscribe()
    canvas?.dispatchEvent(new PointerEvent('pointerup', { clientX: 50, clientY: 50 }))
    await vi.waitFor(() => expect(second).toHaveBeenCalledTimes(2))
    await stage.to(layout(() => [transform()]), { duration: 0 })

    expect(first).toHaveBeenCalledOnce()
    expect(second).toHaveBeenCalledTimes(2)
    expect(started).toHaveBeenCalledWith({ layout: 'test' })
    expect(ended).toHaveBeenCalledWith({
      layout: 'test',
      result: { completed: true, status: 'completed' },
    })
    stage.destroy()
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
