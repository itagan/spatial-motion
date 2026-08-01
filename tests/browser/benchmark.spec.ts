import { expect, test } from '@playwright/test'

interface BenchmarkSummary {
  contentMode: 'default' | 'template' | 'canvas'
  configuration: {
    itemCount: number
    qualityMode: string
    scenario: string
    environment: {
      webglVersion: string
      antialias: boolean
    }
  }
  averageFps: number
  maximumFrameTimeP95: number
  longFrames: { over24Ms: number; over50Ms: number }
  averageFrameCpuMs: number
  averageRenderSubmitMs: number
  maximumDrawCalls: number
  renderedItems: number
  submittedItems: number
  visibleItems: number
  contextLost: boolean
  atlas: {
    requestedAtlasMode: string
    actualAtlasMode: string
    mipmaps: boolean
    atlasLayers: number
    uploadedAtlasLayers: number
    pendingAtlasLayers: number
    atlasLayerUploadFrames: number
    cpuResidentBytes: number
    gpuResidentBytes: number
    buildPixelBufferPeakBytes: number
    maxBuildPixelBufferBytes: number
    workerRenders: number
    patches: number
    cellsUpdated: number
    buildMs: number
    patchMs: number
    cellRenderMs: number
    readbackMs: number
    arrayPackMs: number
    workerRenderMs: number
    workerRoundTripMs: number
    workerRuntimeLoadMs: number
    workerConstructMs: number
    workerRequestPrepareMs: number
    workerPrePostMs: number
    lastBuildMs: number
    lastPrepareMs: number
    lastImageLoadWallMs: number
    lastCellRenderMs: number
    lastReadbackMs: number
    lastArrayPackMs: number
    lastWorkerRenderMs: number
    lastWorkerRoundTripMs: number
    lastWorkerRuntimeLoadMs: number
    lastWorkerConstructMs: number
    lastWorkerRequestPrepareMs: number
    lastWorkerPrePostMs: number
    mainThreadRasterYields: number
    mainThreadRasterYieldMs: number
    arrayUploadBudgetBytes: number
    arrayUploadPeakBudgetBytes: number
    arrayUploadBackoffs: number
    firstRenderSubmitMs: number
  }
  operations: number
}

async function runContentBenchmark(
  page: import('@playwright/test').Page,
  contentMode: 'template' | 'canvas',
  scenario: 'cold-start' | 'atlas-update' = 'cold-start',
): Promise<{ result: BenchmarkSummary; resultText: string }> {
  await page.goto(`/benchmark.html?content=${contentMode}&atlas=array&resolution=48`)
  await expect(page.getByText('READY', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '2000', exact: true }).click()
  await page.getByRole('button', { name: 'HIGH', exact: true }).click()
  await page.locator('#duration').selectOption('3')
  await page.locator('#scenario').selectOption(scenario)
  await page.getByRole('button', { name: '运行性能采样', exact: true }).click()
  await expect(page.getByText(/采样完成：/)).toBeVisible({ timeout: 20_000 })
  const resultText = await page.locator('#benchmark-result').innerText()
  return { result: JSON.parse(resultText) as BenchmarkSummary, resultText }
}

async function probeStagePixels(page: import('@playwright/test').Page) {
  return page.evaluate(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    const source = document.querySelector<HTMLCanvasElement>('#benchmark-stage canvas')
    if (!source) throw new Error('Benchmark WebGL canvas is unavailable')
    const probe = document.createElement('canvas')
    probe.width = 96
    probe.height = 96
    const context = probe.getContext('2d')
    if (!context) throw new Error('Visual probe context is unavailable')
    context.drawImage(source, 0, 0, probe.width, probe.height)
    const pixels = context.getImageData(0, 0, probe.width, probe.height).data
    const buckets = new Set<number>()
    let opaquePixels = 0
    let chromaticPixels = 0
    for (let offset = 0; offset < pixels.length; offset += 4) {
      const red = pixels[offset]
      const green = pixels[offset + 1]
      const blue = pixels[offset + 2]
      if (pixels[offset + 3] > 0) opaquePixels += 1
      if (Math.max(red, green, blue) - Math.min(red, green, blue) > 12) chromaticPixels += 1
      buckets.add((red >> 4) << 8 | (green >> 4) << 4 | (blue >> 4))
    }
    return { opaquePixels, chromaticPixels, colorBuckets: buckets.size }
  })
}

