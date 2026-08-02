import { describe, expect, it, vi } from 'vitest'
import type {
  MotionRenderer,
  MotionRendererCapabilities,
} from '../renderers/MotionRenderer.js'
import type { MotionItem, Transform } from './types.js'
import { compileRendererRuntime } from './CompiledRendererRuntime.js'
import { TransformBuffer } from './TransformBuffer.js'

const item: MotionItem = { id: 'one' }
const transform: Transform = {
  x: 0,
  y: 0,
  z: 0,
  scale: 1,
  rotationX: 0,
  rotationY: 0,
  rotationZ: 0,
  opacity: 1,
}

function rendererFixture(
  capabilities: MotionRendererCapabilities = {},
): MotionRenderer {
  return {
    descriptor: { itemBounds: null },
    capabilities,
    setItems: vi.fn(async () => true),
    setTransforms: vi.fn(),
    prepareTransition: vi.fn(),
    setProgress: vi.fn(),
    setVisibleRatio: vi.fn(),
    getStats: vi.fn(() => ({ instanceCount: 1, submittedInstanceCount: 1 })),
    dispose: vi.fn(),
  }
}

describe('CompiledRendererRuntime', () => {
  it('compiles absent capabilities into stable no-op dispatch functions', async () => {
    const renderer = rendererFixture()
    const runtime = compileRendererRuntime(renderer)

    expect(runtime.supportsPatch).toBe(false)
    expect(runtime.needsFrame()).toBe(false)
    expect(runtime.streamingEffects).toBeUndefined()
    expect(await runtime.updateItems([item], [0])).toBe(true)
    expect(renderer.setItems).toHaveBeenCalledWith([item])
    expect(() => {
      runtime.setVisualState({
        billboard: 0,
        hideBackHemisphere: 0,
        hemisphereEdgeFade: 0,
      })
      runtime.prepareVisualTransition(
        { billboard: 0, hideBackHemisphere: 0, hemisphereEdgeFade: 0 },
        { billboard: 1, hideBackHemisphere: 0, hemisphereEdgeFade: 0 },
      )
      runtime.setHighlightIndex(0)
      runtime.resize({ width: 100, height: 50, pixelRatio: 1 })
      runtime.refreshResources()
      runtime.updateFrame(1 / 60)
    }).not.toThrow()
  })

  it('binds every capability once and dispatches through the fixed runtime', async () => {
    const patch = vi.fn(async () => true)
    const setVisualState = vi.fn()
    const prepareVisualTransition = vi.fn()
    const setHighlightIndex = vi.fn()
    const resize = vi.fn()
    const refreshResources = vi.fn()
    const prewarm = vi.fn(async () => true)
    const enable = vi.fn(async () => true)
    const disable = vi.fn()
    const setTime = vi.fn()
    const update = vi.fn()
    const needsUpdate = vi.fn(() => false)
    const renderer = rendererFixture({
      patch: { updateItems: patch },
      visual: { setVisualState, prepareVisualTransition },
      highlight: { setHighlightIndex },
      viewport: { resize },
      resourceRecovery: { refreshResources },
      resourcePreparation: { prewarm },
      streamingEffects: { enable, disable, setTime },
      frame: { update, needsUpdate },
    })
    const runtime = compileRendererRuntime(renderer)
    const visual = { billboard: 1, hideBackHemisphere: 0, hemisphereEdgeFade: 0 }

    expect(runtime.supportsPatch).toBe(true)
    expect(await runtime.updateItems([item], [0])).toBe(true)
    const transformBuffer = new TransformBuffer().copyFrom([transform])
    runtime.setTransforms(transformBuffer)
    runtime.setVisualState(visual)
    runtime.prepareVisualTransition(visual, visual)
    runtime.setHighlightIndex(0)
    runtime.resize({ width: 100, height: 50, pixelRatio: 2 })
    runtime.refreshResources()
    expect(await runtime.prewarm({ textures: true, programs: ['wave'] })).toBe(true)
    runtime.updateFrame(0.016)
    expect(runtime.needsFrame()).toBe(false)
    await runtime.streamingEffects?.enable({ kind: 'custom', activeCount: 0, payload: null })
    runtime.streamingEffects?.setTime(2)
    runtime.streamingEffects?.disable()

    expect(patch).toHaveBeenCalledWith([item], [0])
    expect(renderer.setItems).not.toHaveBeenCalled()
    expect(renderer.setTransforms).toHaveBeenCalledWith(transformBuffer)
    expect(setVisualState).toHaveBeenCalledWith(visual)
    expect(prepareVisualTransition).toHaveBeenCalledWith(visual, visual)
    expect(setHighlightIndex).toHaveBeenCalledWith(0)
    expect(resize).toHaveBeenCalledWith({ width: 100, height: 50, pixelRatio: 2 })
    expect(refreshResources).toHaveBeenCalledOnce()
    expect(prewarm).toHaveBeenCalledWith({ textures: true, programs: ['wave'] })
    expect(update).toHaveBeenCalledWith(0.016)
    expect(needsUpdate).toHaveBeenCalledOnce()
    expect(enable).toHaveBeenCalledWith({ kind: 'custom', activeCount: 0, payload: null })
    expect(setTime).toHaveBeenCalledWith(2)
    expect(disable).toHaveBeenCalledOnce()
  })

  it('keeps legacy frame capabilities continuous when they cannot report idleness', () => {
    const runtime = compileRendererRuntime(rendererFixture({ frame: { update: vi.fn() } }))

    expect(runtime.needsFrame()).toBe(true)
  })

  it('rejects invalid renderer contracts before a Stage starts', () => {
    const renderer = rendererFixture()
    Reflect.deleteProperty(renderer, 'setProgress')

    expect(() => compileRendererRuntime(renderer)).toThrow(
      'Motion renderer is missing required method: setProgress',
    )
  })
})
