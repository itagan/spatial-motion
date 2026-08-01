import type { MotionItem } from '../../core/types.js'
import type { TextureAtlasOptions } from '../textureAtlas.js'
import { resolveCardStyle } from './DefaultCardPainter.js'
import type {
  DefaultCardWorkerAttempt,
  DefaultCardWorkerResult,
} from './DefaultCardWorkerClient.js'
import type {
  DefaultCardWorkerRequest,
  DefaultCardWorkerResponse,
} from './DefaultCardWorkerProtocol.js'
import {
  ImageResourcePool,
  throwIfAtlasAborted,
} from './ImageResourcePool.js'

export async function renderDefaultAtlasInWorkerRuntime<TMeta>(
  items: readonly MotionItem<TMeta>[],
  dimensions: Omit<DefaultCardWorkerRequest, 'items' | 'images'>,
  options: TextureAtlasOptions<TMeta>,
  worker: Worker,
  runtimeStartedAt: number,
  workerConstructMs: number,
): Promise<DefaultCardWorkerAttempt> {
  const imageUrls = [...new Set(items
    .map((item) => item.image)
    .filter((url): url is string => Boolean(url)))]
  let resources
  try {
    resources = await new ImageResourcePool({
      timeout: options.imageTimeout,
      concurrency: options.imageConcurrency,
      cache: options.imageCache,
      signal: options.signal,
    }).load(imageUrls)
  } catch (error) {
    worker.terminate()
    throw error
  }

  const bitmapDecodeStartedAt = now()
  let bitmaps: ImageBitmap[] = []
  let bitmapIndices = new Map<string, number>()
  try {
    const decoded = await decodeImageBitmaps(
      imageUrls,
      resources.images,
      options.imageConcurrency,
      options.signal,
    )
    bitmaps = decoded.bitmaps
    bitmapIndices = decoded.indices
  } catch (error) {
    bitmaps.forEach(closeBitmap)
    worker.terminate()
    if (options.signal?.aborted) throw error
    return { result: null, resources }
  }
  const imageBitmapDecodeMs = now() - bitmapDecodeStartedAt
  const requestPrepareStartedAt = now()
  const request: DefaultCardWorkerRequest = {
    ...dimensions,
    items: items.map((item) => ({
      id: item.id,
      title: item.title,
      style: resolveCardStyle(item, options),
      imageIndex: item.image ? bitmapIndices.get(item.image) : undefined,
    })),
    images: bitmaps,
  }
  const workerRequestPrepareMs = now() - requestPrepareStartedAt
  const result = await runWorker(worker, request, bitmaps, options.signal, runtimeStartedAt)
  return {
    result: result
      ? {
          ...result,
          imageBitmapDecodeMs,
          imageLoadWallMs: resources.wallTimeMs,
          imageLoadMs: resources.totalLoadTimeMs,
          imageRequests: resources.requests,
          imageFailures: resources.failures,
          workerRuntimeLoadMs: 0,
          workerConstructMs,
          workerRequestPrepareMs,
        }
      : null,
    resources,
  }
}

async function decodeImageBitmaps(
  urls: readonly string[],
  images: ReadonlyMap<string, HTMLImageElement | null>,
  requestedConcurrency: number | undefined,
  signal: AbortSignal | undefined,
): Promise<{ bitmaps: ImageBitmap[]; indices: Map<string, number> }> {
  const sources = urls.flatMap((url) => {
    const image = images.get(url)
    return image ? [{ url, image }] : []
  })
  const concurrency = Math.min(sources.length || 1, Math.max(1, Math.floor(
    Number.isFinite(requestedConcurrency) ? requestedConcurrency as number : 6,
  )))
  const bitmaps: ImageBitmap[] = []
  const indices = new Map<string, number>()
  for (let offset = 0; offset < sources.length; offset += concurrency) {
    throwIfAtlasAborted(signal)
    const chunk = sources.slice(offset, offset + concurrency)
    const decoded = await Promise.allSettled(
      chunk.map(({ image }) => createImageBitmap(image)),
    )
    decoded.forEach((result, index) => {
      if (result.status === 'rejected') return
      if (signal?.aborted) {
        closeBitmap(result.value)
        return
      }
      indices.set(chunk[index].url, bitmaps.length)
      bitmaps.push(result.value)
    })
    if (signal?.aborted) throw signal.reason
    const failure = decoded.find((result) => result.status === 'rejected')
    if (failure?.status === 'rejected') throw failure.reason
  }
  return { bitmaps, indices }
}

function runWorker(
  worker: Worker,
  request: DefaultCardWorkerRequest,
  bitmaps: ImageBitmap[],
  signal: AbortSignal | undefined,
  runtimeStartedAt: number,
): Promise<Pick<
  DefaultCardWorkerResult,
  'data' | 'cellRenderMs' | 'readbackMs'
  | 'workerRenderMs' | 'workerRoundTripMs' | 'workerPrePostMs'
  | 'pixelBufferPeakBytes' | 'array'
> | null> {
  return new Promise((resolve, reject) => {
    let settled = false
    let transferred = false
    let roundTripStartedAt = 0
    let workerPrePostMs = 0
    if (signal?.aborted) {
      worker.terminate()
      bitmaps.forEach(closeBitmap)
      reject(signal.reason)
      return
    }
    const finish = (
      result: Pick<
        DefaultCardWorkerResult,
        'data' | 'cellRenderMs' | 'readbackMs' | 'workerRenderMs'
        | 'workerRoundTripMs' | 'workerPrePostMs' | 'pixelBufferPeakBytes' | 'array'
      > | null,
    ): void => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', abort)
      worker.terminate()
      if (!transferred) bitmaps.forEach(closeBitmap)
      resolve(result)
    }
    const abort = (): void => {
      if (settled) return
      settled = true
      worker.terminate()
      if (!transferred) bitmaps.forEach(closeBitmap)
      reject(signal?.reason)
    }
    worker.onmessage = (event: MessageEvent<DefaultCardWorkerResponse>) => {
      const response = event.data
      if (response.error || !response.data) {
        finish(null)
        return
      }
      const array = response.rects
        && response.arrayWidth
        && response.arrayHeight
        && response.arrayDepth
        && response.arrayPageColumns
        && response.arrayPageRows
        ? {
            rects: new Float32Array(response.rects),
            width: response.arrayWidth,
            height: response.arrayHeight,
            depth: response.arrayDepth,
            pageColumns: response.arrayPageColumns,
            pageRows: response.arrayPageRows,
            packMs: response.arrayPackMs ?? 0,
          }
        : undefined
      finish({
        data: array
          ? new Uint8Array(response.data)
          : new Uint8ClampedArray(response.data),
        cellRenderMs: response.cellRenderMs,
        readbackMs: response.readbackMs,
        workerRenderMs: response.workerRenderMs ?? 0,
        workerRoundTripMs: Math.max(0, now() - roundTripStartedAt),
        workerPrePostMs,
        pixelBufferPeakBytes: response.pixelBufferPeakBytes ?? response.data.byteLength,
        array,
      })
    }
    worker.onerror = () => finish(null)
    signal?.addEventListener('abort', abort, { once: true })
    try {
      workerPrePostMs = Math.max(0, now() - runtimeStartedAt)
      roundTripStartedAt = now()
      worker.postMessage(request, bitmaps)
      transferred = true
    } catch {
      finish(null)
    }
  })
}

function closeBitmap(bitmap: ImageBitmap): void {
  try {
    bitmap.close()
  } catch {
    // A transferred bitmap is owned by the worker and is released there.
  }
}

function now(): number {
  return globalThis.performance?.now() ?? Date.now()
}
