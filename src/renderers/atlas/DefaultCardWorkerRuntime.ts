import type { MotionItem } from '../../core/types.js'
import type { TextureAtlasOptions } from '../textureAtlas.js'
import defaultCardWorkerUrl from './DefaultCardWorker.ts?worker&url'
import { resolveCardStyle } from './DefaultCardPainter.js'
import type { DefaultCardWorkerResult } from './DefaultCardWorkerClient.js'
import type {
  DefaultCardWorkerRequest,
  DefaultCardWorkerResponse,
} from './DefaultCardWorkerProtocol.js'

export function renderDefaultAtlasInWorkerRuntime<TMeta>(
  items: readonly MotionItem<TMeta>[],
  dimensions: Omit<DefaultCardWorkerRequest, 'items'>,
  options: TextureAtlasOptions<TMeta>,
): Promise<DefaultCardWorkerResult | null> {
  let worker: Worker
  try {
    const workerUrl = new URL(defaultCardWorkerUrl, import.meta.url)
    worker = new Worker(workerUrl, {
      type: 'module',
      name: 'spatial-motion-card-atlas',
    })
  } catch {
    return Promise.resolve(null)
  }

  return new Promise<DefaultCardWorkerResult | null>((resolve, reject) => {
    let settled = false
    const finish = (result: DefaultCardWorkerResult | null): void => {
      if (settled) return
      settled = true
      options.signal?.removeEventListener('abort', abort)
      worker.terminate()
      resolve(result)
    }
    const abort = (): void => {
      if (settled) return
      settled = true
      worker.terminate()
      reject(options.signal?.reason)
    }
    worker.onmessage = (event: MessageEvent<DefaultCardWorkerResponse>) => {
      const response = event.data
      if (response.error || !response.data) {
        finish(null)
        return
      }
      finish({
        data: new Uint8ClampedArray(response.data),
        cellRenderMs: response.cellRenderMs,
        readbackMs: response.readbackMs,
      })
    }
    worker.onerror = () => finish(null)
    options.signal?.addEventListener('abort', abort, { once: true })
    const request: DefaultCardWorkerRequest = {
      ...dimensions,
      items: items.map((item) => ({
        id: item.id,
        title: item.title,
        style: resolveCardStyle(item, options),
      })),
    }
    try {
      worker.postMessage(request)
    } catch {
      finish(null)
    }
  })
}
