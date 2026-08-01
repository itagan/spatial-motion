const qualityOrder = ['high', 'medium', 'low']

export const qualityCalibrationProfiles = Object.freeze({
  high: Object.freeze({ targetFps: 60, maxVisibleItems: 2000 }),
  medium: Object.freeze({ targetFps: 45, maxVisibleItems: 1000 }),
  low: Object.freeze({ targetFps: 30, maxVisibleItems: 500 }),
})

const degradeThreshold = 0.78
const maximumLongFrameRatio = 0.08
const longFrameField = 'longFramesOver33Ms'

export function buildQualityCalibration(results, options = {}) {
  if (!Array.isArray(results) || !results.length) {
    throw new TypeError('Quality calibration requires benchmark results')
  }
  const requiredScenarios = normalizeScenarios(options.requiredScenarios ?? ['steady'])
  const evaluations = results.map((result) => evaluateQualityRun(result, options))
  const groups = new Map()

  evaluations.forEach((evaluation) => {
    const { result } = evaluation
    const key = [
      environmentKey(result.configuration.environment),
      result.configuration.itemCount,
      result.configuration.layout,
    ].join('::')
    const group = groups.get(key) ?? {
      environment: result.configuration.environment,
      itemCount: result.configuration.itemCount,
      layout: result.configuration.layout,
      evaluations: [],
    }
    group.evaluations.push(evaluation)
    groups.set(key, group)
  })

  const recommendations = [...groups.values()].map((group) => {
    const candidates = qualityOrder.map((quality) => {
      const scenarioEvaluations = requiredScenarios.map((scenario) =>
        group.evaluations.find(({ result }) =>
          result.configuration.qualityMode === quality
          && (result.configuration.scenario ?? 'steady') === scenario))
      const missingScenarios = requiredScenarios.filter((_scenario, index) =>
        !scenarioEvaluations[index])
      const failures = scenarioEvaluations
        .filter(Boolean)
        .flatMap((evaluation) => evaluation.failures)
      return {
        quality,
        passed: missingScenarios.length === 0 && failures.length === 0,
        missingScenarios,
        failures: [...new Set(failures)],
      }
    })
    return {
      environmentKey: environmentKey(group.environment),
      environment: group.environment,
      itemCount: group.itemCount,
      layout: group.layout,
      requiredScenarios,
      recommendedQuality: candidates.find(({ passed }) => passed)?.quality ?? null,
      candidates,
    }
  })

  return {
    version: 1,
    requiredScenarios,
    evaluations: evaluations.map(({ result, ...evaluation }) => ({
      ...evaluation,
      configuration: result.configuration,
    })),
    recommendations,
  }
}

export function evaluateQualityRun(result, options = {}) {
  assertBenchmarkResult(result)
  const quality = result.configuration.qualityMode
  if (!qualityOrder.includes(quality)) {
    throw new TypeError('Quality calibration requires a fixed qualityMode')
  }
  const profile = {
    ...qualityCalibrationProfiles[quality],
    maxVisibleItems: options.maxVisibleItems?.[quality]
      ?? qualityCalibrationProfiles[quality].maxVisibleItems,
  }
  const minimumFps = profile.targetFps * degradeThreshold
  const frameBudgetMs = 1000 / minimumFps
  const estimatedFrames = Math.max(
    1,
    result.averageFrameMs > 0
      ? result.durationMs / result.averageFrameMs
      : result.durationMs / 1000 * profile.targetFps,
  )
  const longFrameRatio = result[longFrameField] / estimatedFrames
  const failures = []
  const expectedItems = Math.min(result.configuration.itemCount, profile.maxVisibleItems)
  if (result.averageFps < minimumFps) failures.push('AVERAGE_FPS')
  if (result.maximumFrameTimeP95 > frameBudgetMs) failures.push('FRAME_TIME_P95')
  if (longFrameRatio >= maximumLongFrameRatio) failures.push('LONG_FRAME_RATIO')
  if (result.maximumDrawCalls > 1) failures.push('DRAW_CALLS')
  if (result.renderedItems !== expectedItems || result.submittedItems !== expectedItems) {
    failures.push('INSTANCE_COVERAGE')
  }
  if (!result.configuration.environment) failures.push('MISSING_ENVIRONMENT')
  return {
    result,
    quality,
    targetFps: profile.targetFps,
    minimumFps,
    frameBudgetMs,
    expectedItems,
    longFrameField,
    maximumLongFrameRatio,
    longFrameRatio,
    passed: failures.length === 0,
    failures,
  }
}

export function environmentKey(environment) {
  if (!environment || typeof environment !== 'object') return 'unknown-environment'
  return [
    environment.platform || 'unknown-platform',
    environment.gpuVendor || 'unknown-vendor',
    environment.gpuRenderer || 'unknown-renderer',
    `${environment.viewportWidth ?? 0}x${environment.viewportHeight ?? 0}`,
    `dpr-${environment.devicePixelRatio ?? 0}`,
    environment.webglVersion || 'unknown-webgl',
  ].join('|')
}

function assertBenchmarkResult(result) {
  if (!result || typeof result !== 'object' || !result.configuration) {
    throw new TypeError('Invalid benchmark result')
  }
  for (const key of [
    'durationMs',
    'averageFps',
    'averageFrameMs',
    'maximumFrameTimeP95',
    'longFramesOver24Ms',
    'longFramesOver33Ms',
    'longFramesOver50Ms',
    'maximumDrawCalls',
    'renderedItems',
    'submittedItems',
  ]) {
    if (!Number.isFinite(result[key]) || result[key] < 0) {
      throw new TypeError(`Invalid benchmark result field: ${key}`)
    }
  }
  if (!Number.isInteger(result.configuration.itemCount)
    || result.configuration.itemCount < 0
    || typeof result.configuration.layout !== 'string') {
    throw new TypeError('Invalid benchmark configuration')
  }
}

function normalizeScenarios(scenarios) {
  if (!Array.isArray(scenarios) || !scenarios.length
    || scenarios.some((scenario) => typeof scenario !== 'string' || !scenario.trim())) {
    throw new TypeError('requiredScenarios must contain scenario names')
  }
  return [...new Set(scenarios.map((scenario) => scenario.trim()))]
}
