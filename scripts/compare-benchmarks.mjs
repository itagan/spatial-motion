#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import process from 'node:process'
import {
  defaultBenchmarkRegressionThresholds,
  evaluateBenchmarkRegression,
  parseBenchmarkResult,
} from '../dist/performance/index.js'

const args = process.argv.slice(2)
const positional = args.filter((argument) => !argument.startsWith('--'))
const jsonOutput = args.includes('--json')
const thresholdIndex = args.indexOf('--thresholds')
const presetIndex = args.indexOf('--preset')

if (positional.length < 2) {
  console.error('Usage: spatial-motion-benchmark <baseline.json> <current.json> [--preset id] [--thresholds thresholds.json] [--json]')
  process.exit(2)
}

try {
  const [baselineText, currentText] = await Promise.all([
    readFile(positional[0], 'utf8'),
    readFile(positional[1], 'utf8'),
  ])
  const thresholds = thresholdIndex >= 0
    ? JSON.parse(await readFile(args[thresholdIndex + 1], 'utf8'))
    : defaultBenchmarkRegressionThresholds
  const baseline = parseBenchmarkResult(baselineText)
  const current = parseBenchmarkResult(currentText)
  const preset = presetIndex >= 0 ? args[presetIndex + 1] : null
  if (preset) {
    const presets = JSON.parse(await readFile(new URL('./benchmark-presets.json', import.meta.url), 'utf8'))
    const configuration = presets[preset]
    if (!configuration) throw new TypeError(`Unknown benchmark preset: ${preset}`)
    if (!matchesConfiguration(baseline.configuration, configuration)
      || !matchesConfiguration(current.configuration, configuration)) {
      throw new TypeError(`Benchmark does not match preset: ${preset}`)
    }
  }
  const report = evaluateBenchmarkRegression(baseline, current, thresholds)
  if (jsonOutput) {
    console.log(JSON.stringify({ preset, ...report }, null, 2))
  } else if (!report.compatible) {
    console.error('Benchmark configurations are not comparable.')
  } else if (report.passed) {
    console.log('Benchmark regression check passed.')
  } else {
    console.error(`Benchmark regression check failed (${report.failures.length} metric(s)).`)
    report.failures.forEach((failure) => {
      const percent = failure.regressionPercent === null ? 'n/a' : `${failure.regressionPercent.toFixed(2)}%`
      console.error(`- ${failure.metric}: +${failure.regressionAbsolute.toFixed(3)} (${percent})`)
    })
  }
  process.exit(report.passed ? 0 : 1)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(2)
}

function matchesConfiguration(actual, expected) {
  return ['itemCount', 'qualityMode', 'layout', 'scenario']
    .every((key) => actual[key] === expected[key])
}
