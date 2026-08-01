export function evaluateDeviceCoverage(targets, artifacts) {
  const evidence = artifacts.flatMap(flattenArtifact)
  return targets.map((target) => {
    const requirementMatches = target.requirements.map((requirement) =>
      evidence
        .filter((entry) => matchesTarget(entry, target.match))
        .filter((entry) => matchesRequirement(entry, requirement))
        .sort(compareEvidence))
    const missing = requirementMatches.some((matches) => matches.length === 0)
    const commonCleanRevisions = missing
      ? []
      : intersectRevisions(requirementMatches.map((matches) =>
          matches.filter(({ cleanRevision }) => cleanRevision)))
    const commonRevisions = missing ? [] : intersectRevisions(requirementMatches)
    const sourceRevision = commonCleanRevisions[0] ?? commonRevisions[0] ?? null
    const status = missing
      ? 'missing'
      : commonCleanRevisions.length > 0
        ? 'qualified'
        : commonRevisions.length > 0
          ? 'development-only'
          : 'mixed-revision'
    const requirements = target.requirements.map((requirement, index) => {
      const matches = requirementMatches[index]
      const selected = sourceRevision
        ? matches.find((entry) => entry.sourceRevision === sourceRevision) ?? null
        : matches[0] ?? null
      return {
        ...requirement,
        status: selected
          ? selected.cleanRevision ? 'qualified' : 'development-only'
          : 'missing',
        evidence: selected && {
          path: selected.path,
          sourceRevision: selected.sourceRevision,
          durationSeconds: selected.durationSeconds,
          stabilityPassed: selected.stabilityPassed,
        },
      }
    })
    return {
      id: target.id,
      label: target.label,
      status,
      sourceRevision,
      requirements,
    }
  })
}

function intersectRevisions(groups) {
  if (groups.length === 0) return []
  const revisions = new Set(groups[0].map(({ sourceRevision }) => sourceRevision))
  for (const group of groups.slice(1)) {
    const current = new Set(group.map(({ sourceRevision }) => sourceRevision))
    for (const revision of revisions) {
      if (!current.has(revision)) revisions.delete(revision)
    }
  }
  return [...revisions]
}

function flattenArtifact(artifact) {
  if (!Array.isArray(artifact.data?.results)) return []
  return artifact.data.results.map((result) => {
    const sourceRevision = String(artifact.data.sourceRevision ?? '')
    const stability = artifact.data.stabilityDiagnostics?.find((entry) =>
      sameConfiguration(entry.configuration, result.configuration))
    return {
      path: artifact.path,
      browserName: artifact.data.browser?.name ?? '',
      sourceRevision,
      cleanRevision: /^[0-9a-f]{7,40}$/i.test(sourceRevision),
      configuration: result.configuration,
      durationSeconds: Number(result.durationMs ?? 0) / 1000,
      stabilityPassed: stability?.evaluation?.version === 2
        && stability.evaluation.passed === true,
    }
  })
}

function matchesTarget(entry, match) {
  const environment = entry.configuration.environment ?? {}
  return (!match.browserNames || match.browserNames.includes(entry.browserName))
    && matchesPattern(environment.platform, match.platformPattern)
    && matchesPattern(environment.gpuRenderer, match.gpuPattern)
    && matchesPattern(environment.userAgent, match.userAgentPattern)
    && matchesMinimum(environment.viewportWidth, match.minViewportWidth)
    && matchesMaximum(environment.viewportWidth, match.maxViewportWidth)
    && matchesMinimum(environment.viewportHeight, match.minViewportHeight)
    && matchesMaximum(environment.viewportHeight, match.maxViewportHeight)
    && matchesMinimum(environment.devicePixelRatio, match.minDevicePixelRatio)
    && matchesMaximum(environment.devicePixelRatio, match.maxDevicePixelRatio)
}

function matchesRequirement(entry, requirement) {
  const configuration = entry.configuration
  return configuration.itemCount === requirement.itemCount
    && configuration.qualityMode === requirement.quality
    && configuration.scenario === requirement.scenario
    && entry.durationSeconds >= requirement.minDurationSeconds
    && (!requirement.stability || entry.stabilityPassed)
}

function matchesPattern(value, pattern) {
  return !pattern || new RegExp(pattern, 'i').test(String(value ?? ''))
}

function matchesMinimum(value, minimum) {
  return minimum === undefined || Number.isFinite(value) && value >= minimum
}

function matchesMaximum(value, maximum) {
  return maximum === undefined || Number.isFinite(value) && value <= maximum
}

function compareEvidence(left, right) {
  if (left.cleanRevision !== right.cleanRevision) return left.cleanRevision ? -1 : 1
  return right.durationSeconds - left.durationSeconds
}

function sameConfiguration(left, right) {
  return left?.itemCount === right?.itemCount
    && left?.qualityMode === right?.qualityMode
    && left?.scenario === right?.scenario
    && left?.layout === right?.layout
}
