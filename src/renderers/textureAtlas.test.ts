// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TextureAtlasResult } from './textureAtlas'
import {
  applyTextureAtlasPatch,
  createTextureAtlas,
  createTextureAtlasPatch,
  resolveAtlasMetrics,
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
      padding: 4,
      stride: 45,
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
      cellSize: 16,
      padding: 2,
      stride: 20,
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
})