test('2000-card default cold start stays within the WebGL performance envelope', async ({
  page,
}, testInfo) => {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))

  await page.goto('/benchmark.html')
  await expect(page.getByText('READY', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '2000', exact: true }).click()
  await page.getByRole('button', { name: 'HIGH', exact: true }).click()
  await page.locator('#duration').selectOption('3')
  await page.locator('#scenario').selectOption('cold-start')
  await page.getByRole('button', { name: '运行性能采样', exact: true }).click()
  await expect(page.getByText(/采样完成：/)).toBeVisible({ timeout: 20_000 })

  const resultText = await page.locator('#benchmark-result').innerText()
  const result = JSON.parse(resultText) as BenchmarkSummary
  await testInfo.attach('benchmark-result.json', {
    body: resultText,
    contentType: 'application/json',
  })

  expect(errors).toEqual([])
  expect(result.configuration).toMatchObject({
    itemCount: 2000,
    qualityMode: 'high',
    scenario: 'cold-start',
  })
  expect(result.configuration.environment.webglVersion).toContain('WebGL')
  expect(result.configuration.environment.antialias).toBe(true)
  expect(result.contextLost).toBe(false)
  expect(result.maximumDrawCalls).toBe(1)
  expect(result.renderedItems).toBe(2000)
  expect(result.submittedItems).toBe(2000)
  expect(result.visibleItems).toBe(2000)

  expect(result.atlas).toMatchObject({
    requestedAtlasMode: 'auto',
    actualAtlasMode: 'array',
    mipmaps: false,
    pendingAtlasLayers: 0,
  })
  expect(result.atlas.uploadedAtlasLayers).toBe(result.atlas.atlasLayers)
  expect(result.atlas.workerRenders).toBeGreaterThan(0)
  expect(result.atlas.arrayPackMs).toBeGreaterThan(0)
  expect(result.atlas.workerRenderMs).toBeGreaterThan(0)
  expect(result.atlas.workerRoundTripMs).toBeGreaterThanOrEqual(result.atlas.workerRenderMs)
  expect(result.atlas.lastBuildMs).toBeGreaterThan(0)
  expect(result.atlas.lastReadbackMs).toBeGreaterThan(0)
  expect(result.atlas.lastArrayPackMs).toBeGreaterThan(0)
  expect(result.atlas.lastWorkerRenderMs).toBeGreaterThan(0)
  expect(result.atlas.lastWorkerRoundTripMs).toBeGreaterThanOrEqual(
    result.atlas.lastWorkerRenderMs,
  )
  expect(result.atlas.lastWorkerPrePostMs).toBeGreaterThanOrEqual(
    result.atlas.lastWorkerRuntimeLoadMs
      + result.atlas.lastWorkerConstructMs
      + result.atlas.lastWorkerRequestPrepareMs,
  )
  expect(result.atlas.lastBuildMs).toBeGreaterThanOrEqual(
    result.atlas.lastWorkerPrePostMs + result.atlas.lastWorkerRoundTripMs,
  )
  expect(result.atlas.lastBuildMs).toBeLessThanOrEqual(result.atlas.buildMs)
  expect(result.atlas.mainThreadRasterYields).toBe(0)
  expect(result.atlas.cpuResidentBytes).toBeGreaterThan(0)
  expect(result.atlas.gpuResidentBytes).toBe(result.atlas.cpuResidentBytes)
  expect(result.atlas.buildPixelBufferPeakBytes).toBeGreaterThanOrEqual(
    result.atlas.cpuResidentBytes,
  )
  expect(result.atlas.buildPixelBufferPeakBytes).toBeLessThanOrEqual(
    result.atlas.cpuResidentBytes + 2 * 1024 * 1024,
  )
  expect(result.atlas.maxBuildPixelBufferBytes).toBeGreaterThanOrEqual(
    result.atlas.buildPixelBufferPeakBytes,
  )
  expect(result.atlas.firstRenderSubmitMs).toBeLessThan(33)
  expect(result.atlas.arrayUploadBudgetBytes).toBeGreaterThanOrEqual(768 * 1024)
  expect(result.atlas.arrayUploadPeakBudgetBytes).toBeLessThanOrEqual(3 * 1024 * 1024)
  expect(result.atlas.arrayUploadBackoffs).toBeGreaterThanOrEqual(0)
  if (
    result.atlas.arrayUploadPeakBudgetBytes === 3 * 1024 * 1024
    && result.atlas.arrayUploadBackoffs === 0
  ) {
    expect(result.atlas.atlasLayerUploadFrames).toBeLessThanOrEqual(12)
  }

  expect(result.averageFps).toBeGreaterThanOrEqual(20)
  expect(result.maximumFrameTimeP95).toBeLessThan(50)
  expect(result.longFrames.over50Ms).toBeLessThanOrEqual(2)
  expect(result.averageFrameCpuMs).toBeLessThan(10)
  expect(result.averageRenderSubmitMs).toBeLessThan(10)
})

