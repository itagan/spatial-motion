import { drawDefaultCell } from './DefaultCardPainter.js'
import type {
  DefaultCardWorkerRequest,
  DefaultCardWorkerResponse,
} from './DefaultCardWorkerProtocol.js'

interface DefaultCardWorkerScope {
  onmessage: ((event: MessageEvent<DefaultCardWorkerRequest>) => void) | null
  postMessage(message: DefaultCardWorkerResponse, transfer: Transferable[]): void
}

const scope = globalThis as unknown as DefaultCardWorkerScope

scope.onmessage = (event) => {
  try {
    const request = event.data
    const canvas = new OffscreenCanvas(request.width, request.height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Offscreen Canvas 2D context is unavailable')
    const cellRenderStartedAt = now()
    request.items.forEach((item, index) => {
      drawDefaultCell(
        context,
        item,
        null,
        {
          x: (index % request.columns) * request.strideX + request.padding,
          y: Math.floor(index / request.columns) * request.strideY + request.padding,
          width: request.cellWidth,
          height: request.cellHeight,
        },
        item.style,
      )
    })
    const cellRenderMs = now() - cellRenderStartedAt
    const readbackStartedAt = now()
    const imageData = context.getImageData(0, 0, request.width, request.height)
    const readbackMs = now() - readbackStartedAt
    const data = imageData.data.buffer
    scope.postMessage({ data, cellRenderMs, readbackMs }, [data])
  } catch (error) {
    scope.postMessage({
      cellRenderMs: 0,
      readbackMs: 0,
      error: error instanceof Error ? error.message : String(error),
    }, [])
  }
}

function now(): number {
  return globalThis.performance?.now() ?? Date.now()
}
