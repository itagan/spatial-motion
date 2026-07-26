export interface ImageLoadResult {
  image: HTMLImageElement | null
  durationMs: number
  failed: boolean
  requested: boolean
}

export interface ImageResourceBatch {
  results: ReadonlyMap<string, ImageLoadResult>
  images: ReadonlyMap<string, HTMLImageElement | null>
  wallTimeMs: number
  totalLoadTimeMs: number
  requests: number
  failures: number
}

interface ImageResourcePoolOptions {
  timeout?: number
  concurrency?: number
  cache?: TextureAtlasImageCache
  signal?: AbortSignal
}

export class TextureAtlasImageCache {
  private readonly entries = new Map<string, HTMLImageElement>()

  constructor(private readonly maximumEntries = 128) {}

  get(url: string): HTMLImageElement | null {
    const image = this.entries.get(url)
    if (!image) return null
    this.entries.delete(url)
    this.entries.set(url, image)
    return image
  }

  set(url: string, image: HTMLImageElement): void {
    if (this.maximumEntries <= 0) return
    this.entries.delete(url)
    this.entries.set(url, image)
    while (this.entries.size > this.maximumEntries) {
      const oldest = this.entries.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.entries.delete(oldest)
    }
  }

  clear(): void {
    this.entries.clear()
  }
}

export class ImageResourcePool {
  constructor(private readonly options: ImageResourcePoolOptions) {}

  async load(urls: readonly string[]): Promise<ImageResourceBatch> {
    const uniqueUrls = [...new Set(urls.filter(Boolean))]
    const startedAt = now()
    const results = await mapWithConcurrency(
      uniqueUrls,
      this.options.concurrency,
      (url) => loadImage(
        url,
        resolveImageTimeout(this.options.timeout),
        this.options.cache,
        this.options.signal,
      ),
      this.options.signal,
    )
    return {
      results: new Map(uniqueUrls.map((url, index) => [url, results[index]])),
      images: new Map(uniqueUrls.map((url, index) => [url, results[index].image])),
      wallTimeMs: now() - startedAt,
      totalLoadTimeMs: results.reduce((sum, result) => sum + result.durationMs, 0),
      requests: results.filter((result) => result.requested).length,
      failures: results.filter((result) => result.failed).length,
    }
  }
}

export function throwIfAtlasAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw atlasAbortError()
}

function loadImage(
  url: string,
  timeoutMs: number,
  cache: TextureAtlasImageCache | undefined,
  signal: AbortSignal | undefined,
): Promise<ImageLoadResult> {
  const cached = cache?.get(url)
  if (cached) {
    return Promise.resolve({
      image: cached,
      durationMs: 0,
      failed: false,
      requested: false,
    })
  }
  if (signal?.aborted) return Promise.reject(atlasAbortError())
  return new Promise((resolve, reject) => {
    const startedAt = now()
    const image = new Image()
    let settled = false
    const complete = (result: HTMLImageElement | null, aborted = false) => {
      if (settled) return
      settled = true
      window.clearTimeout(timeoutId)
      signal?.removeEventListener('abort', handleAbort)
      image.onload = null
      image.onerror = null
      if (aborted) {
        image.src = ''
        reject(atlasAbortError())
        return
      }
      if (result) cache?.set(url, result)
      resolve({
        image: result,
        durationMs: now() - startedAt,
        failed: result === null,
        requested: true,
      })
    }
    const timeoutId = window.setTimeout(() => complete(null), timeoutMs)
    const handleAbort = () => complete(null, true)
    signal?.addEventListener('abort', handleAbort, { once: true })
    image.crossOrigin = 'anonymous'
    image.onload = () => complete(image)
    image.onerror = () => complete(null)
    image.src = url
  })
}

function resolveImageTimeout(value: number | undefined): number {
  return Number.isFinite(value) && (value ?? 0) > 0
    ? Math.min(60_000, Math.max(100, value as number))
    : 10_000
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  requestedConcurrency: number | undefined,
  task: (value: T) => Promise<R>,
  signal: AbortSignal | undefined,
): Promise<R[]> {
  if (!values.length) return []
  const concurrency = Math.min(values.length, Math.max(1, Math.floor(
    Number.isFinite(requestedConcurrency) ? requestedConcurrency as number : 6,
  )))
  const results = new Array<R>(values.length)
  let cursor = 0
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (cursor < values.length) {
      throwIfAtlasAborted(signal)
      const index = cursor
      cursor += 1
      results[index] = await task(values[index])
    }
  }))
  return results
}

function atlasAbortError(): DOMException {
  return new DOMException('Atlas aborted', 'AbortError')
}

function now(): number {
  return globalThis.performance?.now() ?? Date.now()
}
