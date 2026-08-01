import type { MotionItem } from '../../core/types.js'
import type { TextureAtlasOptions } from '../textureAtlas.js'
import defaultCardWorkerUrl from './DefaultCardWorker.ts?worker&url'
import type { ImageResourceBatch } from './ImageResourcePool.js'
import type {
  DefaultCardWorkerRequest,
} from './DefaultCardWorkerProtocol.js'

export interface DefaultCardWorkerResult {
  data: Uint8Array | Uint8ClampedArray
  cellRenderMs: number
  readbackMs: number
  workerRenderMs: number
  workerRoundTripMs: number
  workerRuntimeLoadMs: number
  workerConstructMs: number
  workerRequestPrepareMs: number
  workerPrePostMs: number
  imageBitmapDecodeMs: number
  imageLoadWallMs: number
  imageLoadMs: number
  imageRequests: number
  imageFailures: number
  pixelBufferPeakBytes: number
  array?: {
    rects: Float32Array
    width: number
    height: number
    depth: number
    pageColumns: number
    pageRows: number
    packMs: number
  }
}

export interface DefaultCardWorkerAttempt {
  result: DefaultCardWorkerResult | null
  resources?: ImageResourceBatch
}

export async function renderDefaultAtlasInWorker<TMeta>(
  items: readonly MotionItem<TMeta>[],
  dimensions: Omit<DefaultCardWorkerRequest, 'items' | 'images'>,
  options: TextureAtlasOptions<TMeta>,
): Promise<DefaultCardWorkerAttempt> {
  const hasImages = items.some((item) => Boolean(item.image))
  if (
    options.drawCard
    || options.cardContent
    || items.length < 256
    || typeof Worker === 'undefined'
    || typeof OffscreenCanvas === 'undefined'
    || (hasImages && typeof createImageBitmap === 'undefined')
  ) {
    return { result: null }
  }
  if (options.signal?.aborted) throw options.signal.reason

  try {
    const runtimeStartedAt = now()
    const runtimePromise = import('./DefaultCardWorkerRuntime.js')
    const workerConstructStartedAt = now()
    const workerUrl = new URL(defaultCardWorkerUrl, import.meta.url)
    const worker = new Worker(workerUrl, {
      type: 'module',
      name: 'spatial-motion-card-atlas',
    })
    let ownsWorker = true
    const workerConstructMs = now() - workerConstructStartedAt
    let runtimeLoadedAt = runtimeStartedAt
    try {
      const runtime = await runtimePromise
      runtimeLoadedAt = now()
      if (options.signal?.aborted) {
        worker.terminate()
        ownsWorker = false
        throw options.signal.reason
      }
      ownsWorker = false
      const attempt = await runtime.renderDefaultAtlasInWorkerRuntime(
        items,
        dimensions,
        options,
        worker,
        runtimeStartedAt,
        workerConstructMs,
      )
      return {
        ...attempt,
        result: attempt.result
          ? {
              ...attempt.result,
              workerRuntimeLoadMs: Math.max(
                0,
                runtimeLoadedAt - runtimeStartedAt - workerConstructMs,
              ),
            }
          : null,
      }
    } catch (error) {
      if (ownsWorker) worker.terminate()
      throw error
    }
  } catch {
    if (options.signal?.aborted) throw options.signal.reason
    return { result: null }
  }
}

function now(): number {
  return globalThis.performance?.now() ?? Date.now()
}
