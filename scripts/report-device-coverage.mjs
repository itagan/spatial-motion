#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { evaluateDeviceCoverage } from './device-coverage.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const targetPath = resolve(root, 'benchmarks/device-targets.json')
const resultsPath = resolve(root, 'benchmarks/results')
const targetsFile = JSON.parse(await readFile(targetPath, 'utf8'))
const revisionCache = new Map()
const artifacts = await Promise.all((await readdir(resultsPath))
  .filter((name) => name.endsWith('.json'))
  .map(async (name) => {
    const data = JSON.parse(await readFile(resolve(resultsPath, name), 'utf8'))
    return {
      path: `benchmarks/results/${name}`,
      data,
      revisionKnown: isGitCommit(data.sourceRevision),
    }
  }))
const coverage = evaluateDeviceCoverage(targetsFile.targets, artifacts)

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ version: 1, coverage }, null, 2))
} else {
  coverage.forEach((target) => {
    const revision = target.sourceRevision ? ` · ${target.sourceRevision}` : ''
    console.log(`${target.status.padEnd(16)} ${target.id} · ${target.label}${revision}`)
    target.requirements.forEach((requirement) => {
      const key = `${requirement.itemCount}/${requirement.quality}/${requirement.scenario}/${requirement.minDurationSeconds}s${requirement.stability ? '/stability' : ''}`
      const source = requirement.evidence ? ` · ${requirement.evidence.path}` : ''
      console.log(`  ${requirement.status.padEnd(16)} ${key}${source}`)
      if (requirement.evidence) return
      requirement.rejectedEvidence.forEach((rejected) => {
        const quality = rejected.qualityFailures.length
          ? `:${rejected.qualityFailures.join(',')}`
          : ''
        const stability = rejected.stabilityFailures.length
          ? `:${rejected.stabilityFailures.join(',')}`
          : ''
        console.log(`    rejected ${rejected.failures.join('+')}${quality}${stability} · ${rejected.path}`)
      })
    })
  })
}

if (process.argv.includes('--strict') && coverage.some(({ status }) => status !== 'qualified')) {
  process.exitCode = 1
}

function isGitCommit(value) {
  const revision = String(value ?? '')
  if (!/^[0-9a-f]{7,40}$/i.test(revision)) return false
  if (revisionCache.has(revision)) return revisionCache.get(revision)
  let known = false
  try {
    execFileSync('git', ['cat-file', '-e', `${revision}^{commit}`], {
      cwd: root,
      stdio: 'ignore',
    })
    known = true
  } catch {
    known = false
  }
  revisionCache.set(revision, known)
  return known
}
