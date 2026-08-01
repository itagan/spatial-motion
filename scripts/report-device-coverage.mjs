#!/usr/bin/env node

import { readFile, readdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { evaluateDeviceCoverage } from './device-coverage.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const targetPath = resolve(root, 'benchmarks/device-targets.json')
const resultsPath = resolve(root, 'benchmarks/results')
const targetsFile = JSON.parse(await readFile(targetPath, 'utf8'))
const artifacts = await Promise.all((await readdir(resultsPath))
  .filter((name) => name.endsWith('.json'))
  .map(async (name) => ({
    path: `benchmarks/results/${name}`,
    data: JSON.parse(await readFile(resolve(resultsPath, name), 'utf8')),
  })))
const coverage = evaluateDeviceCoverage(targetsFile.targets, artifacts)

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ version: 1, coverage }, null, 2))
} else {
  coverage.forEach((target) => {
    console.log(`${target.status.padEnd(16)} ${target.id} · ${target.label}`)
    target.requirements.forEach((requirement) => {
      const key = `${requirement.itemCount}/${requirement.quality}/${requirement.scenario}/${requirement.minDurationSeconds}s${requirement.stability ? '/stability' : ''}`
      const source = requirement.evidence ? ` · ${requirement.evidence.path}` : ''
      console.log(`  ${requirement.status.padEnd(16)} ${key}${source}`)
    })
  })
}

if (process.argv.includes('--strict') && coverage.some(({ status }) => status !== 'qualified')) {
  process.exitCode = 1
}
