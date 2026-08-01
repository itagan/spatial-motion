export const DEFAULT_STABILITY_THRESHOLDS = Object.freeze({
  retainedHeapGrowthBytes: 16 * 1024 * 1024,
  domNodeGrowth: 5,
  canvasGrowth: 0,
  gpuBytesGrowth: 0,
  textureBytesGrowth: 0,
  geometryBuildGrowth: 0,
})

export function evaluateStabilityRun(browserSamples, result, thresholds = {}) {
  const limits = { ...DEFAULT_STABILITY_THRESHOLDS, ...thresholds }
  const stableBrowserSamples = browserSamples.slice(Math.floor(browserSamples.length / 2))
  const heapValues = finiteValues(stableBrowserSamples, 'usedJSHeapBytes')
  const domValues = finiteValues(stableBrowserSamples, 'domNodes')
  const canvasValues = finiteValues(stableBrowserSamples, 'canvases')
  const rendererSamples = result.samples
    .slice(Math.floor(result.samples.length / 2))
    .map((sample) => sample.stats?.renderer)
    .filter(Boolean)
  const rendererMetrics = rendererSamples.map((renderer) => renderer.metrics ?? {})
  const gpuBytes = finiteNumbers(rendererSamples.map((renderer) => renderer.gpuBytes))
  const textureBytes = finiteNumbers(rendererMetrics.map((entry) => entry.textureBytes))
  const geometryBuilds = finiteValues(rendererMetrics, 'geometryBuilds')
  const resourceFailures = finiteValues(rendererMetrics, 'resourceFailures')
  const programFailures = finiteValues(rendererMetrics, 'programFailures')
  const metrics = {
    retainedHeapGrowthBytes: segmentedLowWaterGrowth(heapValues),
    domNodeGrowth: segmentedLowWaterGrowth(domValues),
    canvasGrowth: segmentedLowWaterGrowth(canvasValues),
    gpuBytesGrowth: valueRange(gpuBytes),
    textureBytesGrowth: valueRange(textureBytes),
    geometryBuildGrowth: counterGrowth(geometryBuilds),
    resourceFailureGrowth: counterGrowth(resourceFailures),
    programFailureGrowth: counterGrowth(programFailures),
    contextLossObserved: result.samples.some((sample) => sample.stats?.contextLost === true),
    imageFailures: result.imageFailures,
  }
  const failures = []
  requireSamples(failures, 'browser-samples', stableBrowserSamples, 2)
  requireSamples(failures, 'dom-node-samples', domValues, 2)
  requireSamples(failures, 'canvas-samples', canvasValues, 2)
  requireSamples(failures, 'renderer-samples', rendererSamples, 2)
  requireSamples(failures, 'gpu-byte-samples', gpuBytes, 2)
  requireSamples(failures, 'texture-byte-samples', textureBytes, 2)
  requireSamples(failures, 'geometry-build-samples', geometryBuilds, 2)
  requireSamples(failures, 'resource-failure-samples', resourceFailures, 2)
  requireSamples(failures, 'program-failure-samples', programFailures, 2)
  checkMaximum(failures, 'retained-heap-growth', metrics.retainedHeapGrowthBytes,
    limits.retainedHeapGrowthBytes)
  checkMaximum(failures, 'dom-node-growth', metrics.domNodeGrowth, limits.domNodeGrowth)
  checkMaximum(failures, 'canvas-growth', metrics.canvasGrowth, limits.canvasGrowth)
  checkMaximum(failures, 'gpu-bytes-growth', metrics.gpuBytesGrowth, limits.gpuBytesGrowth)
  checkMaximum(failures, 'texture-bytes-growth', metrics.textureBytesGrowth,
    limits.textureBytesGrowth)
  checkMaximum(failures, 'geometry-build-growth', metrics.geometryBuildGrowth,
    limits.geometryBuildGrowth)
  checkMaximum(failures, 'resource-failure-growth', metrics.resourceFailureGrowth, 0)
  checkMaximum(failures, 'program-failure-growth', metrics.programFailureGrowth, 0)
  checkMaximum(failures, 'image-failures', metrics.imageFailures, 0)
  if (metrics.contextLossObserved) failures.push({
    code: 'unexpected-context-loss',
    actual: true,
    maximum: false,
  })
  return {
    version: 2,
    passed: failures.length === 0,
    thresholds: limits,
    sampleCounts: {
      stableBrowser: stableBrowserSamples.length,
      heap: heapValues.length,
      dom: domValues.length,
      canvas: canvasValues.length,
      renderer: rendererSamples.length,
      gpuBytes: gpuBytes.length,
      textureBytes: textureBytes.length,
      geometryBuilds: geometryBuilds.length,
      resourceFailures: resourceFailures.length,
      programFailures: programFailures.length,
    },
    metrics,
    failures,
  }
}

function finiteValues(entries, key) {
  return finiteNumbers(entries.map((entry) => entry[key]))
}

function finiteNumbers(values) {
  return values.filter(Number.isFinite)
}

function segmentedLowWaterGrowth(values) {
  if (values.length < 2) return null
  const segmentSize = Math.max(1, Math.ceil(values.length / 3))
  const initialLow = Math.min(...values.slice(0, segmentSize))
  const finalLow = Math.min(...values.slice(-segmentSize))
  return Math.max(0, finalLow - initialLow)
}

function valueRange(values) {
  return values.length < 2 ? null : Math.max(...values) - Math.min(...values)
}

function counterGrowth(values) {
  return values.length < 2 ? null : Math.max(0, values.at(-1) - values[0])
}

function requireSamples(failures, name, values, minimum) {
  if (values.length >= minimum) return
  failures.push({ code: `insufficient-${name}`, actual: values.length, minimum })
}

function checkMaximum(failures, code, actual, maximum) {
  if (actual !== null && actual > maximum) failures.push({ code, actual, maximum })
}
