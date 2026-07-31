// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

const hostMocks = vi.hoisted(() => ({
  renderers: [] as MockRenderer[],
}))

interface MockRenderer {
  domElement: HTMLCanvasElement
  capabilities: {
    maxTextureSize: number
    getMaxAnisotropy(): number
  }
  info: { render: { calls: number; triangles: number } }
  setPixelRatio: ReturnType<typeof vi.fn>
  getPixelRatio: ReturnType<typeof vi.fn>
  setSize: ReturnType<typeof vi.fn>
  render: ReturnType<typeof vi.fn>
  initTexture: ReturnType<typeof vi.fn>
  getContext: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
  compile: ReturnType<typeof vi.fn>
}

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>()
  class WebGLRenderer {
    domElement = document.createElement('canvas')
    capabilities = { maxTextureSize: 8192, getMaxAnisotropy: () => 8 }
    info = { render: { calls: 1, triangles: 12 } }
    setPixelRatio = vi.fn()
    getPixelRatio = vi.fn(() => 1.5)
    setSize = vi.fn()
    render = vi.fn()
    initTexture = vi.fn()
    getContext = vi.fn(() => ({
      VERSION: 0x1f02,
      MAX_ARRAY_TEXTURE_LAYERS: 0x88ff,
      getExtension: vi.fn(() => null),
      getParameter: vi.fn((parameter: number) => parameter === 0x88ff ? 128 : 'WebGL 2'),
      getContextAttributes: vi.fn(() => ({ antialias: true })),
    }))
    dispose = vi.fn()
    compile = vi.fn()

    constructor() {
      hostMocks.renderers.push(this)
    }
  }
  return { ...actual, WebGLRenderer }
})

import { StageRenderHost } from './StageRenderHost'

const profile = {
  maxPixelRatio: 2,
  maxVisibleItems: 600,
  maxActiveEffectItems: 300,
  antialias: true,
  targetFps: 60,
}

describe('StageRenderHost', () => {
  beforeEach(() => {
    hostMocks.renderers.length = 0
    Object.defineProperty(globalThis, 'devicePixelRatio', { value: 2, configurable: true })
  })

  it('owns renderer setup, resize, factory capabilities, and render submission', () => {
    const container = document.createElement('div')
    Object.defineProperties(container, {
      clientWidth: { value: 640 },
      clientHeight: { value: 360 },
    })
    const host = new StageRenderHost(container, profile, 20)
    const renderer = hostMocks.renderers[0]!
    const context = host.createRendererFactoryContext()

    expect(container.contains(host.canvas)).toBe(true)
    expect(host.camera.position.z).toBe(20)
    expect(context.root).toBe(host.contentRoot)
    expect(context.maxTextureLayers).toBe(128)
    expect(context.prepareProgram).toBeTypeOf('function')
    host.resize()
    expect(renderer.setSize).toHaveBeenCalledWith(640, 360, false)
    host.render()
    expect(renderer.render).toHaveBeenCalledWith(host.scene, host.camera)
    expect(host.getRenderStats()).toEqual({ drawCalls: 1, triangles: 12 })
    expect(host.getViewport()).toEqual({ width: 640, height: 360, pixelRatio: 1.5 })

    host.dispose()
    host.dispose()
    expect(renderer.dispose).toHaveBeenCalledOnce()
    expect(container.contains(host.canvas)).toBe(false)
    expect(context.signal.aborted).toBe(true)
  })

  it('cleans up the renderer when mounting the canvas fails', () => {
    const container = document.createElement('div')
    vi.spyOn(container, 'appendChild').mockImplementation(() => {
      throw new Error('mount failed')
    })

    expect(() => new StageRenderHost(container, profile)).toThrow('mount failed')
    expect(hostMocks.renderers[0]?.dispose).toHaveBeenCalledOnce()
  })

  it('caches environment capability queries until viewport state changes', () => {
    const container = document.createElement('div')
    Object.defineProperties(container, {
      clientWidth: { value: 640 },
      clientHeight: { value: 360 },
    })
    const host = new StageRenderHost(container, profile)
    const renderer = hostMocks.renderers[0]!
    renderer.getContext.mockClear()

    const first = host.getEnvironment()
    expect(first.antialias).toBe(true)
    const second = host.getEnvironment()
    expect(second).toBe(first)
    expect(renderer.getContext).toHaveBeenCalledOnce()

    host.resize()
    expect(host.getEnvironment()).not.toBe(first)
    expect(renderer.getContext).toHaveBeenCalledTimes(2)
    host.dispose()
  })
})
