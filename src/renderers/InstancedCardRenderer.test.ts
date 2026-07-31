// @vitest-environment jsdom

import {
  DataArrayTexture,
  GLSL3,
  InstancedBufferGeometry,
  Mesh,
  Scene,
  ShaderMaterial,
} from 'three'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TextureAtlasPatch, TextureAtlasResult } from './textureAtlas'
import { InstancedCardRenderer } from './InstancedCardRenderer'
import {
  defineCardEffectProgram,
  defineCardMotionProgram,
  type CardEffectProgram,
} from './cards/programs'
import type { CardAtlasBackend } from './cards/CardAtlasBackend'
import { TransformBuffer } from '../core/TransformBuffer'

const atlasMock = vi.hoisted(() => ({
  create: vi.fn(),
  createPatch: vi.fn(),
  applyPatch: vi.fn(),
  advanceUploads: vi.fn(),
  clearPatchQueue: vi.fn(),
}))

vi.mock('./textureAtlas', () => ({
  createTextureAtlas: atlasMock.create,
  createTextureAtlasPatch: atlasMock.createPatch,
  applyTextureAtlasPatch: atlasMock.applyPatch,
  advanceTextureAtlasUploads: atlasMock.advanceUploads,
  clearTextureAtlasPatchQueue: atlasMock.clearPatchQueue,
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
      mode: 'single' as const,
      rects: new Float32Array(count * 4),
      width,
      height,
      depth: 1,
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
      mipmaps: true,
      initialized: true,
      metrics: {
        cells: count,
        renderMs: 4,
        prepareMs: 0.5,
        imageLoadWallMs: 1,
        cellRenderMs: 2,
        applyMs: 1,
        readbackMs: 0.5,
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
    atlasMock.advanceUploads.mockReset()
    atlasMock.advanceUploads.mockImplementation((
      atlas: TextureAtlasResult,
      nextLayer: number,
      layerBudget: number,
    ) => {
      const end = Math.min(atlas.depth, nextLayer + layerBudget)
      if ('addLayerUpdate' in atlas.texture) {
        for (let layer = nextLayer; layer < end; layer += 1) {
          atlas.texture.addLayerUpdate(layer)
        }
      }
      return [end, end > nextLayer]
    })
    atlasMock.clearPatchQueue.mockReset()
  })

  it('reports a complete zero atlas snapshot before the lazy backend is prepared', () => {
    const renderer = new InstancedCardRenderer(new Scene())

    expect(renderer.getStats().metrics).toMatchObject({
      textureBytes: 0,
      atlasBuilds: 0,
      atlasPatches: 0,
      atlasDiscardedBuilds: 0,
      atlasDiscardedPatches: 0,
      atlasCellsUpdated: 0,
      estimatedTextureUploadBytes: 0,
      atlasUploadRanges: 0,
    })
    renderer.dispose()
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

  it('uses automatic atlas resolution above 1024 items and preserves mipmap options', async () => {
    const currentAtlas = atlas(1025)
    currentAtlas.result.cellSize = 48
    currentAtlas.result.mipmaps = false
    atlasMock.create.mockResolvedValueOnce(currentAtlas.result)
    const renderer = new InstancedCardRenderer(new Scene(), {
      cellSize: 'auto',
      mipmaps: false,
    })
    const items = Array.from({ length: 1025 }, (_, index) => ({ id: String(index) }))

    expect(await renderer.setItems(items)).toBe(true)
    expect(atlasMock.create).toHaveBeenCalledWith(
      items,
      48,
      expect.objectContaining({ mipmaps: false }),
    )
    expect(renderer.getStats().metrics).toMatchObject({
      atlasResolution: 48,
      atlasMipmaps: 0,
    })
    renderer.dispose()
  })

  it('keeps custom content at 64px unless automatic resolution is explicit', async () => {
    const currentAtlas = atlas(1025)
    atlasMock.create.mockResolvedValueOnce(currentAtlas.result)
    const renderer = new InstancedCardRenderer(new Scene(), {
      cardContent: { prepare: () => ({ draw: () => {} }) },
    })
    const items = Array.from({ length: 1025 }, (_, index) => ({ id: String(index) }))

    expect(await renderer.setItems(items)).toBe(true)
    expect(atlasMock.create).toHaveBeenCalledWith(items, 64, expect.any(Object))
    renderer.dispose()
  })

  it('accepts a custom Atlas backend without changing the Cards render pipeline', async () => {
    const currentAtlas = atlas(2)
    const backend: CardAtlasBackend = {
      prepare: vi.fn(async () => {}),
      build: vi.fn(async () => ({ atlas: currentAtlas.result })),
      patch: vi.fn(),
      applyPatch: vi.fn(() => 0),
      advanceUploads: vi.fn((_, nextLayer) => [nextLayer, false] as const),
      clearPatchQueue: vi.fn(),
      dispose: vi.fn(),
    }
    const scene = new Scene()
    const renderer = new InstancedCardRenderer(scene, { atlasBackend: backend })
    const items = [{ id: 'a' }, { id: 'b' }]

    await expect(renderer.setItems(items)).resolves.toBe(true)

    expect(backend.prepare).toHaveBeenCalledOnce()
    expect(backend.build).toHaveBeenCalledWith(items, 64, expect.any(AbortSignal))
    expect(atlasMock.create).not.toHaveBeenCalled()
    expect(scene.children).toHaveLength(1)
    renderer.dispose()
    expect(backend.dispose).toHaveBeenCalledOnce()
  })

  it('prevents a slow custom backend prepare from publishing stale items', async () => {
    const prepare = deferred<void>()
    const staleAtlas = atlas(1)
    const latestAtlas = atlas(2)
    const backend: CardAtlasBackend = {
      prepare: vi.fn(() => prepare.promise),
      build: vi.fn(async (items) => ({
        atlas: items.length === 1 ? staleAtlas.result : latestAtlas.result,
      })),
      patch: vi.fn(),
      applyPatch: vi.fn(() => 0),
      advanceUploads: vi.fn((_, nextLayer) => [nextLayer, false] as const),
      clearPatchQueue: vi.fn(),
      dispose: vi.fn(),
    }
    const renderer = new InstancedCardRenderer(new Scene(), { atlasBackend: backend })
    const stale = renderer.setItems([{ id: 'stale' }])
    const latestItems = [{ id: 'latest-a' }, { id: 'latest-b' }]
    const latest = renderer.setItems(latestItems)

    prepare.resolve()
    await expect(latest).resolves.toBe(true)
    await expect(stale).resolves.toBe(false)

    expect(backend.prepare).toHaveBeenCalledOnce()
    expect(renderer.getStats().instanceCount).toBe(2)
    expect(staleAtlas.dispose).toHaveBeenCalledOnce()
    renderer.dispose()
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
    expect(pendingAtlas.dispose).not.toHaveBeenCalled()
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
      metrics: {
        textureBytes: 87_382,
        atlasBuilds: 1,
        atlasPatches: 0,
        atlasCellsUpdated: 1,
        atlasPrepareMs: 0.5,
        atlasImageLoadWallMs: 1,
        atlasCellRenderMs: 2,
        atlasReadbackMs: 0.5,
        imageRequests: 1,
        estimatedTextureUploadBytes: 65_536,
      },
    })
    expect(renderer.getStats().gpuBytes).toBeGreaterThan(87_382)
    renderer.capabilities.resourceRecovery?.refreshResources()
    expect(currentAtlas.texture.needsUpdate).toBe(true)
    renderer.dispose()
  })

  it('prewarms each accepted atlas texture and repeats preparation after context recovery', async () => {
    const currentAtlas = atlas(1)
    atlasMock.create.mockResolvedValueOnce(currentAtlas.result)
    const prepareTexture = vi.fn(() => 3)
    const renderer = new InstancedCardRenderer(new Scene(), { prepareTexture })

    expect(await renderer.setItems([{ id: 'prewarm' }])).toBe(true)
    renderer.capabilities.resourceRecovery?.refreshResources()

    expect(prepareTexture).toHaveBeenCalledTimes(2)
    expect(prepareTexture).toHaveBeenCalledWith(currentAtlas.result.texture)
    expect(renderer.getStats().metrics).toMatchObject({
      atlasTexturePrewarms: 2,
      atlasTexturePrewarmMs: 6,
      atlasTexturePrewarmFailures: 0,
    })
    renderer.dispose()
  })

  it('falls back to visible-frame upload when texture prewarming fails', async () => {
    const currentAtlas = atlas(1)
    atlasMock.create.mockResolvedValueOnce(currentAtlas.result)
    const renderer = new InstancedCardRenderer(new Scene(), {
      prepareTexture: () => { throw new Error('upload failed') },
    })

    expect(await renderer.setItems([{ id: 'fallback-upload' }])).toBe(true)
    expect(renderer.getStats().metrics).toMatchObject({
      atlasTexturePrewarms: 0,
      atlasTexturePrewarmFailures: 1,
    })
    renderer.dispose()
  })

  it('skips automatic texture prewarming for atlases above the long-frame threshold', async () => {
    const currentAtlas = atlas(2000)
    currentAtlas.result.data = new Uint8Array(16 * 1024 * 1024 + 1)
    atlasMock.create.mockResolvedValueOnce(currentAtlas.result)
    const prepareTexture = vi.fn(() => 3)
    const renderer = new InstancedCardRenderer(new Scene(), { prepareTexture })

    expect(await renderer.setItems([{ id: 'large-atlas' }])).toBe(true)

    expect(prepareTexture).not.toHaveBeenCalled()
    expect(renderer.getStats().metrics).toMatchObject({
      atlasTexturePrewarms: 0,
      atlasTexturePrewarmSkips: 1,
    })
    renderer.dispose()
  })

  it('allows explicit texture prewarming above the automatic threshold', async () => {
    const currentAtlas = atlas(2000)
    currentAtlas.result.data = new Uint8Array(16 * 1024 * 1024 + 1)
    atlasMock.create.mockResolvedValueOnce(currentAtlas.result)
    const prepareTexture = vi.fn(() => 3)
    const renderer = new InstancedCardRenderer(new Scene(), {
      prepareTexture,
      texturePrewarm: true,
    })

    expect(await renderer.setItems([{ id: 'forced-prewarm' }])).toBe(true)

    expect(prepareTexture).toHaveBeenCalledOnce()
    expect(renderer.getStats().metrics).toMatchObject({
      atlasTexturePrewarms: 1,
      atlasTexturePrewarmSkips: 0,
    })
    renderer.dispose()
  })

  it('reuses mesh, material, geometry, and transition attributes within a capacity bucket', async () => {
    const firstAtlas = atlas(3)
    const secondAtlas = atlas(4)
    atlasMock.create.mockResolvedValueOnce(firstAtlas.result).mockResolvedValueOnce(secondAtlas.result)
    const scene = new Scene()
    const renderer = new InstancedCardRenderer(scene)
    await renderer.setItems([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
    const mesh = scene.children[0] as Mesh<InstancedBufferGeometry, ShaderMaterial>
    const geometry = mesh.geometry
    const material = mesh.material
    const fromPosition = geometry.getAttribute('fromPosition')

    await renderer.setItems([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }])
    renderer.prepareTransition(
      new TransformBuffer().copyFrom(Array.from({ length: 4 }, () => ({
        x: 0, y: 0, z: 0, scale: 1,
        rotationX: 0, rotationY: 0, rotationZ: 0, opacity: 1,
      }))),
      new TransformBuffer().copyFrom(Array.from({ length: 4 }, () => ({
        x: 1, y: 0, z: 0, scale: 1,
        rotationX: 0, rotationY: 0, rotationZ: 0, opacity: 1,
      }))),
    )

    expect(scene.children[0]).toBe(mesh)
    expect(mesh.geometry).toBe(geometry)
    expect(mesh.material).toBe(material)
    expect(geometry.getAttribute('fromPosition')).toBe(fromPosition)
    expect(firstAtlas.dispose).toHaveBeenCalledOnce()
    expect(renderer.getStats()).toMatchObject({
      instanceCount: 4,
      metrics: {
        capacity: 4,
        geometryBuilds: 1,
      },
    })
    renderer.dispose()
  })

  it('uploads TransformBuffer transitions without materializing Transform objects', async () => {
    atlasMock.create.mockResolvedValueOnce(atlas(2).result)
    const scene = new Scene()
    const renderer = new InstancedCardRenderer(scene)
    await renderer.setItems([{ id: 'a' }, { id: 'b' }])
    const from = new TransformBuffer(2)
      .setValues(0, 1, 2, 3, 0.5, 0, 0, 0, 0.4)
      .setValues(1, 4, 5, 6, 0.75, 0, 0, 0, 0.8)
    const to = new TransformBuffer(2)
      .setValues(0, 7, 8, 9, 1, 0, 0, 0, 1)
      .setValues(1, 10, 11, 12, 1.25, 0, 0, 0, 0.9)

    renderer.prepareTransition(from, to)

    const geometry = (scene.children[0] as Mesh<InstancedBufferGeometry>).geometry
    expect(Array.from(geometry.getAttribute('fromPosition').array).slice(0, 6))
      .toEqual([1, 2, 3, 4, 5, 6])
    expect(Array.from(geometry.getAttribute('toPosition').array).slice(0, 6))
      .toEqual([7, 8, 9, 10, 11, 12])
    expect(Array.from(geometry.getAttribute('toScale').array).slice(0, 2))
      .toEqual([1, 1.25])
    renderer.dispose()
  })

  it('normalizes shared plane geometry to the configured card aspect ratio', async () => {
    const currentAtlas = atlas(1)
    atlasMock.create.mockResolvedValueOnce(currentAtlas.result)
    const scene = new Scene()
    const renderer = new InstancedCardRenderer(scene, { aspectRatio: 4 })

    await renderer.setItems([{ id: 'wide' }])

    expect(Object.keys(renderer.capabilities).sort()).toEqual([
      'frame',
      'highlight',
      'patch',
      'resourcePreparation',
      'resourceRecovery',
      'streamingEffects',
      'viewport',
      'visual',
    ])
    expect(renderer.descriptor.itemBounds).toEqual({
      kind: 'quad',
      width: 1,
      height: 0.25,
      facing: 'layout',
    })
    const mesh = scene.children[0] as Mesh<InstancedBufferGeometry, ShaderMaterial>
    const positions = Array.from(mesh.geometry.getAttribute('position').array)
    const xs = positions.filter((_value, index) => index % 3 === 0)
    const ys = positions.filter((_value, index) => index % 3 === 1)
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(1)
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(0.25)
    expect(mesh.material.glslVersion).toBeNull()
    expect(mesh.material.fragmentShader).not.toContain('sampler2DArray')
    expect(mesh.material.vertexShader).not.toContain('uLayers')
    expect(atlasMock.create.mock.calls[0][2]).toMatchObject({ aspectRatio: 4 })
    expect(scene.children).toHaveLength(1)
    renderer.dispose()
  })

  it('uses one sampler2DArray material and stable layer attributes for array atlases', async () => {
    const currentAtlas = atlas(17)
    const arrayResult = currentAtlas.result as TextureAtlasResult
    const texture = new DataArrayTexture(new Uint8Array(8 * 8 * 2 * 4), 8, 8, 2)
    arrayResult.texture = texture
    arrayResult.mode = 'array'
    arrayResult.width = 8
    arrayResult.height = 8
    arrayResult.depth = 2
    arrayResult.data = texture.image.data as Uint8Array<ArrayBuffer>
    arrayResult.columns = 4
    arrayResult.rows = 4
    arrayResult.mipmaps = false
    atlasMock.create.mockResolvedValueOnce(arrayResult)
    const scene = new Scene()
    const renderer = new InstancedCardRenderer(scene, { atlasMode: 'array' })

    await renderer.setItems(Array.from({ length: 17 }, (_value, index) => ({
      id: String(index),
    })))

    const mesh = scene.children[0] as Mesh<InstancedBufferGeometry, ShaderMaterial>
    expect(mesh.material.glslVersion).toBe(GLSL3)
    expect(mesh.material.fragmentShader).toContain('sampler2DArray')
    expect(mesh.geometry.getAttribute('atlasLayer')).toBeUndefined()
    expect(Array.from(mesh.geometry.getAttribute('atlasRect').array).slice(64, 68))
      .toEqual(Array.from(arrayResult.rects.slice(64, 68)))
    expect(renderer.getStats().metrics).toMatchObject({
      atlasMode: 1,
      atlasLayers: 2,
      atlasMipmaps: 0,
    })
    renderer.dispose()
  })

  it('uploads array atlas layers in bounded Stage-frame batches', async () => {
    const currentAtlas = atlas(32)
    const arrayResult = currentAtlas.result as TextureAtlasResult
    const texture = new DataArrayTexture(
      new Uint8Array(256 * 256 * 20 * 4),
      256,
      256,
      20,
    )
    arrayResult.texture = texture
    arrayResult.mode = 'array'
    arrayResult.width = 256
    arrayResult.height = 256
    arrayResult.depth = 20
    arrayResult.data = texture.image.data as Uint8Array<ArrayBuffer>
    arrayResult.columns = 4
    arrayResult.rows = 4
    arrayResult.mipmaps = false
    atlasMock.create.mockResolvedValueOnce(arrayResult)
    const scene = new Scene()
    const renderer = new InstancedCardRenderer(scene, { atlasMode: 'array' })
    await renderer.setItems(Array.from({ length: 32 }, (_value, index) => ({
      id: String(index),
    })))
    const mesh = scene.children[0] as Mesh<InstancedBufferGeometry, ShaderMaterial>

    expect(texture.layerUpdates).toEqual(new Set(
      Array.from({ length: 12 }, (_value, index) => index),
    ))
    renderer.capabilities.frame?.update(1 / 60)
    expect(renderer.getStats().metrics).toMatchObject({
      uploadedLayers: 12,
      pendingLayers: 8,
      layerUploadFrames: 0,
    })
    texture.layerUpdates.clear()
    renderer.capabilities.frame?.update(1 / 60)

    expect(texture.layerUpdates).toEqual(new Set([12, 13, 14, 15, 16, 17]))
    expect(mesh.material.uniforms.uLayers.value).toBe(18)
    expect(renderer.getStats().metrics).toMatchObject({
      uploadedLayers: 18,
      pendingLayers: 2,
      layerUploadFrames: 1,
      arrayUploadBudgetBytes: 1_572_864,
      arrayUploadPeakBudgetBytes: 1_572_864,
      arrayUploadBackoffs: 0,
    })
    renderer.capabilities.frame?.update(1 / 60)
    expect(mesh.material.uniforms.uLayers.value).toBe(20)
    texture.layerUpdates.clear()
    renderer.capabilities.resourceRecovery?.refreshResources()
    expect(texture.layerUpdates).toEqual(new Set(
      Array.from({ length: 12 }, (_value, index) => index),
    ))
    expect(mesh.material.uniforms.uLayers.value).toBe(12)
    renderer.dispose()
  })

  it('coordinates array patches through the bounded layer uploader', async () => {
    const currentAtlas = atlas(32)
    const arrayResult = currentAtlas.result as TextureAtlasResult
    const texture = new DataArrayTexture(
      new Uint8Array(256 * 256 * 20 * 4),
      256,
      256,
      20,
    )
    arrayResult.texture = texture
    arrayResult.mode = 'array'
    arrayResult.width = 256
    arrayResult.height = 256
    arrayResult.depth = 20
    arrayResult.data = texture.image.data as Uint8Array<ArrayBuffer>
    arrayResult.columns = 4
    arrayResult.rows = 4
    arrayResult.mipmaps = false
    const patch = {
      cells: [
        { index: 16, canvas: {} as HTMLCanvasElement },
        { index: 16, canvas: {} as HTMLCanvasElement },
        { index: 240, canvas: {} as HTMLCanvasElement },
      ],
      metrics: {
        cells: 1,
        renderMs: 1,
        prepareMs: 0,
        imageLoadWallMs: 0,
        cellRenderMs: 1,
        applyMs: 0,
        readbackMs: 0,
        imageLoadMs: 0,
        imageRequests: 0,
        imageFailures: 0,
        uploadBytes: 0,
      },
    } satisfies TextureAtlasPatch
    atlasMock.create.mockResolvedValueOnce(arrayResult)
    atlasMock.createPatch.mockResolvedValue(patch)
    let patchApplications = 0
    atlasMock.applyPatch.mockImplementation((
      _atlas: TextureAtlasResult,
      appliedPatch: TextureAtlasPatch,
      visibleLayers: number,
    ) => {
      expect(visibleLayers).toBe(12)
      appliedPatch.metrics.uploadRanges = patchApplications === 0 ? 1 : 0
      appliedPatch.metrics.uploadBytes = patchApplications === 0 ? 256 * 256 * 4 : 0
      patchApplications += 1
      return 1
    })
    const renderer = new InstancedCardRenderer(new Scene(), { atlasMode: 'array' })
    const items = Array.from({ length: 32 }, (_value, index) => ({
      id: String(index),
    }))
    await renderer.setItems(items)
    renderer.capabilities.frame?.update(1 / 60)
    texture.layerUpdates.clear()

    await renderer.updateItems(
      items.map((item, index) => index === 0 ? { ...item, title: 'first' } : item),
      [0],
    )
    await renderer.updateItems(
      items.map((item, index) => index === 0 ? { ...item, title: 'second' } : item),
      [0],
    )
    atlasMock.advanceUploads.mockImplementationOnce((
      atlas: TextureAtlasResult,
    ) => {
      if ('addLayerUpdate' in atlas.texture) {
        const texture = atlas.texture
        ;[1, 12, 13].forEach((layer) => texture.addLayerUpdate(layer))
      }
      return [14, true]
    })
    renderer.capabilities.frame?.update(1 / 60)

    expect(texture.layerUpdates).toEqual(new Set([1, 12, 13]))
    expect(renderer.getStats().metrics).toMatchObject({
      uploadedLayers: 14,
      atlasUploadRanges: 1,
      estimatedTextureUploadBytes: (
        arrayResult.metrics.uploadBytes
        + 256 * 256 * 4
      ),
    })
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

  it('loads and caches every built-in effect through independent Program modules', async () => {
    const currentAtlas = atlas(2)
    atlasMock.create.mockResolvedValueOnce(currentAtlas.result)
    const scene = new Scene()
    const renderer = new InstancedCardRenderer(scene)
    await renderer.setItems([{ id: 'a' }, { id: 'b' }])
    const parameters = Float32Array.from({ length: 12 }, (_, index) => index + 1)
    const mesh = scene.children[0] as Mesh<InstancedBufferGeometry, ShaderMaterial>
    const effects = [
      ['tunnel', 'program_tunnel_'],
      ['linear-shooter', 'program_shooter_'],
      ['vortex', 'program_vortex_'],
      ['radial-burst', 'program_radial_'],
    ] as const
    for (const [kind, prefix] of effects) {
      await expect(renderer.enableEffect({
        kind,
        activeCount: 1,
        payload: {
          paths: new Float32Array(8),
          speedFactors: new Float32Array([1, -1]),
          parameters,
        },
      })).resolves.toBe(true)
      expect(mesh.geometry.getAttribute(`${prefix}path`).itemSize).toBe(4)
      expect(mesh.geometry.getAttribute(`${prefix}speed`).count).toBe(2)
      expect(mesh.material.uniforms[`${prefix}a`].value.toArray()).toEqual([1, 2, 3, 4])
      expect(mesh.material.uniforms[`${prefix}c`].value.toArray()).toEqual([9, 10, 11, 12])
      renderer.setEffectTime(1.25)
      expect(mesh.material.uniforms[`${prefix}time`].value).toBe(1.25)
    }

    expect(Array.from(mesh.geometry.getAttribute('itemIndex').array)).toEqual([0, 1])
    expect(mesh.geometry.instanceCount).toBe(1)
    expect(renderer.getStats()).toMatchObject({ instanceCount: 2, submittedInstanceCount: 1 })
    expect(renderer.getStats().metrics).toMatchObject({
      programLoads: 4,
      programSwitches: 4,
      cachedPrograms: 4,
    })

    renderer.setHoverIndex(1)
    renderer.setProgress(0.6)
    renderer.setVisibleRatio(0.4)
    await renderer.enableEffect({
      kind: 'vortex',
      activeCount: 2,
      payload: {
        paths: new Float32Array(8),
        speedFactors: new Float32Array([1, 1]),
        parameters,
      },
    })
    expect(renderer.getStats().metrics).toMatchObject({
      programLoads: 4,
      programSwitches: 5,
      cachedPrograms: 4,
    })
    expect(mesh.material.uniforms.hoverIndex.value).toBe(1)
    expect(mesh.material.uniforms.progress.value).toBe(0.6)
    expect(mesh.material.uniforms.visibleRatio.value).toBe(0.4)
    renderer.disableEffect()
    expect(mesh.geometry.instanceCount).toBe(2)
    expect(mesh.material.uniforms.hoverIndex.value).toBe(1)
    renderer.setHoverIndex(null)
    expect(mesh.material.uniforms.hoverIndex.value).toBe(-1)
    renderer.dispose()
  })

  it('loads, caches, uploads, and switches a custom effect program', async () => {
    const currentAtlas = atlas(2)
    atlasMock.create.mockResolvedValueOnce(currentAtlas.result)
    const loader = vi.fn(async () => defineCardEffectProgram<Float32Array>({
      kind: 'custom-wave',
      prefix: 'program_wave_',
      attributes: [{ name: 'program_wave_phase', itemSize: 1 }],
      uniforms: [{ name: 'program_wave_time', type: 'float' }],
      clockUniform: 'program_wave_time',
      vertexBody: 'center.y += sin(program_wave_phase + program_wave_time);',
      upload(context, payload) {
        context.setAttribute('program_wave_phase', payload)
        context.setUniform('program_wave_time', 0)
      },
    }))
    const scene = new Scene()
    const renderer = new InstancedCardRenderer(scene, {
      effectPrograms: { 'custom-wave': loader },
    })
    await renderer.setItems([{ id: 'a' }, { id: 'b' }])

    await expect(renderer.enableEffect({
      kind: 'custom-wave',
      activeCount: 2,
      payload: new Float32Array([0.25, 0.5]),
    })).resolves.toBe(true)
    await expect(renderer.enableEffect({
      kind: 'custom-wave',
      activeCount: 1,
      payload: new Float32Array([0.75]),
    })).resolves.toBe(true)

    const mesh = scene.children[0] as Mesh<InstancedBufferGeometry, ShaderMaterial>
    expect(loader).toHaveBeenCalledOnce()
    expect(mesh.geometry.getAttribute('program_wave_phase').array[0]).toBe(0.75)
    expect(renderer.getStats().metrics).toMatchObject({
      programLoads: 1,
      programSwitches: 2,
      cachedPrograms: 1,
    })
    await expect(renderer.enableEffect({
      kind: 'missing',
      activeCount: 1,
      payload: null,
    })).resolves.toBe(false)
    renderer.dispose()
  })

  it('explicitly prewarms resident textures and lazy Programs without activating them', async () => {
    const currentAtlas = atlas(1)
    atlasMock.create.mockResolvedValueOnce(currentAtlas.result)
    const prepareTexture = vi.fn(() => 2)
    const prepareProgram = vi.fn(async () => 3)
    const loader = vi.fn(async () => defineCardEffectProgram<Float32Array>({
      kind: 'prewarm-wave',
      prefix: 'program_prewarm_',
      attributes: [{ name: 'program_prewarm_phase', itemSize: 1 }],
      vertexBody: 'center.y += program_prewarm_phase;',
      upload(context, payload) {
        context.setAttribute('program_prewarm_phase', payload)
      },
    }))
    const scene = new Scene()
    const renderer = new InstancedCardRenderer(scene, {
      effectPrograms: { 'prewarm-wave': loader },
      prepareTexture,
      prepareProgram,
      texturePrewarm: false,
    })
    await renderer.setItems([{ id: 'a' }])

    await expect(renderer.prewarm({
      textures: true,
      programs: ['prewarm-wave'],
    })).resolves.toBe(true)

    const mesh = scene.children[0] as Mesh<InstancedBufferGeometry, ShaderMaterial>
    expect(prepareTexture).toHaveBeenCalledOnce()
    expect(prepareProgram).toHaveBeenCalledOnce()
    expect(loader).toHaveBeenCalledOnce()
    expect(mesh.geometry.getAttribute('program_prewarm_phase')).toBeDefined()
    expect(mesh.material).not.toHaveProperty('uniforms.program_prewarm_phase')
    expect(renderer.getStats().metrics).toMatchObject({ cachedPrograms: 1, programSwitches: 0 })

    await renderer.enableEffect({
      kind: 'prewarm-wave',
      activeCount: 1,
      payload: new Float32Array([0.5]),
    })
    expect(loader).toHaveBeenCalledOnce()
    expect(prepareProgram).toHaveBeenCalledOnce()
    renderer.dispose()
  })

  it('discards a Program whose explicit prewarm finishes after disposal', async () => {
    const currentAtlas = atlas(1)
    const compilation = deferred<number>()
    atlasMock.create.mockResolvedValueOnce(currentAtlas.result)
    const renderer = new InstancedCardRenderer(new Scene(), {
      effectPrograms: {
        delayed: defineCardEffectProgram({
          kind: 'delayed',
          prefix: 'program_delayed_',
          vertexBody: 'center.x += 0.0;',
          upload() {},
        }),
      },
      prepareProgram: () => compilation.promise,
    })
    await renderer.setItems([{ id: 'a' }])

    const result = renderer.prewarm({ programs: ['delayed'] })
    renderer.dispose()
    compilation.resolve(1)

    await expect(result).resolves.toBe(false)
    expect(renderer.getStats().metrics).toMatchObject({ cachedPrograms: 0 })
  })

  it('runs custom Program runtime prepare, restore, update, and disposal hooks', async () => {
    const currentAtlas = atlas(1)
    atlasMock.create.mockResolvedValueOnce(currentAtlas.result)
    const prepare = vi.fn()
    const restore = vi.fn()
    const activate = vi.fn()
    const update = vi.fn()
    const deactivate = vi.fn()
    const dispose = vi.fn()
    const program = defineCardEffectProgram<null>({
      kind: 'runtime-hooks',
      prefix: 'program_runtime_',
      uniforms: [{ name: 'program_runtime_time', type: 'float' }],
      clockUniform: 'program_runtime_time',
      vertexBody: 'center.x += program_runtime_time;',
      createRuntime: () => ({
        prepare,
        restore,
        activate,
        update,
        deactivate,
        dispose,
      }),
      upload() {},
    })
    const renderer = new InstancedCardRenderer(new Scene(), {
      effectPrograms: { 'runtime-hooks': program },
    })
    await renderer.setItems([{ id: 'a' }])

    await expect(renderer.enableEffect({
      kind: 'runtime-hooks',
      activeCount: 1,
      payload: null,
    })).resolves.toBe(true)
    renderer.setEffectTime(2)
    renderer.refreshResources()
    await expect(renderer.enableEffect({
      kind: 'runtime-hooks',
      activeCount: 1,
      payload: null,
    })).resolves.toBe(true)
    renderer.disableEffect()
    renderer.dispose()

    expect(prepare).toHaveBeenCalledOnce()
    expect(restore).toHaveBeenCalledOnce()
    expect(activate).toHaveBeenCalledTimes(2)
    expect(update).toHaveBeenCalledWith(2)
    expect(deactivate).toHaveBeenCalledOnce()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('aborts and disposes a slow Program runtime superseded by a newer effect', async () => {
    const currentAtlas = atlas(1)
    atlasMock.create.mockResolvedValueOnce(currentAtlas.result)
    const gate = deferred<void>()
    let slowSignal: AbortSignal | null = null
    const slowDispose = vi.fn()
    const slow = defineCardEffectProgram<null>({
      kind: 'slow-runtime',
      prefix: 'program_slow_runtime_',
      vertexBody: 'center.x += 0.0;',
      createRuntime: () => ({
        async prepare(context) {
          slowSignal = context.signal
          await gate.promise
        },
        dispose: slowDispose,
      }),
      upload() {},
    })
    const fast = defineCardEffectProgram<null>({
      kind: 'fast-runtime',
      prefix: 'program_fast_runtime_',
      vertexBody: 'center.x += 1.0;',
      upload() {},
    })
    const renderer = new InstancedCardRenderer(new Scene(), {
      effectPrograms: {
        'slow-runtime': slow,
        'fast-runtime': fast,
      },
    })
    await renderer.setItems([{ id: 'a' }])

    const pending = renderer.enableEffect({
      kind: 'slow-runtime',
      activeCount: 1,
      payload: null,
    })
    await vi.waitFor(() => expect(slowSignal).not.toBeNull())
    await expect(renderer.enableEffect({
      kind: 'fast-runtime',
      activeCount: 1,
      payload: null,
    })).resolves.toBe(true)
    gate.resolve()

    await expect(pending).resolves.toBe(false)
    expect((slowSignal as AbortSignal | null)?.aborted).toBe(true)
    expect(slowDispose).toHaveBeenCalledOnce()
    renderer.dispose()
  })

  it('uploads a custom motion Program through the common layout pipeline', async () => {
    const currentAtlas = atlas(2)
    atlasMock.create.mockResolvedValueOnce(currentAtlas.result)
    const motionProgram = defineCardMotionProgram<{ offset: number }>({
      kind: 'business-offset',
      prefix: 'program_offset_',
      attributes: [{ name: 'program_offset_value', itemSize: 1 }],
      vertexBody: 'center.y += program_offset_value;',
      upload(context, items) {
        context.setAttribute(
          'program_offset_value',
          Float32Array.from(items, ({ meta }) => meta?.offset ?? 0),
        )
      },
    })
    const scene = new Scene()
    const renderer = new InstancedCardRenderer(scene, { motionProgram })
    await renderer.setItems([
      { id: 'a', meta: { offset: 2 } },
      { id: 'b', meta: { offset: -1 } },
    ])

    const mesh = scene.children[0] as Mesh<InstancedBufferGeometry, ShaderMaterial>
    expect(Array.from(mesh.geometry.getAttribute('program_offset_value').array).slice(0, 2))
      .toEqual([2, -1])
    expect(mesh.material.vertexShader).toContain('center.y += program_offset_value;')
    renderer.dispose()
  })

  it('does not let a slow Program replace a newer effect material', async () => {
    const currentAtlas = atlas(1)
    atlasMock.create.mockResolvedValueOnce(currentAtlas.result)
    const slowProgram = deferred<CardEffectProgram<null>>()
    const define = (kind: string, marker: string) => defineCardEffectProgram<null>({
      kind,
      prefix: `program_${kind}_`,
      vertexBody: `center.x += 0.0; // ${marker}`,
      upload() {},
    })
    const fast = define('fast', 'FAST_PROGRAM')
    const scene = new Scene()
    const renderer = new InstancedCardRenderer(scene, {
      effectPrograms: {
        slow: () => slowProgram.promise,
        fast,
      },
    })
    await renderer.setItems([{ id: 'a' }])

    const slow = renderer.enableEffect({ kind: 'slow', activeCount: 1, payload: null })
    await expect(renderer.enableEffect({
      kind: 'fast',
      activeCount: 1,
      payload: null,
    })).resolves.toBe(true)
    slowProgram.resolve(define('slow', 'SLOW_PROGRAM'))
    await expect(slow).resolves.toBe(false)

    const mesh = scene.children[0] as Mesh<InstancedBufferGeometry, ShaderMaterial>
    expect(mesh.material.vertexShader).toContain('FAST_PROGRAM')
    expect(mesh.material.vertexShader).not.toContain('SLOW_PROGRAM')
    renderer.dispose()
  })

  it('retries a Program loader after a transient failure', async () => {
    const currentAtlas = atlas(1)
    atlasMock.create.mockResolvedValueOnce(currentAtlas.result)
    const program = defineCardEffectProgram<null>({
      kind: 'retryable',
      prefix: 'program_retryable_',
      vertexBody: 'center.x += 0.0;',
      upload() {},
    })
    const loader = vi.fn()
      .mockRejectedValueOnce(new Error('temporary chunk failure'))
      .mockResolvedValueOnce(program)
    const renderer = new InstancedCardRenderer(new Scene(), {
      effectPrograms: { retryable: loader },
    })
    await renderer.setItems([{ id: 'a' }])

    await expect(renderer.enableEffect({
      kind: 'retryable',
      activeCount: 1,
      payload: null,
    })).rejects.toThrow('temporary chunk failure')
    await expect(renderer.enableEffect({
      kind: 'retryable',
      activeCount: 1,
      payload: null,
    })).resolves.toBe(true)

    expect(loader).toHaveBeenCalledTimes(2)
    expect(renderer.getStats().metrics).toMatchObject({
      programLoads: 2,
      programFailures: 1,
      cachedPrograms: 1,
    })
    renderer.dispose()
  })

  it('releases a newly prepared Program runtime when payload upload fails', async () => {
    const currentAtlas = atlas(1)
    atlasMock.create.mockResolvedValueOnce(currentAtlas.result)
    const broken = defineCardEffectProgram<null>({
      kind: 'broken',
      prefix: 'program_broken_',
      vertexBody: 'center.x += 0.0;',
      upload() {
        throw new Error('upload failed')
      },
    })
    const scene = new Scene()
    const renderer = new InstancedCardRenderer(scene, {
      effectPrograms: { broken },
    })
    await renderer.setItems([{ id: 'a' }])
    const baseMaterial = (scene.children[0] as Mesh<InstancedBufferGeometry, ShaderMaterial>).material

    await expect(renderer.enableEffect({
      kind: 'broken',
      activeCount: 1,
      payload: null,
    })).rejects.toThrow('upload failed')
    const mesh = scene.children[0] as Mesh<InstancedBufferGeometry, ShaderMaterial>
    expect(mesh.material).toBe(baseMaterial)
    expect(renderer.getStats().metrics).toMatchObject({
      programFailures: 1,
      cachedPrograms: 0,
    })
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

    renderer.prepareTransition(
      new TransformBuffer().copyFrom([transform]),
      new TransformBuffer().copyFrom([transform]),
    )
    renderer.prepareVisualTransition(
      { billboard: 0, hideBackHemisphere: 0, hemisphereEdgeFade: 0.05 },
      { billboard: 1, hideBackHemisphere: 1, hemisphereEdgeFade: 0.1 },
    )
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
        prepareMs: 0,
        imageLoadWallMs: 0,
        cellRenderMs: 0,
        applyMs: 0,
        readbackMs: 0,
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
      metrics: {
        atlasBuilds: 1,
        atlasPatches: 1,
        atlasDiscardedPatches: 1,
      },
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
        prepareMs: 0,
        imageLoadWallMs: 0,
        cellRenderMs: 1,
        applyMs: 0,
        readbackMs: 0,
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

  it('fingerprints only changed items during a large partial update', async () => {
    const itemCount = 2000
    const currentAtlas = atlas(itemCount)
    const patch = {
      cells: [],
      metrics: {
        cells: 1,
        renderMs: 1,
        prepareMs: 0,
        imageLoadWallMs: 0,
        cellRenderMs: 1,
        applyMs: 0,
        readbackMs: 0,
        imageLoadMs: 0,
        imageRequests: 0,
        imageFailures: 0,
        uploadBytes: 0,
      },
    }
    const resolveCardStyle = vi.fn((item: { meta?: { winner?: boolean } }) =>
      item.meta?.winner ? { borderColor: '#ffd700' } : undefined)
    const items = Array.from({ length: itemCount }, (_value, index) => ({
      id: `item-${index}`,
      meta: { winner: false },
    }))
    atlasMock.create.mockResolvedValueOnce(currentAtlas.result)
    atlasMock.createPatch.mockResolvedValueOnce(patch)
    const renderer = new InstancedCardRenderer(new Scene(), { resolveCardStyle })
    await renderer.setItems(items)
    resolveCardStyle.mockClear()
    const updated = items.slice()
    updated[123] = { ...updated[123], meta: { winner: true } }

    expect(await renderer.updateItems(updated, [123, 123, -1, itemCount])).toBe(true)

    expect(resolveCardStyle).toHaveBeenCalledOnce()
    expect(atlasMock.createPatch.mock.calls[0][1]).toEqual([123])
    expect(renderer.getStats().metrics).toBeDefined()
    renderer.dispose()
  })

  it('reuses a patch workspace across sequential updates', async () => {
    const currentAtlas = atlas(2)
    const patch = {
      cells: [],
      metrics: {
        cells: 1,
        renderMs: 1,
        prepareMs: 0,
        imageLoadWallMs: 0,
        cellRenderMs: 1,
        applyMs: 0,
        readbackMs: 0,
        imageLoadMs: 0,
        imageRequests: 0,
        imageFailures: 0,
        uploadBytes: 0,
      },
    }
    atlasMock.create.mockResolvedValueOnce(currentAtlas.result)
    atlasMock.createPatch.mockResolvedValue(patch)
    const renderer = new InstancedCardRenderer(new Scene())
    await renderer.setItems([{ id: 'a' }, { id: 'b' }])

    await renderer.updateItems([{ id: 'a', title: 'one' }, { id: 'b' }], [0])
    await renderer.updateItems([{ id: 'a', title: 'two' }, { id: 'b' }], [0])

    expect(atlasMock.createPatch).toHaveBeenCalledTimes(2)
    renderer.dispose()
  })

  it('uses a stable content key instead of serializing style for patches', async () => {
    const currentAtlas = atlas(1)
    const patch = {
      cells: [],
      metrics: {
        cells: 1,
        renderMs: 1,
        prepareMs: 0,
        imageLoadWallMs: 0,
        cellRenderMs: 1,
        applyMs: 0,
        readbackMs: 0,
        imageLoadMs: 0,
        imageRequests: 0,
        imageFailures: 0,
        uploadBytes: 0,
      },
    }
    const resolveContentKey = vi.fn((item: { meta?: { revision?: number } }) =>
      item.meta?.revision ?? 0)
    const resolveCardStyle = vi.fn(() => ({ borderColor: '#ffd700' }))
    atlasMock.create.mockResolvedValueOnce(currentAtlas.result)
    atlasMock.createPatch.mockResolvedValueOnce(patch)
    const renderer = new InstancedCardRenderer(new Scene(), {
      resolveContentKey,
      resolveCardStyle,
    })
    await renderer.setItems([{ id: 'a', meta: { revision: 0 } }])
    resolveContentKey.mockClear()
    resolveCardStyle.mockClear()

    const changed = [{ id: 'a', meta: { revision: 1 } }]
    expect(await renderer.updateItems(changed, [0])).toBe(true)
    expect(await renderer.updateItems([{ id: 'a', meta: { revision: 1 } }], [0])).toBe(true)

    expect(resolveContentKey).toHaveBeenCalledTimes(2)
    expect(resolveCardStyle).not.toHaveBeenCalled()
    expect(atlasMock.createPatch).toHaveBeenCalledOnce()
    renderer.dispose()
  })
})
