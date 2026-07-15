// @vitest-environment jsdom

import { InstancedBufferGeometry, Mesh, Scene, ShaderMaterial } from 'three'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TextureAtlasPatch, TextureAtlasResult } from './textureAtlas'
import { InstancedCardRenderer } from './InstancedCardRenderer'

const atlasMock = vi.hoisted(() => ({
  create: vi.fn(),
  createPatch: vi.fn(),
  applyPatch: vi.fn(),
}))

vi.mock('./textureAtlas', () => ({
  createTextureAtlas: atlasMock.create,
  createTextureAtlasPatch: atlasMock.createPatch,
  applyTextureAtlasPatch: atlasMock.applyPatch,
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
  const texture = { dispose, needsUpdate: false }
  const canvas = document.createElement('canvas')
  return {
    result: {
      texture: texture as unknown as TextureAtlasResult['texture'],
      rects: new Float32Array(count * 4),
      width: 128,
      height: 128,
      canvas,
      columns: Math.ceil(Math.sqrt(count || 1)),
      cellSize: 64,
      padding: 2,
      stride: 68,
    },
    dispose,
    texture,
  }
}

describe('InstancedCardRenderer item loading', () => {
  beforeEach(() => {
    atlasMock.create.mockReset()
    atlasMock.createPatch.mockReset()
    atlasMock.applyPatch.mockReset()
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
    expect(renderer.getStats()).toEqual({ instanceCount: 1, textureBytes: 87_382 })
    renderer.refreshTexture()
    expect(currentAtlas.texture.needsUpdate).toBe(true)
    renderer.dispose()
  })

  it('uploads every built-in effect through the shared vec4 path buffer', async () => {
    const currentAtlas = atlas(2)
    atlasMock.create.mockResolvedValueOnce(currentAtlas.result)
    const scene = new Scene()
    const renderer = new InstancedCardRenderer(scene)
    await renderer.setItems([{ id: 'a' }, { id: 'b' }])
    const parameters = Float32Array.from({ length: 12 }, (_, index) => index + 1)

    renderer.enableEffect({
      kind: 'vortex',
      paths: new Float32Array(8),
      speedFactors: new Float32Array([1, -1]),
      parameters,
    })

    const mesh = scene.children[0] as Mesh<InstancedBufferGeometry, ShaderMaterial>
    expect(mesh.geometry.getAttribute('effectPath').itemSize).toBe(4)
    expect(mesh.geometry.getAttribute('effectSpeedFactor').count).toBe(2)
    expect(Array.from(mesh.geometry.getAttribute('itemIndex').array)).toEqual([0, 1])
    expect(mesh.material.uniforms.effectMode.value).toBe(3)
    expect(mesh.material.uniforms.effectParamsA.value.toArray()).toEqual([1, 2, 3, 4])
    expect(mesh.material.uniforms.effectParamsC.value.toArray()).toEqual([9, 10, 11, 12])
    renderer.setHoverIndex(1)
    expect(mesh.material.uniforms.hoverIndex.value).toBe(1)
    renderer.setHoverIndex(null)
    expect(mesh.material.uniforms.hoverIndex.value).toBe(-1)
    renderer.dispose()
  })

  it('interpolates billboard orientation and hemisphere hiding with the same GPU progress', async () => {
    const currentAtlas = atlas(1)
    atlasMock.create.mockResolvedValueOnce(currentAtlas.result)
    const scene = new Scene()
    const renderer = new InstancedCardRenderer(scene)
    await renderer.setItems([{ id: 'a' }])
    const transform = {
      x: 0,
      y: 0,
      z: 0,
      scale: 1,
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0,
      opacity: 1,
    }

    renderer.prepareTransition([transform], [transform], 0, 1, 0, 1)
    renderer.setProgress(0.5)

    const mesh = scene.children[0] as Mesh<InstancedBufferGeometry, ShaderMaterial>
    expect(mesh.material.uniforms).toMatchObject({
      progress: { value: 0.5 },
      fromBillboard: { value: 0 },
      toBillboard: { value: 1 },
      fromHideBackHemisphere: { value: 0 },
      toHideBackHemisphere: { value: 1 },
    })
    expect(mesh.material.vertexShader).toContain('mix(surfaceView, billboardView, billboardAmount)')
    renderer.dispose()
  })

  it('applies only the newest asynchronous cell patch without replacing the mesh', async () => {
    const currentAtlas = atlas(2)
    const first = deferred<TextureAtlasPatch>()
    const second = deferred<TextureAtlasPatch>()
    atlasMock.create.mockResolvedValueOnce(currentAtlas.result)
    atlasMock.createPatch.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const scene = new Scene()
    const renderer = new InstancedCardRenderer(scene)
    await renderer.setItems([{ id: 'a' }, { id: 'b' }])
    const mesh = scene.children[0]

    const firstUpdate = renderer.updateItems([{ id: 'a', title: 'old' }, { id: 'b' }], [0])
    const secondUpdate = renderer.updateItems([{ id: 'a', title: 'new' }, { id: 'b' }], [0])
    first.resolve({ cells: [] })
    expect(await firstUpdate).toBe(false)
    second.resolve({ cells: [] })
    expect(await secondUpdate).toBe(true)

    expect(atlasMock.applyPatch).toHaveBeenCalledOnce()
    expect(scene.children[0]).toBe(mesh)
    renderer.dispose()
  })
})
