// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LinearFilter } from 'three'
import type { TextureAtlasResult } from './textureAtlas'
import {
  applyTextureAtlasPatch,
  createTextureAtlas,
  createTextureAtlasPatch,
  resolveAtlasMetrics,
  TextureAtlasImageCache,
} from './textureAtlas'

const contexts = new WeakMap<HTMLCanvasElement, ReturnType<typeof createContext>>()

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

function createContext() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    arc: vi.fn(),
    rect: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    fill: vi.fn(),
    clip: vi.fn(),
    stroke: vi.fn(),
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    getImageData: vi.fn((_x: number, _y: number, width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4),
      width,
      height,
      colorSpace: 'srgb',
    })),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: text.length * 6 })),
    roundRect: vi.fn(),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
  }
}

describe('texture atlas card rendering', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      let context = contexts.get(this)
      if (!context) {
        context = createContext()
        contexts.set(this, context)
      }
      return context as unknown as CanvasRenderingContext2D
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('clamps atlas resolution to the GPU texture limit and enables mipmapped sampling', async () => {
    expect(resolveAtlasMetrics(2000, 128, 2048)).toEqual({
      columns: 45,
      rows: 45,
      cellSize: 37,
      cellWidth: 37,
      cellHeight: 37,
      padding: 4,
      stride: 45,
      strideX: 45,
      strideY: 45,
    })

    const atlas = await createTextureAtlas([{ id: 'one' }], 96, {
      maxTextureSize: 64,
      anisotropy: 4,
    })
    expect(atlas).toMatchObject({ width: 64, height: 64, cellSize: 56, padding: 4 })
    expect(atlas.texture.generateMipmaps).toBe(true)
    expect(atlas.texture.anisotropy).toBe(4)
    expect(atlas.mode).toBe('single')
    expect('isDataTexture' in atlas.texture && atlas.texture.isDataTexture).toBe(true)
    expect(atlas.data).toHaveLength(64 * 64 * 4)
    expect(atlas.metrics.uploadBytes).toBe(64 * 64 * 4)
    atlas.texture.dispose()
  })

  it('supports a non-mipmapped atlas for upload-sensitive consumers', async () => {
    const atlas = await createTextureAtlas([{ id: 'one' }], 64, { mipmaps: false })

    expect(atlas.mipmaps).toBe(false)
    expect(atlas.texture.generateMipmaps).toBe(false)
    expect(atlas.texture.minFilter).toBe(LinearFilter)
    atlas.texture.dispose()
  })

  it('packs an experimental array atlas within the available layer limit', async () => {
    const items = Array.from({ length: 17 }, (_value, index) => ({ id: String(index) }))
    const atlas = await createTextureAtlas(items, 32, {
      atlasMode: 'array',
      maxTextureLayers: 2,
    })

    expect(atlas).toMatchObject({
      mode: 'array',
      depth: 2,
      columns: 3,
      rows: 3,
      mipmaps: false,
    })
    expect('isDataArrayTexture' in atlas.texture && atlas.texture.isDataArrayTexture).toBe(true)
    expect(Math.floor(atlas.rects[8 * 4])).toBe(0)
    expect(Math.floor(atlas.rects[9 * 4])).toBe(1)
    expect(atlas.metrics.arrayPackMs).toBeGreaterThanOrEqual(0)
    atlas.texture.dispose()

    const singleLayer = await createTextureAtlas(items, 32, {
      atlasMode: 'array',
      maxTextureLayers: 1,
    })
    expect(singleLayer).toMatchObject({ mode: 'array', depth: 1, mipmaps: false })
    singleLayer.texture.dispose()

    const capped = await createTextureAtlas(
      Array.from({ length: 257 }, (_value, index) => ({ id: String(index) })),
      8,
      { atlasMode: 'array', maxTextureLayers: 256 },
    )
    expect(capped).toMatchObject({
      mode: 'array',
      depth: 129,
      columns: 1,
      rows: 2,
    })
    capped.texture.dispose()
  })

  it('selects an array atlas automatically only for large non-mipmapped uploads', async () => {
    const smallItems = Array.from({ length: 500 }, (_value, index) => ({ id: String(index) }))
    const small = await createTextureAtlas(smallItems, 64, {
      atlasMode: 'auto',
      mipmaps: false,
      maxTextureLayers: 256,
    })
    expect(small.mode).toBe('single')
    small.texture.dispose()

    const largeItems = Array.from({ length: 1000 }, (_value, index) => ({ id: String(index) }))
    const mipmapped = await createTextureAtlas(largeItems, 64, {
      atlasMode: 'auto',
      mipmaps: true,
      maxTextureLayers: 256,
    })
    expect(mipmapped.mode).toBe('single')
    mipmapped.texture.dispose()

    const uploadSensitive = await createTextureAtlas(largeItems, 64, {
      atlasMode: 'auto',
      mipmaps: false,
      maxTextureLayers: 256,
    })
    expect(uploadSensitive.mode).toBe('array')
    uploadSensitive.texture.dispose()
  })

  it('reuses the atlas canvas pixel buffer without a second full-size copy', async () => {
    const originalCreateElement = document.createElement.bind(document)
    const createElement = vi.spyOn(document, 'createElement').mockImplementation(
      ((tagName: string, options?: ElementCreationOptions) => (
        originalCreateElement(tagName, options)
      )) as typeof document.createElement,
    )
    let atlasPixels: Uint8ClampedArray | undefined
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockImplementation(function (
      this: HTMLCanvasElement,
    ) {
      let context = contexts.get(this)
      if (!context) {
        context = createContext()
        context.getImageData.mockImplementation((_x, _y, width, height) => ({
          data: (() => {
            const pixels = new Uint8ClampedArray(width * height * 4).fill(7)
            if (this.width > 64) atlasPixels = pixels
            return pixels
          })(),
          width,
          height,
          colorSpace: 'srgb',
        }))
        contexts.set(this, context)
      }
      return context as unknown as CanvasRenderingContext2D
    })

    const atlas = await createTextureAtlas([{ id: 'a' }, { id: 'b' }], 64)
    const canvasCreations = createElement.mock.calls.filter(([tagName]) => tagName === 'canvas')

    expect(canvasCreations).toHaveLength(1)
    expect(atlas.metrics.cells).toBe(2)
    expect(atlas.data).toBe(atlasPixels)
    expect(atlas.data).toBeInstanceOf(Uint8ClampedArray)
    atlas.texture.dispose()

    const drawCard = vi.fn()
    const customAtlas = await createTextureAtlas([{ id: 'a' }, { id: 'b' }], 64, { drawCard })
    expect(createElement.mock.calls.filter(([tagName]) => tagName === 'canvas')).toHaveLength(4)
    expect(drawCard).toHaveBeenCalledTimes(2)
    customAtlas.texture.dispose()
  })

  it('moves the image-free built-in atlas raster and readback into an OffscreenCanvas worker', async () => {
    const workers: TestWorker[] = []
    class TestWorker {
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: (() => void) | null = null
      terminate = vi.fn()
      postMessage = vi.fn((request: { width: number; height: number }) => {
        const pixels = new Uint8ClampedArray(request.width * request.height * 4).fill(11)
        queueMicrotask(() => this.onmessage?.({
          data: {
            data: pixels.buffer,
            cellRenderMs: 3,
            readbackMs: 2,
          },
        } as MessageEvent))
      })
      constructor() {
        workers.push(this)
      }
    }
    vi.stubGlobal('Worker', TestWorker)
    vi.stubGlobal('OffscreenCanvas', class {})
    const createElement = vi.spyOn(document, 'createElement')

    const items = Array.from({ length: 256 }, (_, index) => ({
      id: `item-${index}`,
      title: `Item ${index}`,
    }))
    const atlas = await createTextureAtlas(items, 32)

    expect(workers).toHaveLength(1)
    expect(workers[0].postMessage).toHaveBeenCalledWith(expect.objectContaining({
      items: expect.arrayContaining([
        expect.objectContaining({ id: 'item-0', title: 'Item 0' }),
        expect.objectContaining({ id: 'item-255', title: 'Item 255' }),
      ]),
    }), [])
    expect(workers[0].terminate).toHaveBeenCalledOnce()
    expect(createElement).not.toHaveBeenCalledWith('canvas')
    expect(atlas.data.every((value) => value === 11)).toBe(true)
    expect(atlas.metrics).toMatchObject({
      cells: 256,
      cellRenderMs: 3,
      readbackMs: 2,
      imageRequests: 0,
      uploadRanges: 1,
      workerRenders: 1,
    })
    atlas.texture.dispose()
  })

  it('deduplicates image bitmaps and transfers them to the atlas worker', async () => {
    const images: ImmediateImage[] = []
    class ImmediateImage {
      crossOrigin = ''
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      naturalWidth = 64
      naturalHeight = 64
      private value = ''
      constructor() { images.push(this) }
      get src() { return this.value }
      set src(value: string) {
        this.value = value
        if (value) queueMicrotask(() => this.onload?.())
      }
    }
    const bitmaps: ImageBitmap[] = []
    const createBitmap = vi.fn(async () => {
      const bitmap = {
        width: 64,
        height: 64,
        close: vi.fn(),
      } as unknown as ImageBitmap
      bitmaps.push(bitmap)
      return bitmap
    })
    const workers: ImageWorker[] = []
    class ImageWorker {
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: (() => void) | null = null
      terminate = vi.fn()
      constructor() { workers.push(this) }
      postMessage = vi.fn((
        request: { width: number; height: number },
        _transfer: Transferable[],
      ) => {
        const pixels = new Uint8ClampedArray(request.width * request.height * 4)
        queueMicrotask(() => this.onmessage?.({
          data: { data: pixels.buffer, cellRenderMs: 4, readbackMs: 2 },
        } as MessageEvent))
      })
    }
    vi.stubGlobal('Image', ImmediateImage)
    vi.stubGlobal('createImageBitmap', createBitmap)
    vi.stubGlobal('Worker', ImageWorker)
    vi.stubGlobal('OffscreenCanvas', class {})
    const items = Array.from({ length: 256 }, (_, index) => ({
      id: `image-${index}`,
      image: `https://example.test/${index % 2}.png`,
    }))
    const cache = new TextureAtlasImageCache(4)

    const atlas = await createTextureAtlas(items, 32, { imageCache: cache })
    const rebuiltAtlas = await createTextureAtlas(items, 32, { imageCache: cache })
    const worker = workers[0]
    const [request, transfer] = worker.postMessage.mock.calls[0] as unknown as [
      { images: ImageBitmap[]; items: Array<{ imageIndex?: number }> },
      ImageBitmap[],
    ]

    expect(images).toHaveLength(2)
    expect(createBitmap).toHaveBeenCalledTimes(4)
    expect(request.images).toEqual(bitmaps.slice(0, 2))
    expect(request.items[0].imageIndex).toBe(0)
    expect(request.items[1].imageIndex).toBe(1)
    expect(transfer).toEqual(bitmaps.slice(0, 2))
    expect(workers[1].postMessage.mock.calls[0]?.[1]).toEqual(bitmaps.slice(2, 4))
    expect(atlas.metrics).toMatchObject({
      imageRequests: 2,
      imageFailures: 0,
      workerRenders: 1,
    })
    expect(rebuiltAtlas.metrics).toMatchObject({
      imageRequests: 0,
      imageFailures: 0,
      workerRenders: 1,
    })
    expect(workers).toHaveLength(2)
    atlas.texture.dispose()
    rebuiltAtlas.texture.dispose()
  })

  it('reuses loaded HTML images when ImageBitmap conversion falls back to the main thread', async () => {
    const images: ImmediateImage[] = []
    class ImmediateImage {
      crossOrigin = ''
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      naturalWidth = 64
      naturalHeight = 64
      private value = ''
      constructor() { images.push(this) }
      get src() { return this.value }
      set src(value: string) {
        this.value = value
        if (value) queueMicrotask(() => this.onload?.())
      }
    }
    const workers: IdleWorker[] = []
    class IdleWorker {
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: (() => void) | null = null
      terminate = vi.fn()
      postMessage = vi.fn()
      constructor() { workers.push(this) }
    }
    vi.stubGlobal('Image', ImmediateImage)
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('decode failed')))
    vi.stubGlobal('Worker', IdleWorker)
    vi.stubGlobal('OffscreenCanvas', class {})
    const items = Array.from({ length: 256 }, (_, index) => ({
      id: `fallback-image-${index}`,
      image: 'https://example.test/shared.png',
    }))

    const atlas = await createTextureAtlas(items, 32)

    expect(images).toHaveLength(1)
    expect(workers[0].postMessage).not.toHaveBeenCalled()
    expect(workers[0].terminate).toHaveBeenCalledOnce()
    expect(atlas.metrics).toMatchObject({
      imageRequests: 1,
      imageFailures: 0,
      workerRenders: 0,
    })
    atlas.texture.dispose()
  })

  it('falls back to the main-thread atlas when the raster worker fails', async () => {
    class FailingWorker {
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: (() => void) | null = null
      terminate = vi.fn()
      postMessage = vi.fn(() => queueMicrotask(() => this.onerror?.()))
    }
    vi.stubGlobal('Worker', FailingWorker)
    vi.stubGlobal('OffscreenCanvas', class {})
    const createElement = vi.spyOn(document, 'createElement')

    const atlas = await createTextureAtlas(
      Array.from({ length: 256 }, (_, index) => ({ id: `fallback-${index}` })),
      32,
    )

    expect(createElement).toHaveBeenCalledWith('canvas')
    expect(atlas.data).toBeInstanceOf(Uint8ClampedArray)
    atlas.texture.dispose()
  })

  it('terminates pending atlas worker work when its signal is aborted', async () => {
    const workers: WaitingWorker[] = []
    class WaitingWorker {
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: (() => void) | null = null
      terminate = vi.fn()
      postMessage = vi.fn()
      constructor() {
        workers.push(this)
      }
    }
    vi.stubGlobal('Worker', WaitingWorker)
    vi.stubGlobal('OffscreenCanvas', class {})
    const controller = new AbortController()
    const pending = createTextureAtlas(
      Array.from({ length: 256 }, (_, index) => ({ id: `pending-${index}` })),
      32,
      {
      signal: controller.signal,
      },
    )

    await vi.waitFor(() => expect(workers).toHaveLength(1))
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(workers[0].terminate).toHaveBeenCalledOnce()
  })

  it('closes an ImageBitmap that resolves after atlas work is aborted', async () => {
    class ImmediateImage {
      crossOrigin = ''
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      naturalWidth = 64
      naturalHeight = 64
      private value = ''
      get src() { return this.value }
      set src(value: string) {
        this.value = value
        if (value) queueMicrotask(() => this.onload?.())
      }
    }
    const bitmap = { width: 64, height: 64, close: vi.fn() } as unknown as ImageBitmap
    const decoding = deferred<ImageBitmap>()
    const workers: WaitingWorker[] = []
    class WaitingWorker {
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: (() => void) | null = null
      terminate = vi.fn()
      postMessage = vi.fn()
      constructor() { workers.push(this) }
    }
    vi.stubGlobal('Image', ImmediateImage)
    vi.stubGlobal('createImageBitmap', vi.fn(() => decoding.promise))
    vi.stubGlobal('Worker', WaitingWorker)
    vi.stubGlobal('OffscreenCanvas', class {})
    const controller = new AbortController()
    const pending = createTextureAtlas(
      Array.from({ length: 256 }, (_, index) => ({
        id: `abort-image-${index}`,
        image: 'https://example.test/shared.png',
      })),
      32,
      { signal: controller.signal },
    )
    await vi.waitFor(() => expect(workers).toHaveLength(1))
    controller.abort()
    decoding.resolve(bitmap)

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(bitmap.close).toHaveBeenCalledOnce()
    expect(workers[0].terminate).toHaveBeenCalledOnce()
  })

  it('falls back when an image does not settle before the configured timeout', async () => {
    vi.useFakeTimers()
    class NeverImage {
      crossOrigin = ''
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      src = ''
    }
    vi.stubGlobal('Image', NeverImage)

    const pending = createTextureAtlasPatch(
      [{ id: 'slow', title: 'Slow', image: 'https://example.test/slow.png' }],
      [0],
      32,
      { imageTimeout: 100 },
    )
    await vi.advanceTimersByTimeAsync(100)
    const patch = await pending
    const context = contexts.get(patch.cells[0].canvas)!
    expect(context.fillText).toHaveBeenCalledWith('Sl', 16, 16)
    expect(patch.metrics).toMatchObject({
      cells: 1,
      imageRequests: 1,
      imageFailures: 1,
    })
  })

  it('deduplicates image URLs and reuses the bounded Stage image cache', async () => {
    class ImmediateImage {
      crossOrigin = ''
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      naturalWidth = 32
      naturalHeight = 32
      private value = ''
      get src() { return this.value }
      set src(value: string) {
        this.value = value
        if (value) queueMicrotask(() => this.onload?.())
      }
    }
    vi.stubGlobal('Image', ImmediateImage)
    const cache = new TextureAtlasImageCache(2)
    const items = [
      { id: 'a', image: 'https://example.test/shared.png' },
      { id: 'b', image: 'https://example.test/shared.png' },
    ]

    const first = await createTextureAtlasPatch(items, [0, 1], 32, { imageCache: cache })
    const second = await createTextureAtlasPatch(items, [0, 1], 32, { imageCache: cache })

    expect(first.metrics).toMatchObject({ imageRequests: 1, imageFailures: 0 })
    expect(second.metrics).toMatchObject({ imageRequests: 0, imageFailures: 0, imageLoadMs: 0 })
  })

  it('limits concurrent image loads and aborts queued atlas work', async () => {
    const instances: ControlledImage[] = []
    class ControlledImage {
      crossOrigin = ''
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      naturalWidth = 32
      naturalHeight = 32
      src = ''
      constructor() { instances.push(this) }
    }
    vi.stubGlobal('Image', ControlledImage)
    const controller = new AbortController()
    const pending = createTextureAtlasPatch(
      Array.from({ length: 5 }, (_, index) => ({ id: String(index), image: `https://example.test/${index}.png` })),
      [0, 1, 2, 3, 4],
      32,
      { imageConcurrency: 2, signal: controller.signal },
    )
    await Promise.resolve()
    expect(instances).toHaveLength(2)

    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(instances.every((image) => image.src === '')).toBe(true)
  })

  it('isolates a custom async draw callback inside the configured card shape', async () => {
    const drawCard = vi.fn(async (context: CanvasRenderingContext2D) => {
      context.fillStyle = '#123456'
      context.fillRect(4, 4, 24, 24)
    })

    const patch = await createTextureAtlasPatch(
      [{ id: 'one', title: 'One' }],
      [0],
      32,
      {
        cardStyle: {
          shape: 'rounded',
          cornerRadius: 6,
          borderWidth: 2,
          borderColor: '#fedcba',
          backgroundColor: '#101820',
        },
        drawCard,
      },
    )

    const context = contexts.get(patch.cells[0].canvas)!
    expect(drawCard).toHaveBeenCalledWith(context, { id: 'one', title: 'One' }, {
      x: 0,
      y: 0,
      width: 32,
      height: 32,
    }, {
      shape: 'rounded',
      cornerRadius: 6,
      borderWidth: 2,
      borderColor: '#fedcba',
      backgroundColor: '#101820',
      imageFit: 'cover',
      imagePosition: { x: 0.5, y: 0.5 },
      contentPadding: 0,
      titleStyle: undefined,
    })
    expect(context.quadraticCurveTo).toHaveBeenCalled()
    expect(context.clip).toHaveBeenCalledOnce()
    expect(context.stroke).toHaveBeenCalledOnce()
    expect(context.save).toHaveBeenCalledTimes(2)
    expect(context.restore).toHaveBeenCalledTimes(2)
  })

  it('deduplicates indices and applies only those cells to an existing atlas', async () => {
    const patch = await createTextureAtlasPatch(
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      [2, 2, -1, 8],
      16,
    )
    expect(patch.cells.map(({ index }) => index)).toEqual([2])
    expect(patch.metrics.cells).toBe(1)

    const texture = {
      needsUpdate: false,
      addUpdateRange: vi.fn(),
      clearUpdateRanges: vi.fn(),
    }
    const data = new Uint8Array(40 * 40 * 4)
    const atlas = {
      data,
      width: 40,
      height: 40,
      columns: 2,
      rows: 2,
      cellSize: 16,
      cellWidth: 16,
      cellHeight: 16,
      padding: 2,
      stride: 20,
      strideX: 20,
      strideY: 20,
      texture,
      initialized: true,
    } as unknown as TextureAtlasResult
    const applyMs = applyTextureAtlasPatch(atlas, patch)

    expect(texture.needsUpdate).toBe(true)
    expect(texture.clearUpdateRanges).toHaveBeenCalledOnce()
    expect(texture.addUpdateRange).toHaveBeenCalledTimes(16)
    expect(patch.metrics.uploadBytes).toBe(16 * 16 * 4)
    expect(patch.metrics.uploadRanges).toBe(16)
    expect(applyMs).toBeGreaterThanOrEqual(0)

    applyTextureAtlasPatch(atlas, patch)
    expect(texture.clearUpdateRanges).toHaveBeenCalledTimes(2)
    expect(texture.addUpdateRange).toHaveBeenCalledTimes(32)
  })

  it('merges adjacent cells into one upload range per atlas row', async () => {
    const patch = await createTextureAtlasPatch(
      [{ id: 'a' }, { id: 'b' }],
      [0, 1],
      16,
    )
    const texture = {
      needsUpdate: false,
      addUpdateRange: vi.fn(),
      clearUpdateRanges: vi.fn(),
    }
    const atlas = {
      data: new Uint8Array(40 * 20 * 4),
      width: 40,
      height: 20,
      columns: 2,
      rows: 1,
      cellSize: 16,
      cellWidth: 16,
      cellHeight: 16,
      padding: 2,
      stride: 20,
      strideX: 20,
      strideY: 20,
      texture,
      initialized: true,
    } as unknown as TextureAtlasResult

    applyTextureAtlasPatch(atlas, patch)

    expect(texture.clearUpdateRanges).toHaveBeenCalledOnce()
    expect(texture.addUpdateRange).toHaveBeenCalledTimes(16)
    expect(patch.metrics.uploadRanges).toBe(16)
    expect(patch.metrics.uploadBytes).toBe(36 * 16 * 4)
  })

  it('falls back to the built-in card when custom drawing fails', async () => {
    const patch = await createTextureAtlasPatch(
      [{ id: 'fallback', title: 'Fallback' }],
      [0],
      32,
      { drawCard: () => { throw new Error('draw failed') } },
    )

    const context = contexts.get(patch.cells[0].canvas)!
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 32, 32)
    expect(context.fillText).toHaveBeenCalledWith('Fa', 16, 16)
    expect(context.restore).toHaveBeenCalledOnce()
  })

  it('loads all card content images once and falls back when preparation or drawing fails', async () => {
    class ImmediateImage {
      crossOrigin = ''
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      naturalWidth = 32
      naturalHeight = 32
      private value = ''
      get src() { return this.value }
      set src(value: string) {
        this.value = value
        if (value) queueMicrotask(() => this.onload?.())
      }
    }
    vi.stubGlobal('Image', ImmediateImage)
    const draw = vi.fn(({ images }: { images: ReadonlyMap<string, HTMLImageElement | null> }) => {
      expect(images.get('https://example.test/shared.png')).toBeInstanceOf(ImmediateImage)
    })
    const cardContent = {
      prepare: vi.fn((item: { id: string }) => {
        if (item.id === 'prepare-failure') throw new Error('prepare failed')
        return {
          imageSources: ['https://example.test/shared.png', 'https://example.test/shared.png'],
          draw: item.id === 'draw-failure' ? () => { throw new Error('draw failed') } : draw,
        }
      }),
    }
    const patch = await createTextureAtlasPatch([
      { id: 'ok' },
      { id: 'prepare-failure', title: 'Prepare' },
      { id: 'draw-failure', title: 'Draw' },
    ], [0, 1, 2], 32, { cardContent })

    expect(patch.metrics).toMatchObject({ imageRequests: 1, imageFailures: 0, cells: 3 })
    expect(draw).toHaveBeenCalledOnce()
    expect(contexts.get(patch.cells[1].canvas)!.fillText).toHaveBeenCalledWith('Pr', 16, 16)
    expect(contexts.get(patch.cells[2].canvas)!.fillText).toHaveBeenCalledWith('Dr', 16, 16)
  })

  it('packs rectangular atlas cells and UVs by aspect ratio while respecting texture limits', async () => {
    expect(resolveAtlasMetrics(12, 96, 4096, 4)).toMatchObject({
      columns: 2,
      rows: 6,
      cellSize: 96,
      cellWidth: 96,
      cellHeight: 24,
      strideX: 104,
      strideY: 32,
    })
    expect(resolveAtlasMetrics(12, 96, 4096, 0.25)).toMatchObject({
      columns: 7,
      rows: 2,
      cellSize: 96,
      cellWidth: 24,
      cellHeight: 96,
    })
    const constrained = resolveAtlasMetrics(2000, 128, 2048, 4)
    expect(constrained.columns * constrained.strideX).toBeLessThanOrEqual(2048)
    expect(constrained.rows * constrained.strideY).toBeLessThanOrEqual(2048)
    expect(resolveAtlasMetrics(1, 64, 4096, Number.NaN)).toMatchObject({
      cellWidth: 64,
      cellHeight: 64,
    })
    const atlas = await createTextureAtlas([{ id: 'a' }, { id: 'b' }], 64, {
      aspectRatio: 4,
      maxTextureSize: 4096,
    })
    expect(atlas).toMatchObject({
      columns: 1,
      rows: 2,
      cellWidth: 64,
      cellHeight: 16,
      width: 72,
      height: 48,
    })
    Array.from(atlas.rects.slice(0, 4)).forEach((value, index) => expect(value).toBeCloseTo([
      4 / 72,
      1 - 20 / 48,
      64 / 72,
      16 / 48,
    ][index]))
    atlas.texture.dispose()
  })

  it('draws images with cover, contain, and fill positioning', async () => {
    class ImmediateImage {
      crossOrigin = ''
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      naturalWidth = 200
      naturalHeight = 100
      private value = ''
      get src() { return this.value }
      set src(value: string) {
        this.value = value
        if (value) queueMicrotask(() => this.onload?.())
      }
    }
    vi.stubGlobal('Image', ImmediateImage)
    const item = { id: 'image', image: 'https://example.test/image.png' }

    const cover = await createTextureAtlasPatch([item], [0], 32, {
      cardStyle: { imageFit: 'cover', imagePosition: { x: 1, y: 0 } },
    })
    expect(contexts.get(cover.cells[0].canvas)!.drawImage).toHaveBeenCalledWith(
      expect.any(ImmediateImage),
      100,
      0,
      100,
      100,
      0,
      0,
      32,
      32,
    )

    const contain = await createTextureAtlasPatch([item], [0], 32, {
      cardStyle: { imageFit: 'contain', imagePosition: { x: 0, y: 1 } },
    })
    expect(contexts.get(contain.cells[0].canvas)!.drawImage).toHaveBeenCalledWith(
      expect.any(ImmediateImage),
      0,
      16,
      32,
      16,
    )

    const fill = await createTextureAtlasPatch([item], [0], 32, {
      cardStyle: { imageFit: 'fill' },
    })
    expect(contexts.get(fill.cells[0].canvas)!.drawImage).toHaveBeenCalledWith(
      expect.any(ImmediateImage),
      0,
      0,
      32,
      32,
    )
  })

  it('merges per-item styles and falls back to the Stage style when resolution fails', async () => {
    const drawCard = vi.fn()
    const item = { id: 'styled', title: 'Styled', meta: { winner: true } }
    await createTextureAtlasPatch([item], [0], 32, {
      cardStyle: {
        borderColor: '#ffffff',
        imagePosition: { x: 0.2, y: 0.3 },
        titleStyle: { color: '#eeeeee', maxLines: 1 },
      },
      resolveCardStyle: () => ({
        borderColor: '#ffd700',
        imagePosition: { x: 0.8 },
        titleStyle: { maxLines: 2, position: 'top' },
      }),
      drawCard,
    })
    expect(drawCard.mock.calls[0][3]).toEqual({
      borderColor: '#ffd700',
      contentPadding: 0,
      imageFit: 'cover',
      imagePosition: { x: 0.8, y: 0.3 },
      titleStyle: {
        align: 'center',
        color: '#eeeeee',
        backgroundColor: undefined,
        fontFamily: 'sans-serif',
        fontSizeRatio: 0.14,
        fontWeight: 600,
        lineHeight: 1.2,
        maxLines: 2,
        position: 'top',
      },
    })

    drawCard.mockClear()
    await createTextureAtlasPatch([item], [0], 32, {
      cardStyle: { borderColor: '#ffffff' },
      resolveCardStyle: () => { throw new Error('style failed') },
      drawCard,
    })
    expect(drawCard.mock.calls[0][3]).toEqual({
      borderColor: '#ffffff',
      contentPadding: 0,
      imageFit: 'cover',
      imagePosition: { x: 0.5, y: 0.5 },
      titleStyle: undefined,
    })
  })

  it('applies normalized padding, overlay, and ellipsized multi-line titles', async () => {
    const patch = await createTextureAtlasPatch(
      [{ id: 'title', title: 'abcdefghijkl' }],
      [0],
      40,
      {
        aspectRatio: 0.75,
        cardStyle: {
          contentPadding: 0.1,
          overlayColor: 'rgba(0,0,0,.3)',
          titleStyle: {
            fontSizeRatio: 0.2,
            maxLines: 2,
            position: 'bottom',
            align: 'left',
          },
        },
      },
    )
    const context = contexts.get(patch.cells[0].canvas)!
    expect(patch.cells[0].canvas).toMatchObject({ width: 30, height: 40 })
    expect(context.fillRect).toHaveBeenCalledWith(3, 3, 24, 34)
    expect(context.fillText.mock.calls.at(-1)?.[0]).toMatch(/…$/)
  })
})
