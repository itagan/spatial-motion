// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TextureAtlasResult } from './textureAtlas'
import { applyTextureAtlasPatch, createTextureAtlasPatch } from './textureAtlas'

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
    vi.restoreAllMocks()
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

    const canvas = document.createElement('canvas')
    const texture = { needsUpdate: false }
    const atlas = {
      canvas,
      columns: 2,
      cellSize: 16,
      padding: 2,
      stride: 20,
      texture,
    } as unknown as TextureAtlasResult
    applyTextureAtlasPatch(atlas, patch)

    const context = contexts.get(canvas)!
    expect(context.clearRect).toHaveBeenCalledWith(2, 22, 16, 16)
    expect(context.drawImage).toHaveBeenCalledWith(patch.cells[0].canvas, 2, 22)
    expect(texture.needsUpdate).toBe(true)
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
