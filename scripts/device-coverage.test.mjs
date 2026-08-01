import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateDeviceCoverage } from './device-coverage.mjs'

const targets = [{
  id: 'apple',
  label: 'Apple',
  match: { browserNames: ['chromium'], gpuPattern: 'Apple' },
  requirements: [
    { itemCount: 2000, quality: 'high', scenario: 'steady', minDurationSeconds: 10 },
    {
      itemCount: 2000,
      quality: 'high',
      scenario: 'transition-stress',
      minDurationSeconds: 300,
      stability: true,
    },
  ],
}]

test('distinguishes missing, development-only, and clean qualified evidence', () => {
  const missing = evaluateDeviceCoverage(targets, [])
  assert.equal(missing[0].status, 'missing')

  const unknownRevision = evaluateDeviceCoverage(targets, [
    artifact('steady-unknown.json', 'unknown', 'steady', 10),
    artifact('soak-unknown.json', 'unknown', 'transition-stress', 300, true),
  ])
  assert.equal(unknownRevision[0].status, 'development-only')

  const development = evaluateDeviceCoverage(targets, [
    artifact('steady.json', 'abc1234-dirty', 'steady', 10),
    artifact('soak.json', 'abc1234-dirty', 'transition-stress', 300, true),
  ])
  assert.equal(development[0].status, 'development-only')
  assert.deepEqual(development[0].requirements.map(({ status }) => status), [
    'development-only',
    'development-only',
  ])

  const qualified = evaluateDeviceCoverage(targets, [
    artifact('steady-clean.json', 'abc1234', 'steady', 10),
    artifact('soak-clean.json', 'abc1234', 'transition-stress', 300, true),
  ])
  assert.equal(qualified[0].status, 'qualified')
  assert.equal(qualified[0].sourceRevision, 'abc1234')

  const mixed = evaluateDeviceCoverage(targets, [
    artifact('steady-mixed.json', 'abc1234', 'steady', 10),
    artifact('soak-mixed.json', 'def5678', 'transition-stress', 300, true),
  ])
  assert.equal(mixed[0].status, 'mixed-revision')
  assert.equal(mixed[0].sourceRevision, null)
})

test('rejects the wrong GPU, short duration, and failed stability evidence', () => {
  const coverage = evaluateDeviceCoverage(targets, [
    artifact('intel.json', 'abc1234', 'steady', 10, false, 'Intel'),
    artifact('short.json', 'abc1234', 'transition-stress', 60, true),
    artifact('failed.json', 'abc1234', 'transition-stress', 300, false),
  ])

  assert.equal(coverage[0].status, 'missing')
  assert.equal(coverage[0].requirements[0].status, 'missing')
  assert.equal(coverage[0].requirements[1].status, 'missing')
})

test('rejects evidence that fails its quality calibration envelope', () => {
  const failedSteady = artifact('slow.json', 'abc1234', 'steady', 10)
  failedSteady.data.calibration.evaluations[0] = {
    configuration: failedSteady.data.results[0].configuration,
    passed: false,
    failures: ['AVERAGE_FPS', 'DRAW_CALLS'],
  }
  const coverage = evaluateDeviceCoverage(targets, [
    failedSteady,
    artifact('soak.json', 'abc1234', 'transition-stress', 300, true),
  ])

  assert.equal(coverage[0].status, 'missing')
  assert.equal(coverage[0].requirements[0].status, 'missing')
  assert.deepEqual(coverage[0].requirements[0].rejectedEvidence[0].failures, [
    'QUALITY_CALIBRATION',
  ])
  assert.deepEqual(coverage[0].requirements[0].rejectedEvidence[0].qualityFailures, [
    'AVERAGE_FPS',
    'DRAW_CALLS',
  ])

  const stalePass = artifact('stale-pass.json', 'abc1234', 'steady', 10)
  stalePass.data.results[0].averageFps = 1
  const recalculated = evaluateDeviceCoverage(targets, [
    stalePass,
    artifact('soak.json', 'abc1234', 'transition-stress', 300, true),
  ])
  assert.equal(recalculated[0].requirements[0].status, 'missing')
  assert.ok(recalculated[0].requirements[0].rejectedEvidence[0].qualityFailures
    .includes('AVERAGE_FPS'))
})

test('rejects legacy stability evidence that did not prove diagnostic coverage', () => {
  const legacy = artifact('legacy.json', 'abc1234', 'transition-stress', 300, true)
  legacy.data.stabilityDiagnostics[0].evaluation = { passed: true }

  const coverage = evaluateDeviceCoverage(targets, [legacy])
  assert.equal(coverage[0].requirements[1].status, 'missing')
})

test('requires target viewport, DPR, and mobile GPU boundaries', () => {
  const mobileTargets = [{
    id: 'android',
    label: 'Android',
    match: {
      browserNames: ['chromium'],
      userAgentPattern: 'Android',
      gpuPattern: 'Adreno|Mali',
      maxViewportWidth: 600,
      minViewportHeight: 600,
      minDevicePixelRatio: 2,
    },
    requirements: [
      { itemCount: 2000, quality: 'high', scenario: 'steady', minDurationSeconds: 10 },
    ],
  }]
  const valid = artifact('android.json', 'abc1234', 'steady', 10, false, 'Adreno 640')
  valid.data.results[0].configuration.environment = {
    ...valid.data.results[0].configuration.environment,
    userAgent: 'Android Chrome',
    viewportWidth: 412,
    viewportHeight: 915,
    devicePixelRatio: 2.625,
  }
  assert.equal(evaluateDeviceCoverage(mobileTargets, [valid])[0].status, 'qualified')

  const desktopViewport = structuredClone(valid)
  desktopViewport.data.results[0].configuration.environment.viewportWidth = 1265
  assert.equal(evaluateDeviceCoverage(mobileTargets, [desktopViewport])[0].status, 'missing')

  const desktopGpu = structuredClone(valid)
  desktopGpu.data.results[0].configuration.environment.gpuRenderer = 'Apple M4'
  assert.equal(evaluateDeviceCoverage(mobileTargets, [desktopGpu])[0].status, 'missing')
})

function artifact(path, sourceRevision, scenario, durationSeconds, stabilityPassed = false,
  gpuRenderer = 'ANGLE Apple M4') {
  const configuration = {
    itemCount: 2000,
    qualityMode: 'high',
    scenario,
    layout: 'sphere',
    environment: { platform: 'MacIntel', gpuRenderer, userAgent: 'Chromium' },
  }
  return {
    path,
    data: {
      sourceRevision,
      browser: { name: 'chromium' },
      results: [{
        configuration,
        durationMs: durationSeconds * 1000,
        averageFps: 60,
        averageFrameMs: 16.7,
        maximumFrameTimeP95: 18,
        longFramesOver24Ms: 0,
        longFramesOver33Ms: 0,
        longFramesOver50Ms: 0,
        maximumDrawCalls: 1,
        renderedItems: 2000,
        submittedItems: 2000,
      }],
      calibration: {
        evaluations: [{ configuration, passed: true, failures: [] }],
      },
      stabilityDiagnostics: stabilityPassed
        ? [{ configuration, evaluation: { version: 2, passed: true } }]
        : [],
    },
  }
}
