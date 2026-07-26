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
    const postMessage = vi.fn()
    class TestOffscreenCanvas {
      constructor(
        readonly width: number,
        readonly height: number,
      ) {}
      getContext() { return context }
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
    expect(bitmap.close).toHaveBeenCalledOnce()
    const [response, transfer] = postMessage.mock.calls[0] as [
      DefaultCardWorkerResponse,
      Transferable[],
    ]
    expect(response.data).toBeInstanceOf(ArrayBuffer)
    expect(transfer).toEqual([response.data])
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
    quadraticCurveTo: vi.fn(),
    fill: vi.fn(),
    clip: vi.fn(),
    stroke: vi.fn(),
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
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
  }
}
