import type { MotionItem } from '../../core/types.js'
import type { TextureAtlasOptions } from '../textureAtlas.js'
import type { ImageResourceBatch } from './ImageResourcePool.js'
import type {
  DefaultCardWorkerRequest,
} from './DefaultCardWorkerProtocol.js'

export interface DefaultCardWorkerResult {
  data: Uint8Array | Uint8ClampedArray
  cellRenderMs: number
  readbackMs: number
  imageBitmapDecodeMs: number
  imageLoadWallMs: number
  imageLoadMs: number
  imageRequests: number
  imageFailures: number
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
    const { renderDefaultAtlasInWorkerRuntime } = await import('./DefaultCardWorkerRuntime.js')
    if (options.signal?.aborted) throw options.signal.reason
    return renderDefaultAtlasInWorkerRuntime(items, dimensions, options)
  } catch {
    if (options.signal?.aborted) throw options.signal.reason
    return { result: null }
  }
}
