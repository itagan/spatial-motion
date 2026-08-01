import { buildQualityCalibration } from './quality-calibration.mjs'
import { evaluateStabilityRun } from './stability-evaluation.mjs'

export function buildDeviceEvidence(capture, sourceRevision) {
  assertCapture(capture)
  if (typeof sourceRevision !== 'string' || !sourceRevision) {
    throw new TypeError('Device evidence requires a source revision')
  }
  if (capture.sourceRevision !== sourceRevision) {
    throw new TypeError(
      `Device capture revision ${capture.sourceRevision ?? 'unknown'} does not match ${sourceRevision}`,
    )
  }
  const result = capture.result
  const scenario = result.configuration.scenario ?? 'steady'
  const stabilityDiagnostics = capture.matrix.stability
    ? [{
        configuration: result.configuration,
        intervalSeconds: capture.matrix.stabilityIntervalSeconds,
        browserSamples: capture.browserSamples,
        evaluation: evaluateDeviceStability(capture, result),
      }]
    : []
  return {
    version: 1,
    generatedAt: capture.generatedAt,
    sourceRevision,
    browser: capture.browser,
    matrix: capture.matrix,
    results: [result],
    runDiagnostics: [{
      configuration: result.configuration,
      firstRenderSubmitMs: capture.diagnostics.firstRenderSubmitMs,
      operations: capture.diagnostics.operations,
      residentItems: result.renderedItems,
      submittedItems: result.submittedItems,
    }],
    stabilityDiagnostics,
    calibration: buildQualityCalibration([result], { requiredScenarios: [scenario] }),
  }
}

function evaluateDeviceStability(capture, result) {
  const evaluation = evaluateStabilityRun(capture.browserSamples, result)
  const elapsed = capture.browserSamples
    .map(({ elapsedMs }) => elapsedMs)
    .filter(Number.isFinite)
  const spanMs = elapsed.length < 2 ? null : elapsed.at(-1) - elapsed[0]
  const coverageRatio = spanMs === null || result.durationMs <= 0
    ? null
    : spanMs / result.durationMs
  const maximumGapMs = elapsed.length < 2
    ? null
    : Math.max(...elapsed.slice(1).map((value, index) => value - elapsed[index]))
  const timingFailures = []
  if (elapsed.length !== capture.browserSamples.length || elapsed.length < 2) {
    timingFailures.push({
      code: 'insufficient-browser-timing-samples',
      actual: elapsed.length,
      minimum: Math.max(2, capture.browserSamples.length),
    })
  }
  if (coverageRatio !== null && coverageRatio < 0.9) timingFailures.push({
    code: 'browser-sample-coverage',
    actual: coverageRatio,
    minimum: 0.9,
  })
  const maximumAllowedGapMs = capture.matrix.stabilityIntervalSeconds * 2_500
  if (maximumGapMs !== null && maximumGapMs > maximumAllowedGapMs) timingFailures.push({
    code: 'browser-sample-gap',
    actual: maximumGapMs,
    maximum: maximumAllowedGapMs,
  })
  return {
    ...evaluation,
    passed: evaluation.passed && timingFailures.length === 0,
    metrics: {
      ...evaluation.metrics,
      browserSampleSpanMs: spanMs,
      browserSampleCoverageRatio: coverageRatio,
      maximumBrowserSampleGapMs: maximumGapMs,
    },
    failures: [...evaluation.failures, ...timingFailures],
  }
}

function assertCapture(capture) {
  if (!capture || typeof capture !== 'object'
    || capture.version !== 1
    || capture.kind !== 'spatial-motion-device-capture') {
    throw new TypeError('Unsupported device capture')
  }
  if (typeof capture.sourceRevision !== 'string' || !capture.sourceRevision) {
    throw new TypeError('Device capture is missing its build revision')
  }
  if (!capture.result || typeof capture.result !== 'object') {
    throw new TypeError('Device capture is missing its benchmark result')
  }
  if (!capture.browser || typeof capture.browser.name !== 'string'
    || typeof capture.browser.userAgent !== 'string') {
    throw new TypeError('Device capture is missing browser identity')
  }
  if (!capture.matrix || typeof capture.matrix !== 'object'
    || !Number.isFinite(capture.matrix.durationSeconds)
    || !Number.isFinite(capture.matrix.stabilityIntervalSeconds)) {
    throw new TypeError('Device capture is missing matrix metadata')
  }
  if (!capture.diagnostics || !Number.isFinite(capture.diagnostics.firstRenderSubmitMs)
    || !Number.isFinite(capture.diagnostics.operations)) {
    throw new TypeError('Device capture is missing run diagnostics')
  }
  if (!Array.isArray(capture.browserSamples)) {
    throw new TypeError('Device capture is missing browser samples')
  }
  const environmentUserAgent = capture.result.configuration?.environment?.userAgent
  if (environmentUserAgent !== capture.browser.userAgent) {
    throw new TypeError('Device capture browser identity does not match its environment')
  }
  if (capture.matrix.durationSeconds * 1000 > capture.result.durationMs + 2_000
    || capture.matrix.durationSeconds * 1000 < capture.result.durationMs - 2_000) {
    throw new TypeError('Device capture duration does not match its benchmark result')
  }
  if (capture.matrix.stability
    && capture.matrix.stabilityIntervalSeconds > capture.matrix.durationSeconds / 2) {
    throw new TypeError('Device capture stability interval is too sparse')
  }
  const scenario = capture.result.configuration?.scenario ?? 'steady'
  if (capture.matrix.itemCounts?.length !== 1
    || capture.matrix.itemCounts[0] !== capture.result.configuration?.itemCount
    || capture.matrix.qualities?.length !== 1
    || capture.matrix.qualities[0] !== capture.result.configuration?.qualityMode
    || capture.matrix.scenarios?.length !== 1
    || capture.matrix.scenarios[0] !== scenario) {
    throw new TypeError('Device capture matrix does not match its benchmark result')
  }
  if (capture.matrix.stability !== (capture.matrix.durationSeconds >= 20)) {
    throw new TypeError('Device capture stability mode does not match its duration')
  }
}
