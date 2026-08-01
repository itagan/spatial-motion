import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildQualityCalibration,
  environmentKey,
  evaluateQualityRun,
} from './quality-calibration.mjs'

const environment = {
  platform: 'test-os',
  gpuVendor: 'test-vendor',
  gpuRenderer: 'test-gpu',
  viewportWidth: 1280,
  viewportHeight: 720,
  devicePixelRatio: 2,
  pixelRatio: 1.5,
}

function result(qualityMode, overrides = {}) {
  return {
    version: 1,
    configuration: {
      itemCount: 1000,
      qualityMode,
      layout: 'sphere',
      scenario: 'steady',
      environment,
    },
    durationMs: 10_000,
    averageFps: qualityMode === 'high' ? 60 : qualityMode === 'medium' ? 45 : 30,
    averageFrameMs: qualityMode === 'high' ? 1000 / 60 : qualityMode === 'medium' ? 1000 / 45 : 1000 / 30,
    maximumFrameTimeP95: qualityMode === 'high' ? 18 : qualityMode === 'medium' ? 24 : 34,
    longFramesOver24Ms: 0,
    longFramesOver33Ms: 0,
    longFramesOver50Ms: 0,
    maximumDrawCalls: 1,
    renderedItems: 1000,
    submittedItems: 1000,
    ...overrides,
  }
}

test('evaluates each fixed quality against its own frame envelope', () => {
  assert.equal(evaluateQualityRun(result('high')).passed, true)
  assert.equal(evaluateQualityRun(result('medium')).passed, true)
  assert.equal(evaluateQualityRun(result('low')).passed, true)

  const failed = evaluateQualityRun(result('high', {
    averageFps: 40,
    maximumFrameTimeP95: 24,
    longFramesOver33Ms: 50,
  }))
  assert.deepEqual(failed.failures, [
    'AVERAGE_FPS',
    'FRAME_TIME_P95',
    'LONG_FRAME_RATIO',
  ])
})

test('recommends the highest passing quality with complete scenario evidence', () => {
  const calibration = buildQualityCalibration([
    result('high', { averageFps: 40 }),
    result('medium'),
    result('low'),
  ])
  assert.equal(calibration.recommendations[0].recommendedQuality, 'medium')

  const stress = result('medium', {
    configuration: {
      ...result('medium').configuration,
      scenario: 'transition-stress',
    },
  })
  const strict = buildQualityCalibration([result('medium'), stress], {
    requiredScenarios: ['steady', 'transition-stress'],
  })
  assert.equal(strict.recommendations[0].recommendedQuality, 'medium')
  assert.deepEqual(strict.recommendations[0].candidates[0].missingScenarios, [
    'steady',
    'transition-stress',
  ])
})

test('separates environment and viewport evidence and rejects auto quality', () => {
  assert.match(environmentKey(environment), /test-gpu/)
  const secondEnvironment = result('low', {
    configuration: {
      ...result('low').configuration,
      environment: { ...environment, viewportWidth: 390, viewportHeight: 844 },
    },
  })
  const calibration = buildQualityCalibration([result('low'), secondEnvironment])
  assert.equal(calibration.recommendations.length, 2)
  assert.throws(() => evaluateQualityRun(result('auto')), /fixed qualityMode/)
  assert.throws(() => buildQualityCalibration([]), /requires benchmark results/)
})
