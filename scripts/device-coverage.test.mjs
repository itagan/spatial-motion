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
    artifact('steady-unknown.json', '', 'steady', 10),
    artifact('soak-unknown.json', '', 'transition-stress', 300, true),
  ])
  assert.equal(unknownRevision[0].status, 'development-only')

  const development = evaluateDeviceCoverage(targets, [
    artifact('steady.json', 'abc-dirty', 'steady', 10),
    artifact('soak.json', 'abc-dirty', 'transition-stress', 300, true),
  ])
  assert.equal(development[0].status, 'development-only')
  assert.deepEqual(development[0].requirements.map(({ status }) => status), [
    'development-only',
    'development-only',
  ])

  const qualified = evaluateDeviceCoverage(targets, [
    artifact('steady-clean.json', 'abc', 'steady', 10),
    artifact('soak-clean.json', 'abc', 'transition-stress', 300, true),
  ])
  assert.equal(qualified[0].status, 'qualified')
})

test('rejects the wrong GPU, short duration, and failed stability evidence', () => {
  const coverage = evaluateDeviceCoverage(targets, [
    artifact('intel.json', 'abc', 'steady', 10, false, 'Intel'),
    artifact('short.json', 'abc', 'transition-stress', 60, true),
    artifact('failed.json', 'abc', 'transition-stress', 300, false),
  ])

  assert.equal(coverage[0].status, 'missing')
  assert.equal(coverage[0].requirements[0].status, 'missing')
  assert.equal(coverage[0].requirements[1].status, 'missing')
})

test('rejects legacy stability evidence that did not prove diagnostic coverage', () => {
  const legacy = artifact('legacy.json', 'abc', 'transition-stress', 300, true)
  legacy.data.stabilityDiagnostics[0].evaluation = { passed: true }

  const coverage = evaluateDeviceCoverage(targets, [legacy])
  assert.equal(coverage[0].requirements[1].status, 'missing')
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
      results: [{ configuration, durationMs: durationSeconds * 1000 }],
      stabilityDiagnostics: stabilityPassed
        ? [{ configuration, evaluation: { version: 2, passed: true } }]
        : [],
    },
  }
}
