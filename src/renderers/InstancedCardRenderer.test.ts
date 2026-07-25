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
  TextureAtlasImageCache: class {
    clear = vi.fn()
  },
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
  const texture = {
    dispose,
    needsUpdate: false,
    clearUpdateRanges: vi.fn(),
    addUpdateRange: vi.fn(),
  }
  const width = 128
  const height = 128
  return {
    result: {
      texture: texture as unknown as TextureAtlasResult['texture'],
      rects: new Float32Array(count * 4),
      width,
      height,
      data: new Uint8Array(width * height * 4),
      columns: Math.ceil(Math.sqrt(count || 1)),
      rows: Math.ceil(Math.sqrt(count || 1)),
      cellSize: 64,
      cellWidth: 64,
      cellHeight: 64,
      padding: 2,
      stride: 68,
      strideX: 68,
      strideY: 68,
      initialized: true,
      metrics: {
        cells: count,
        renderMs: 4,
        applyMs: 1,
        imageLoadMs: 2,
        imageRequests: count,
        imageFailures: 0,
        uploadBytes: width * height * 4,
      },
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
    atlasMock.applyPatch.mockReturnValue(1)
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
    expect(renderer.getStats()).toMatchObject({
      instanceCount: 1,
      submittedInstanceCount: 1,
      textureBytes: 87_382,
      atlasBuilds: 1,
      atlasPatches: 0,
      atlasCellsUpdated: 1,
      imageRequests: 1,
      estimatedTextureUploadBytes: 65_536,
    })
    renderer.refreshTexture()
    expect(currentAtlas.texture.needsUpdate).toBe(true)
    renderer.dispose()
  })

  it('normalizes shared plane geometry to the configured card aspect ratio', async () => {
    const currentAtlas = atlas(1)
    atlasMock.create.mockResolvedValueOnce(currentAtlas.result)
    const scene = new Scene()
    const renderer = new InstancedCardRenderer(scene, { aspectRatio: 4 })

    await renderer.setItems([{ id: 'wide' }])

    const mesh = scene.children[0] as Mesh<InstancedBufferGeometry, ShaderMaterial>
    const positions = Array.from(mesh.geometry.getAttribute('position').array)
    const xs = positions.filter((_value, index) => index % 3 === 0)
    const ys = positions.filter((_value, index) => index % 3 === 1)
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(1)
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(0.25)
    expect(atlasMock.create.mock.calls[0][2]).toMatchObject({ aspectRatio: 4 })
    expect(scene.children).toHaveLength(1)
    renderer.dispose()
  })

  it('does not let an in-flight atlas override a newer request for the currently displayed items', async () => {
    const initialAtlas = atlas(1)
    const pendingOther = deferred<TextureAtlasResult>()
    const pendingInitial = deferred<TextureAtlasResult>()
    const otherAtlas = atlas(2)
    const restoredAtlas = atlas(1)
    atlasMock.create
      .mockResolvedValueOnce(initialAtlas.result)
      .mockReturnValueOnce(pendingOther.promise)
      .mockReturnValueOnce(pendingInitial.promise)
    const renderer = new InstancedCardRenderer(new Scene())
    await renderer.setItems([{ id: 'a' }])

    const other = renderer.setItems([{ id: 'b' }, { id: 'c' }])
    const restored = renderer.setItems([{ id: 'a' }])
    pendingOther.resolve(otherAtlas.result)
    pendingInitial.resolve(restoredAtlas.result)

    await expect(other).resolves.toBe(false)
    await expect(restored).resolves.toBe(true)
    expect(otherAtlas.dispose).toHaveBeenCalledOnce()
    expect(renderer.getStats().instanceCount).toBe(1)
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
    expect(mesh.geometry.instanceCount).toBe(1)
    expect(renderer.getStats()).toMatchObject({ instanceCount: 2, submittedInstanceCount: 1 })
    renderer.disableEffect()
    expect(mesh.geometry.instanceCount).toBe(2)
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

    renderer.prepareTransition([transform], [transform], 0, 1, 0, 1, 0.05, 0.1)
    renderer.setProgress(0.5)

    const mesh = scene.children[0] as Mesh<InstancedBufferGeometry, ShaderMaterial>
    expect(mesh.material.uniforms).toMatchObject({
      progress: { value: 0.5 },
      fromBillboard: { value: 0 },
      toBillboard: { value: 1 },
      fromHideBackHemisphere: { value: 0 },
      toHideBackHemisphere: { value: 1 },
      fromHemisphereEdgeFade: { value: 0.05 },
      toHemisphereEdgeFade: { value: 0.1 },
    })
    expect(mesh.material.vertexShader).toContain('mix(surfaceView, billboardView, billboardAmount)')
    expect(mesh.material.vertexShader).toContain('visibilityRank > visibleRatio')
    expect(mesh.material.vertexShader).toContain('smoothstep(0.0, edgeFade, facing)')
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
    const emptyPatch = {
      cells: [],
      metrics: {
        cells: 0,
        renderMs: 2,
        applyMs: 0,
        imageLoadMs: 0,
        imageRequests: 0,
        imageFailures: 0,
        uploadBytes: 0,
      },
    }
    first.resolve(emptyPatch)
    expect(await firstUpdate).toBe(false)
    second.resolve(emptyPatch)
    expect(await secondUpdate).toBe(true)

    expect(atlasMock.applyPatch).toHaveBeenCalledOnce()
    expect(renderer.getStats()).toMatchObject({
      atlasBuilds: 1,
      atlasPatches: 1,
      atlasDiscardedPatches: 1,
    })
    expect(scene.children[0]).toBe(mesh)
    renderer.dispose()
  })

  it('patches resolved per-item style changes once and then reuses the fingerprint', async () => {
    const currentAtlas = atlas(1)
    const patch = {
      cells: [],
      metrics: {
        cells: 1,
        renderMs: 1,
        applyMs: 0,
        imageLoadMs: 0,
        imageRequests: 0,
        imageFailures: 0,
        uploadBytes: 0,
      },
    }
    const resolveCardStyle = vi.fn((item: { meta?: unknown }) =>
      item.meta ? { borderColor: '#ffd700' } : undefined)
    atlasMock.create.mockResolvedValueOnce(currentAtlas.result)
    atlasMock.createPatch.mockResolvedValueOnce(patch)
    const renderer = new InstancedCardRenderer(new Scene(), { resolveCardStyle })
    await renderer.setItems([{ id: 'a' }])
    const updated = [{ id: 'a', meta: { winner: true } }]

    expect(await renderer.updateItems(updated, [0])).toBe(true)
    expect(await renderer.updateItems(updated.map((item) => ({ ...item })), [0])).toBe(true)

    expect(atlasMock.createPatch).toHaveBeenCalledOnce()
    expect(atlasMock.createPatch.mock.calls[0][3]).toMatchObject({ resolveCardStyle })
    renderer.dispose()
  })
})
