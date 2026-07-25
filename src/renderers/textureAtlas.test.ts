// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TextureAtlasResult } from './textureAtlas'
import {
  applyTextureAtlasPatch,
  createTextureAtlas,
  createTextureAtlasPatch,
  resolveAtlasMetrics,
  TextureAtlasImageCache,
} from './textureAtlas'

const contexts = new WeakMap<HTMLCanvasElement, ReturnType<typeof createContext>>()

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
    expect(atlas.texture.isDataTexture).toBe(true)
    expect(atlas.data).toHaveLength(64 * 64 * 4)
    expect(atlas.metrics.uploadBytes).toBe(64 * 64 * 4)
    atlas.texture.dispose()
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
    expect(texture.clearUpdateRanges).not.toHaveBeenCalled()
    expect(texture.addUpdateRange).toHaveBeenCalledTimes(16)
    expect(patch.metrics.uploadBytes).toBe(16 * 16 * 4)
    expect(applyMs).toBeGreaterThanOrEqual(0)

    applyTextureAtlasPatch(atlas, patch)
    expect(texture.clearUpdateRanges).not.toHaveBeenCalled()
    expect(texture.addUpdateRange).toHaveBeenCalledTimes(32)
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
