import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateStabilityRun } from './stability-evaluation.mjs'

test('accepts stable browser and renderer resources across GC sawtooth samples', () => {
  const evaluation = evaluateStabilityRun([
    browserSample(30, 90, 1),
    browserSample(10, 95, 1),
    browserSample(25, 98, 1),
    browserSample(11, 100, 1),
    browserSample(12, 100, 1),
    browserSample(20, 100, 1),
    browserSample(13, 100, 1),
    browserSample(18, 100, 1),
  ], result([
    rendererSample(1000, 800, 1),
    rendererSample(1000, 800, 1),
    rendererSample(1000, 800, 1),
    rendererSample(1000, 800, 1),
  ]), { retainedHeapGrowthBytes: 4 })

  assert.equal(evaluation.passed, true)
  assert.equal(evaluation.metrics.retainedHeapGrowthBytes, 1)
  assert.deepEqual(evaluation.failures, [])
})

test('reports retained heap, DOM, GPU capacity, rebuild, and failure growth', () => {
  const evaluation = evaluateStabilityRun([
    browserSample(10, 90, 1),
    browserSample(12, 95, 1),
    browserSample(14, 98, 1),
    browserSample(16, 100, 1),
    browserSample(20, 110, 1),
    browserSample(22, 112, 1),
    browserSample(30, 120, 2),
    browserSample(32, 122, 2),
  ], result([
    rendererSample(1000, 800, 1),
    rendererSample(1000, 800, 1),
    rendererSample(1200, 900, 2),
    rendererSample(1200, 900, 2),
    rendererSample(1400, 1000, 3),
    rendererSample(1600, 1100, 4, 1),
  ], { contextLost: true, imageFailures: 1 }), {
    retainedHeapGrowthBytes: 4,
    domNodeGrowth: 5,
  })

  assert.equal(evaluation.passed, false)
  assert.deepEqual(new Set(evaluation.failures.map(({ code }) => code)), new Set([
    'retained-heap-growth',
    'dom-node-growth',
    'canvas-growth',
    'gpu-bytes-growth',
    'texture-bytes-growth',
    'geometry-build-growth',
    'resource-failure-growth',
    'image-failures',
    'unexpected-context-loss',
  ]))
})

test('rejects incomplete browser and renderer diagnostics instead of assuming zero growth', () => {
  const evaluation = evaluateStabilityRun([
    browserSample(10, 90, 1),
  ], result([{
    elapsedMs: 0,
    stats: { contextLost: false, renderer: { gpuBytes: 1000, metrics: {} } },
  }]))

  assert.equal(evaluation.passed, false)
  assert.ok(evaluation.failures.some(({ code }) => code === 'insufficient-browser-samples'))
  assert.ok(evaluation.failures.some(({ code }) => code === 'insufficient-renderer-samples'))
  assert.ok(evaluation.failures.some(({ code }) =>
    code === 'insufficient-resource-failure-samples'))
  assert.equal(evaluation.metrics.resourceFailureGrowth, null)
})

function browserSample(usedJSHeapBytes, domNodes, canvases) {
  return { usedJSHeapBytes, domNodes, canvases }
}

function rendererSample(gpuBytes, textureBytes, geometryBuilds, resourceFailures = 0) {
  return {
    elapsedMs: 0,
    stats: {
      contextLost: false,
      renderer: {
        gpuBytes,
        metrics: {
          textureBytes,
          geometryBuilds,
          resourceFailures,
          programFailures: 0,
        },
      },
    },
  }
}

function result(samples, overrides = {}) {
  if (overrides.contextLost) samples.at(-1).stats.contextLost = true
  return {
    samples,
    imageFailures: overrides.imageFailures ?? 0,
  }
}