test('2000-card main-thread array fallback keeps raster readbacks bounded', async ({
  page,
}, testInfo) => {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(() => {
    Object.defineProperty(globalThis, 'Worker', {
      configurable: true,
      value: undefined,
    })
  })

  await page.goto('/benchmark.html')
  await expect(page.getByText('READY', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '2000', exact: true }).click()
  await page.getByRole('button', { name: 'HIGH', exact: true }).click()
  await page.locator('#duration').selectOption('3')
  await page.locator('#scenario').selectOption('cold-start')
  await page.getByRole('button', { name: '运行性能采样', exact: true }).click()
  await expect(page.getByText(/采样完成：/)).toBeVisible({ timeout: 20_000 })

  const resultText = await page.locator('#benchmark-result').innerText()
  const result = JSON.parse(resultText) as BenchmarkSummary
  await testInfo.attach('main-thread-fallback-result.json', {
    body: resultText,
    contentType: 'application/json',
  })

  expect(errors).toEqual([])
  expect(result.atlas).toMatchObject({
    actualAtlasMode: 'array',
    workerRenders: 0,
    pendingAtlasLayers: 0,
  })
  expect(result.atlas.uploadedAtlasLayers).toBe(result.atlas.atlasLayers)
  expect(result.atlas.mainThreadRasterYields).toBeGreaterThan(0)
  expect(result.atlas.mainThreadRasterYieldMs).toBeGreaterThan(0)
  expect(result.atlas.buildPixelBufferPeakBytes).toBeGreaterThanOrEqual(
    result.atlas.cpuResidentBytes,
  )
  expect(result.atlas.buildPixelBufferPeakBytes).toBeLessThanOrEqual(
    result.atlas.cpuResidentBytes + 4 * 1024 * 1024,
  )
})

test('template and canvas content keep visual output and bounded Array rasterization', async ({
  page,
}, testInfo) => {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))

  for (const contentMode of ['template', 'canvas'] as const) {
    const { result, resultText } = await runContentBenchmark(page, contentMode)
    const visual = await probeStagePixels(page)
    await testInfo.attach(`${contentMode}-benchmark-result.json`, {
      body: resultText,
      contentType: 'application/json',
    })
    await testInfo.attach(`${contentMode}-stage.png`, {
      body: await page.locator('#benchmark-stage canvas').screenshot(),
      contentType: 'image/png',
    })

    expect(result.contentMode).toBe(contentMode)
    expect(result.contextLost).toBe(false)
    expect(result.maximumDrawCalls).toBe(1)
    expect(result.renderedItems).toBe(2000)
    expect(result.submittedItems).toBe(2000)
    expect(result.atlas).toMatchObject({
      actualAtlasMode: 'array',
      workerRenders: 0,
      pendingAtlasLayers: 0,
    })
    expect(result.atlas.mainThreadRasterYields).toBeGreaterThan(0)
    expect(result.atlas.buildPixelBufferPeakBytes).toBeLessThanOrEqual(
      result.atlas.cpuResidentBytes
        + (contentMode === 'canvas' ? 512 * 1024 : 1024 * 1024),
    )
    expect(result.averageFps).toBeGreaterThanOrEqual(20)
    expect(result.maximumFrameTimeP95).toBeLessThan(50)
    expect(visual.opaquePixels).toBeGreaterThan(96 * 96 * 0.1)
    expect(visual.chromaticPixels).toBeGreaterThan(200)
    expect(visual.colorBuckets).toBeGreaterThan(8)
  }

  expect(errors).toEqual([])
})

test('template and canvas partial updates keep readback bounded and visual output intact', async ({
  page,
}, testInfo) => {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))

  for (const contentMode of ['template', 'canvas'] as const) {
    const { result, resultText } = await runContentBenchmark(page, contentMode, 'atlas-update')
    const visual = await probeStagePixels(page)
    await testInfo.attach(`${contentMode}-atlas-update-result.json`, {
      body: resultText,
      contentType: 'application/json',
    })

    expect(result.contentMode).toBe(contentMode)
    expect(result.configuration.scenario).toBe('atlas-update')
    expect(result.contextLost).toBe(false)
    expect(result.maximumDrawCalls).toBe(1)
    expect(result.operations).toBeGreaterThanOrEqual(12)
    expect(result.atlas.patches).toBeGreaterThanOrEqual(result.operations - 2)
    expect(result.atlas.cellsUpdated).toBe(result.atlas.patches)
    expect(result.atlas.patchMs).toBeGreaterThan(0)
    expect(result.atlas.readbackMs).toBeGreaterThan(0)
    expect(result.atlas.readbackMs).toBeLessThan(result.atlas.patchMs)
    expect(result.atlas.readbackMs).toBeLessThan(result.atlas.patches * 2)
    expect(result.averageFps).toBeGreaterThanOrEqual(20)
    expect(result.maximumFrameTimeP95).toBeLessThan(50)
    expect(result.longFrames.over50Ms).toBeLessThanOrEqual(1)
    expect(visual.opaquePixels).toBeGreaterThan(96 * 96 * 0.1)
    expect(visual.chromaticPixels).toBeGreaterThan(200)
    expect(visual.colorBuckets).toBeGreaterThan(8)
  }

  expect(errors).toEqual([])
})
