import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDeviceEvidence } from './device-evidence.mjs'

test('builds qualified-shape stability evidence from a real-device capture', () => {
  const capture = fixture()
  const evidence = buildDeviceEvidence(capture, 'abc123')

  assert.equal(evidence.sourceRevision, 'abc123')
  assert.equal(evidence.results[0], capture.result)
  assert.equal(evidence.stabilityDiagnostics[0].evaluation.version, 2)
  assert.equal(evidence.stabilityDiagnostics[0].evaluation.passed, true)
  assert.equal(evidence.runDiagnostics[0].operations, 24)
})

test('rejects mismatched browser identity and incomplete stability diagnostics', () => {
  const mismatch = fixture()
  mismatch.browser.userAgent = 'different'
  assert.throws(() => buildDeviceEvidence(mismatch, 'abc123'), /browser identity/)

  const incomplete = fixture()
  incomplete.browserSamples = incomplete.browserSamples.slice(0, 1)
  const evidence = buildDeviceEvidence(incomplete, 'abc123')
  assert.equal(evidence.stabilityDiagnostics[0].evaluation.passed, false)
  assert.ok(evidence.stabilityDiagnostics[0].evaluation.failures.some(({ code }) =>
    code === 'insufficient-browser-samples'))

  const sparse = fixture()
  sparse.browserSamples[1].elapsedMs = 1_000
  sparse.browserSamples[2].elapsedMs = 2_000
  sparse.browserSamples[3].elapsedMs = 19_000
  sparse.browserSamples[4].elapsedMs = 20_000
  const sparseEvidence = buildDeviceEvidence(sparse, 'abc123')
  assert.equal(sparseEvidence.stabilityDiagnostics[0].evaluation.passed, false)
  assert.ok(sparseEvidence.stabilityDiagnostics[0].evaluation.failures.some(({ code }) =>
    code === 'browser-sample-gap'))

  const inconsistent = fixture()
  inconsistent.matrix.itemCounts = [500]
  assert.throws(() => buildDeviceEvidence(inconsistent, 'abc123'), /matrix does not match/)

  assert.throws(() => buildDeviceEvidence(fixture(), 'different'), /revision .* does not match/)
})

function fixture() {
  const environment = {
    userAgent: 'Mozilla/5.0 Android Chrome/151.0',
    platform: 'Linux armv8l',
    gpuRenderer: 'Adreno 640',
  }
  const renderer = {
    gpuBytes: 1000,
    metrics: {
      textureBytes: 800,
      geometryBuilds: 1,
      resourceFailures: 0,
      programFailures: 0,
    },
  }
  const samples = Array.from({ length: 8 }, (_value, index) => ({
    elapsedMs: index * 5_000,
    stats: { contextLost: false, renderer },
  }))
  const result = {
    version: 1,
    configuration: {
      itemCount: 1000,
      qualityMode: 'medium',
      layout: 'sphere',
      scenario: 'transition-stress',
      environment,
    },
    durationMs: 20_000,
    averageFps: 60,
    averageFrameMs: 16.7,
    maximumFrameTimeP95: 18,
    longFramesOver24Ms: 0,
    longFramesOver33Ms: 0,
    longFramesOver50Ms: 0,
    maximumDrawCalls: 1,
    renderedItems: 1000,
    submittedItems: 1000,
    imageFailures: 0,
    samples,
  }
  return {
    version: 1,
    kind: 'spatial-motion-device-capture',
    generatedAt: '2026-08-02T00:00:00.000Z',
    sourceRevision: 'abc123',
    browser: { name: 'chromium', version: '151', userAgent: environment.userAgent },
    matrix: {
      durationSeconds: 20,
      itemCounts: [1000],
      qualities: ['medium'],
      scenarios: ['transition-stress'],
      contentMode: 'default',
      serverMode: 'device-browser',
      stability: true,
      stabilityIntervalSeconds: 5,
    },
    result,
    diagnostics: { firstRenderSubmitMs: 0, operations: 24 },
    browserSamples: Array.from({ length: 5 }, (_value, index) => ({
      elapsedMs: index * 5_000,
      usedJSHeapBytes: 100 + index,
      totalJSHeapBytes: 200,
      domNodes: 100,
      canvases: 1,
    })),
  }
}
