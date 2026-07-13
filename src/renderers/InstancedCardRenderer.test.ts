import { Scene } from 'three'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TextureAtlasResult } from './textureAtlas'
import { InstancedCardRenderer } from './InstancedCardRenderer'

const atlasMock = vi.hoisted(() => ({
  create: vi.fn(),
}))

vi.mock('./textureAtlas', () => ({
  createTextureAtlas: atlasMock.create,
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

function atlas(count: number) {
  const dispose = vi.fn()
  return {
    result: {
      texture: { dispose } as unknown as TextureAtlasResult['texture'],
      rects: new Float32Array(count * 4),
      width: 128,
      height: 128,
    },
    dispose,
  }
}

describe('InstancedCardRenderer item loading', () => {
  beforeEach(() => {
    atlasMock.create.mockReset()
  })

  it('keeps only the newest asynchronous atlas result', async () => {
    const first = deferred<TextureAtlasResult>()
    const second = deferred<TextureAtlasResult>()
    const firstAtlas = atlas(1)
    const secondAtlas = atlas(2)
    atlasMock.create.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const scene = new Scene()
    const renderer = new InstancedCardRenderer(scene)

    const firstLoad = renderer.setItems([{ id: 'old' }])
    const secondLoad = renderer.setItems([{ id: 'new-1' }, { id: 'new-2' }])
    first.resolve(firstAtlas.result)
    expect(await firstLoad).toBe(false)
    second.resolve(secondAtlas.result)
    expect(await secondLoad).toBe(true)

    expect(firstAtlas.dispose).toHaveBeenCalledOnce()
    expect(secondAtlas.dispose).not.toHaveBeenCalled()
    expect(scene.children).toHaveLength(1)
    renderer.dispose()
    expect(secondAtlas.dispose).toHaveBeenCalledOnce()
  })

  it('disposes an atlas that resolves after the renderer is destroyed', async () => {
    const pending = deferred<TextureAtlasResult>()
    const pendingAtlas = atlas(1)
    atlasMock.create.mockReturnValueOnce(pending.promise)
    const scene = new Scene()
    const renderer = new InstancedCardRenderer(scene)

    const loading = renderer.setItems([{ id: 'late' }])
    renderer.dispose()
    pending.resolve(pendingAtlas.result)

    expect(await loading).toBe(false)
    expect(pendingAtlas.dispose).toHaveBeenCalledOnce()
    expect(scene.children).toHaveLength(0)
  })

  it('reuses the current atlas when visual item data is unchanged', async () => {
    const currentAtlas = atlas(1)
    atlasMock.create.mockResolvedValueOnce(currentAtlas.result)
    const renderer = new InstancedCardRenderer(new Scene())
    const items = [{ id: 'same', image: 'avatar.png', title: 'Same' }]

    expect(await renderer.setItems(items)).toBe(true)
    expect(await renderer.setItems(items.map((item) => ({ ...item })))).toBe(true)

    expect(atlasMock.create).toHaveBeenCalledOnce()
    expect(renderer.getStats()).toEqual({ instanceCount: 1, textureBytes: 65_536 })
    renderer.dispose()
  })
})
