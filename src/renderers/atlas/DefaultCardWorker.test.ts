import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  DefaultCardWorkerRequest,
  DefaultCardWorkerResponse,
} from './DefaultCardWorkerProtocol.js'

describe('default card atlas worker', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('draws transferred images, returns the pixel buffer, and closes worker-owned bitmaps', async () => {
    const context = createContext()
    const getContext = vi.fn(() => context)
    const postMessage = vi.fn()
    class TestOffscreenCanvas {
      constructor(
        readonly width: number,
        readonly height: number,
      ) {}
      getContext = getContext
    }
    const bitmap = {
      width: 64,
      height: 64,
      close: vi.fn(),
    } as unknown as ImageBitmap
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    vi.stubGlobal('postMessage', postMessage)
    await import('./DefaultCardWorker.js')
    const scope = globalThis as unknown as {
      onmessage: (event: MessageEvent<DefaultCardWorkerRequest>) => void
    }
    const request: DefaultCardWorkerRequest = {
      width: 32,
      height: 32,
      columns: 1,
      cellWidth: 32,
      cellHeight: 32,
      padding: 0,
      strideX: 32,
      strideY: 32,
      items: [{
        id: 'image',
        imageIndex: 0,
        style: {
          imageFit: 'cover',
          imagePosition: { x: 0.5, y: 0.5 },
          contentPadding: 0,
        },
      }],
      images: [bitmap],
    }

    scope.onmessage({ data: request } as MessageEvent<DefaultCardWorkerRequest>)

    expect(context.drawImage).toHaveBeenCalledWith(
      bitmap,
      0,
      0,
      64,
      64,
      0,
      0,
      32,
      32,
    )
    expect(getContext).toHaveBeenCalledWith('2d')
    expect(bitmap.close).toHaveBeenCalledOnce()
    const [response, transfer] = postMessage.mock.calls[0] as [
      DefaultCardWorkerResponse,
      Transferable[],
    ]
    expect(response.data).toBeInstanceOf(ArrayBuffer)
    expect(response.workerRenderMs).toBeGreaterThanOrEqual(0)
    expect(transfer).toEqual([response.data])
  })

  it('draws array pages directly into the final layer buffer', async () => {
    const context = createContext()
    const getContext = vi.fn(() => context)
    context.getImageData.mockImplementation(
      (_x: number, _y: number, width: number, height: number) => {
        const data = new Uint8ClampedArray(width * height * 4)
        data[(width + 1) * 4] = 11
        data[((12 + 1) * width + 1) * 4] = 22
        return { data, width, height, colorSpace: 'srgb' }
      },
    )
    const postMessage = vi.fn()
    const canvases: TestOffscreenCanvas[] = []
    class TestOffscreenCanvas {
      constructor(
        readonly width: number,
        readonly height: number,
      ) {
        canvases.push(this)
      }
      getContext = getContext
    }
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    vi.stubGlobal('postMessage', postMessage)
    await import('./DefaultCardWorker.js')
    const scope = globalThis as unknown as {
      onmessage: (event: MessageEvent<DefaultCardWorkerRequest>) => void
    }
    const request: DefaultCardWorkerRequest = {
      width: 20,
      height: 16,
      columns: 5,
      cellWidth: 2,
      cellHeight: 2,
      padding: 1,
      strideX: 4,
      strideY: 4,
      items: Array.from({ length: 17 }, (_value, index) => ({
        id: String(index),
        style: {
          imageFit: 'cover',
          imagePosition: { x: 0.5, y: 0.5 },
          contentPadding: 0,
        },
      })),
      images: [],
      arrayMaxTextureLayers: 2,
    }

    scope.onmessage({ data: request } as MessageEvent<DefaultCardWorkerRequest>)

    const [response, transfer] = postMessage.mock.calls[0] as [
      DefaultCardWorkerResponse,
      Transferable[],
    ]
    expect(response).toMatchObject({
      arrayWidth: 12,
      arrayHeight: 12,
      arrayDepth: 2,
      arrayPageColumns: 3,
      arrayPageRows: 3,
      pixelBufferPeakBytes: 2 * 12 * 12 * 4 + 24 * 12 * 4,
    })
    expect(response.workerRenderMs).toBeGreaterThanOrEqual(0)
    expect(canvases).toHaveLength(1)
    expect(getContext).toHaveBeenCalledWith('2d', { willReadFrequently: true })
    expect(canvases[0]).toMatchObject({ width: 12, height: 24 })
    expect(context.clearRect).toHaveBeenCalledOnce()
    expect(context.getImageData).toHaveBeenCalledOnce()
    expect(context.getImageData).toHaveBeenCalledWith(0, 0, 12, 24)
    expect(context.translate).toHaveBeenNthCalledWith(1, 0, 12)
    expect(context.translate).toHaveBeenNthCalledWith(2, 0, 24)
    expect(context.scale).toHaveBeenCalledTimes(2)
    expect(context.scale).toHaveBeenCalledWith(1, -1)
    expect(context.save).toHaveBeenCalledTimes(context.restore.mock.calls.length)
    const pixels = new Uint8Array(response.data!)
    const firstLayerOffset = (12 + 1) * 4
    expect(pixels[firstLayerOffset]).toBe(11)
    expect(pixels[12 * 12 * 4 + firstLayerOffset]).toBe(22)
    expect(transfer).toEqual([response.data, response.rects])
  })

  it('bounds array readback batches to two MiB while retaining the final layer buffer', async () => {
    const context = createContext()
    const getContext = vi.fn(() => context)
    const postMessage = vi.fn()
    const canvases: TestOffscreenCanvas[] = []
    class TestOffscreenCanvas {
      constructor(
        readonly width: number,
        readonly height: number,
      ) {
        canvases.push(this)
      }
      getContext = getContext
    }
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas)
    vi.stubGlobal('postMessage', postMessage)
    await import('./DefaultCardWorker.js')
    const scope = globalThis as unknown as {
      onmessage: (event: MessageEvent<DefaultCardWorkerRequest>) => void
    }
    const items = Array.from({ length: 32 }, (_value, index) => ({
      id: String(index),
      style: {
        imageFit: 'cover' as const,
        imagePosition: { x: 0.5, y: 0.5 },
        contentPadding: 0,
      },
    }))

    scope.onmessage({
      data: {
        width: 512,
        height: 4096,
        columns: 2,
        cellWidth: 256,
        cellHeight: 256,
        padding: 0,
        strideX: 256,
        strideY: 256,
        items,
        images: [],
        arrayMaxTextureLayers: 256,
      },
    } as unknown as MessageEvent<DefaultCardWorkerRequest>)

    const [response] = postMessage.mock.calls[0] as [DefaultCardWorkerResponse]
    const finalBytes = response.data!.byteLength
    expect(canvases[0]).toMatchObject({ width: 256, height: 1536 })
    expect(getContext).toHaveBeenCalledWith('2d', { willReadFrequently: true })
    expect(context.getImageData).toHaveBeenCalledTimes(6)
    for (const [, , width, height] of context.getImageData.mock.calls) {
      expect(width * height * 4).toBeLessThanOrEqual(2 * 1024 * 1024)
    }
    expect(response.pixelBufferPeakBytes).toBe(finalBytes + 768 * 512 * 4)
  })
})

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
    translate: vi.fn(),
    scale: vi.fn(),
    quadraticCurveTo: vi.fn(),
    fill: vi.fn(),
    clip: vi.fn(),
    stroke: vi.fn(),
    drawImage: vi.fn(),
    clearRect: vi.fn(),
    getImageData: vi.fn((_x: number, _y: number, width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4),
      width,
      height,
      colorSpace: 'srgb',
    })),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: text.length * 6 })),
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
  }
}
