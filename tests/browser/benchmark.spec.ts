import { expect, test } from '@playwright/test'

interface BenchmarkSummary {
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
  longFrames: { over50Ms: number }
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
    firstRenderSubmitMs: number
  }
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
  expect(result.atlas.firstRenderSubmitMs).toBeLessThan(33)

  expect(result.averageFps).toBeGreaterThanOrEqual(20)
  expect(result.maximumFrameTimeP95).toBeLessThan(50)
  expect(result.longFrames.over50Ms).toBeLessThanOrEqual(2)
  expect(result.averageFrameCpuMs).toBeLessThan(10)
  expect(result.averageRenderSubmitMs).toBeLessThan(10)
})
