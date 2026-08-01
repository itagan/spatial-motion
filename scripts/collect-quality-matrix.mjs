#!/usr/bin/env node

import { spawn, execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { buildQualityCalibration } from './quality-calibration.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const options = parseArguments(process.argv.slice(2))
const benchmarkUrl = new URL(`http://127.0.0.1:${options.port}/benchmark.html`)
if (options.highMaxVisibleItems !== undefined) {
  benchmarkUrl.searchParams.set('highMaxVisibleItems', String(options.highMaxVisibleItems))
}
if (options.resolution !== undefined) {
  benchmarkUrl.searchParams.set('resolution', String(options.resolution))
}
const baseUrl = benchmarkUrl.href
let server = null
let browser = null

try {
  if (!await isReachable(baseUrl)) {
    server = spawn(process.execPath, [
      fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url)),
      '--host',
      '127.0.0.1',
      '--port',
      String(options.port),
      '--strictPort',
    ], {
      cwd: root,
      stdio: options.verbose ? 'inherit' : 'ignore',
    })
    await waitForServer(baseUrl, server)
  }

  browser = await chromium.launch({ headless: !options.headed })
  const context = await browser.newContext({
    viewport: options.viewport,
    deviceScaleFactor: options.deviceScaleFactor,
  })
  const page = await context.newPage()
  const pageErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') {
      const location = message.location()
      pageErrors.push(location.url
        ? `${message.text()} (${location.url}:${location.lineNumber}:${location.columnNumber})`
        : message.text())
    }
  })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.goto(baseUrl)
  await page.getByText('READY', { exact: true }).waitFor({ timeout: 20_000 })
  assertNoPageErrors(pageErrors)

  const results = []
  const runDiagnostics = []
  for (const itemCount of options.itemCounts) {
    await configureBenchmark(page, { itemCount })
    for (const quality of options.qualities) {
      await configureBenchmark(page, { qualityMode: quality })
      await page.waitForFunction(
        ({ count, mode }) => {
          const items = document.querySelector('#metric-items')?.textContent ?? ''
          const qualityText = document.querySelector('#metric-quality')?.textContent ?? ''
          return items.endsWith(`/ ${count}`) && qualityText.endsWith(`/ ${mode.toUpperCase()}`)
        },
        { count: itemCount, mode: quality },
        { timeout: 20_000 },
      )
      for (const scenario of options.scenarios) {
        await page.locator('#duration').selectOption(String(options.durationSeconds))
        await page.evaluate(() => {
          window.__spatialMotionBenchmarkResult = undefined
          window.__spatialMotionBenchmarkDiagnostics = undefined
        })
        if (scenario === 'transition-stress') {
          await page.locator('#run-stress').click()
        } else {
          await page.locator('#scenario').selectOption(scenario)
          await page.locator('#run-benchmark').click()
        }
        await page.waitForFunction(() =>
          document.querySelector('#benchmark-status')?.textContent?.includes('正在运行'),
        null, { timeout: 5_000 })
        await page.waitForFunction(() =>
          document.querySelector('#benchmark-status')?.textContent?.includes('采样完成：'),
        null, { timeout: options.durationSeconds * 1000 + 20_000 })
        const { result, diagnostics } = await page.evaluate(() => ({
          result: window.__spatialMotionBenchmarkResult,
          diagnostics: window.__spatialMotionBenchmarkDiagnostics,
        }))
        if (!result) throw new Error('Benchmark page did not expose a completed result')
        results.push(result)
        runDiagnostics.push({
          configuration: result.configuration,
          firstRenderSubmitMs: diagnostics?.firstRenderSubmitMs ?? 0,
          operations: diagnostics?.operations ?? 0,
        })
        assertNoPageErrors(pageErrors)
        console.log([
          itemCount,
          quality,
          scenario,
          `${result.averageFps.toFixed(1)} FPS`,
          `P95 ${result.maximumFrameTimeP95.toFixed(1)} ms`,
        ].join(' · '))
      }
    }
  }

  const calibration = buildQualityCalibration(results, {
    requiredScenarios: options.scenarios,
    maxVisibleItems: options.highMaxVisibleItems === undefined
      ? undefined
      : { high: options.highMaxVisibleItems },
  })
  const output = {
    version: 1,
    generatedAt: new Date().toISOString(),
    sourceRevision: resolveRevision(root),
    browser: {
      name: 'chromium',
      version: await browser.version(),
      headless: !options.headed,
    },
    matrix: {
      durationSeconds: options.durationSeconds,
      itemCounts: options.itemCounts,
      qualities: options.qualities,
      scenarios: options.scenarios,
      viewport: options.viewport,
      deviceScaleFactor: options.deviceScaleFactor,
      highMaxVisibleItems: options.highMaxVisibleItems ?? null,
      resolution: options.resolution ?? 'auto',
    },
    results,
    runDiagnostics,
    calibration,
  }
  const outputPath = resolve(root, options.output)
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`)
  console.log(`Quality matrix written to ${outputPath}`)
  calibration.recommendations.forEach(({ itemCount, recommendedQuality, environmentKey }) => {
    console.log(`${itemCount} items · ${recommendedQuality ?? 'no passing quality'} · ${environmentKey}`)
  })
} finally {
  await browser?.close()
  server?.kill('SIGTERM')
}

function parseArguments(args) {
  const read = (name, fallback) => {
    const index = args.indexOf(name)
    return index >= 0 ? args[index + 1] : fallback
  }
  const durationSeconds = positiveInteger(read('--duration', '3'), '--duration')
  if (![3, 10, 20, 60, 300, 1800].includes(durationSeconds)) {
    throw new TypeError('--duration must match a benchmark page option')
  }
  return {
    durationSeconds,
    itemCounts: integerList(read('--items', '500,1000,2000'), '--items'),
    qualities: enumList(read('--qualities', 'high,medium,low'), '--qualities', [
      'high', 'medium', 'low',
    ]),
    scenarios: enumList(read('--scenarios', 'steady'), '--scenarios', [
      'steady', 'cold-start', 'atlas-update', 'interaction-stress', 'transition-stress',
    ]),
    viewport: parseViewport(read('--viewport', '1265x633')),
    deviceScaleFactor: positiveNumber(read('--dpr', '1'), '--dpr'),
    output: read('--output', `benchmarks/results/quality-matrix-${dateStamp()}.json`),
    port: positiveInteger(read('--port', '4174'), '--port'),
    headed: args.includes('--headed'),
    verbose: args.includes('--verbose'),
    highMaxVisibleItems: optionalPositiveInteger(
      read('--high-max-visible-items', undefined),
      '--high-max-visible-items',
    ),
    resolution: optionalPositiveInteger(read('--resolution', undefined), '--resolution'),
  }
}

function integerList(value, name) {
  const values = String(value).split(',').map((entry) => positiveInteger(entry, name))
  return [...new Set(values)]
}

function enumList(value, name, allowed) {
  const values = String(value).split(',').map((entry) => entry.trim()).filter(Boolean)
  if (!values.length || values.some((entry) => !allowed.includes(entry))) {
    throw new TypeError(`${name} contains an unsupported value`)
  }
  return [...new Set(values)]
}

function parseViewport(value) {
  const match = /^(\d+)x(\d+)$/.exec(String(value))
  if (!match) throw new TypeError('--viewport must use WIDTHxHEIGHT')
  return {
    width: positiveInteger(match[1], '--viewport'),
    height: positiveInteger(match[2], '--viewport'),
  }
}

function positiveInteger(value, name) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) throw new TypeError(`${name} must be positive`)
  return parsed
}

function positiveNumber(value, name) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) throw new TypeError(`${name} must be positive`)
  return parsed
}

function optionalPositiveInteger(value, name) {
  return value === undefined ? undefined : positiveInteger(value, name)
}

async function isReachable(url) {
  try {
    return (await fetch(url)).ok
  } catch {
    return false
  }
}

async function waitForServer(url, child) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('Benchmark development server exited early')
    if (await isReachable(url)) return
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
  throw new Error('Timed out waiting for benchmark development server')
}

function resolveRevision(directory) {
  try {
    const revision = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
      cwd: directory,
      encoding: 'utf8',
    }).trim()
    const dirty = execFileSync('git', ['status', '--porcelain'], {
      cwd: directory,
      encoding: 'utf8',
    }).trim()
    return dirty ? `${revision}-dirty` : revision
  } catch {
    return 'unknown'
  }
}

async function configureBenchmark(page, configuration) {
  await page.evaluate(async (nextConfiguration) => {
    if (!window.__spatialMotionBenchmarkConfigure) {
      throw new Error('Benchmark page does not expose its configuration hook')
    }
    await window.__spatialMotionBenchmarkConfigure(nextConfiguration)
  }, configuration)
}

function assertNoPageErrors(pageErrors) {
  if (pageErrors.length) {
    throw new Error(`Benchmark page errors:\n${pageErrors.join('\n')}`)
  }
}

function dateStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
}
