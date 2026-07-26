import type { MotionItem } from '../../core/types.js'
import type { TextureAtlasOptions } from '../textureAtlas.js'
import type {
  DefaultCardWorkerRequest,
} from './DefaultCardWorkerProtocol.js'

export interface DefaultCardWorkerResult {
  data: Uint8ClampedArray
  cellRenderMs: number
  readbackMs: number
}

export async function renderDefaultAtlasInWorker<TMeta>(
  items: readonly MotionItem<TMeta>[],
  dimensions: Omit<DefaultCardWorkerRequest, 'items'>,
  options: TextureAtlasOptions<TMeta>,
): Promise<DefaultCardWorkerResult | null> {
  if (
    options.drawCard
    || options.cardContent
    || items.length < 256
    || items.some((item) => Boolean(item.image))
    || typeof Worker === 'undefined'
    || typeof OffscreenCanvas === 'undefined'
  ) {
    return null
  }
  if (options.signal?.aborted) throw options.signal.reason

  try {
    const { renderDefaultAtlasInWorkerRuntime } = await import('./DefaultCardWorkerRuntime.js')
    if (options.signal?.aborted) throw options.signal.reason
    return renderDefaultAtlasInWorkerRuntime(items, dimensions, options)
  } catch {
    if (options.signal?.aborted) throw options.signal.reason
    return null
  }
}
