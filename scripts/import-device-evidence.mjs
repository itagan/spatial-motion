#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { buildDeviceEvidence } from './device-evidence.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const [input] = process.argv.slice(2).filter((argument) => !argument.startsWith('--'))
const outputIndex = process.argv.indexOf('--output')
const output = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined
if (!input || !output) {
  throw new TypeError('Usage: benchmark:import-device -- <capture.json> --output <evidence.json>')
}

const capture = JSON.parse(await readFile(resolve(process.cwd(), input), 'utf8'))
const evidence = buildDeviceEvidence(capture, resolveRevision(root))
const outputPath = resolve(process.cwd(), output)
await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`)

const evaluation = evidence.stabilityDiagnostics[0]?.evaluation
console.log(`Device evidence written to ${outputPath}`)
console.log([
  evidence.browser.name,
  evidence.results[0].configuration.environment?.platform ?? 'unknown-platform',
  evidence.results[0].configuration.environment?.gpuRenderer ?? 'unknown-gpu',
  evaluation ? `stability-v${evaluation.version}:${evaluation.passed ? 'passed' : 'failed'}` : 'steady',
].join(' · '))
if (evaluation && !evaluation.passed) process.exitCode = 1

function resolveRevision(directory) {
  try {
    const revision = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
      cwd: directory,
      encoding: 'utf8',
    }).trim()
    const status = execFileSync('git', ['status', '--porcelain'], {
      cwd: directory,
      encoding: 'utf8',
    }).trim()
    const dirty = status.split('\n').filter(Boolean).some((entry) =>
      !statusPath(entry).startsWith('benchmarks/results/'))
    return dirty ? `${revision}-dirty` : revision
  } catch {
    return 'unknown'
  }
}

function statusPath(entry) {
  const path = entry.slice(3)
  const renameSeparator = path.lastIndexOf(' -> ')
  return renameSeparator >= 0 ? path.slice(renameSeparator + 4) : path
}
