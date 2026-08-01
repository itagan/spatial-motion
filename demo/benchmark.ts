import {
  BenchmarkSession,
  compareBenchmarkResults,
  parseBenchmarkResult,
  MotionStage,
  qualityProfiles,
  cardsRenderer,
  box,
  cone,
  cylinder,
  grid,
  helix,
  linearShooter,
  radialBurst,
  ring,
  sphere,
  tunnel,
  vortex,
  type BenchmarkResult,
  type CardContentRenderer,
  type DrawCard,
  type Layout,
  type MotionItem,
  type QualityMode,
  type StreamingEffect,
  type StageExtensionHandle,
} from '@spatial-motion'
import { createGsapExtension, createNativeThreeExtension } from './extensions'
import './style.css'
import './benchmark.css'

const avatarPool = Array.from({ length: 24 }, (_, index) => createAvatar(index))
const createItems = (count: number): MotionItem[] => Array.from({ length: count }, (_, index) => ({
  id: `benchmark-${index + 1}`,
  title: String(index + 1).padStart(4, '0'),
  image: avatarPool[index % avatarPool.length],
}))

const layouts: Record<string, Layout> = {
  sphere: sphere({ radius: 5.2 }),
  box: box({ width: 8, height: 7, depth: 6 }),
  cylinder: cylinder({ radius: 5 }),
  grid: grid({ fit: 'contain' }),
  ring: ring({ innerRadius: 0.8, spacing: 0.42 }),
  helix: helix({ radius: 4.6, height: 9 }),
  cone: cone({ radius: 5, height: 9, stagger: true }),
}
const effects: Record<string, StreamingEffect> = {
  tunnel: tunnel({ maxActiveItems: 300 }),
  'tunnel-square': tunnel({ crossSection: 'square', maxActiveItems: 300 }),
  'tunnel-burst': tunnel({ emission: { mode: 'burst' }, maxActiveItems: 300 }),
  'tunnel-wave': tunnel({ emission: { mode: 'wave' }, maxActiveItems: 300 }),
  'shooter-wave': linearShooter({ emission: { mode: 'wave' }, maxActiveItems: 300 }),
  vortex: vortex({ maxActiveItems: 300 }),
  burst: radialBurst({ maxActiveItems: 300 }),
}

const container = document.querySelector<HTMLElement>('#benchmark-stage')
if (!container) throw new Error('Benchmark stage container not found')

const benchmarkParameters = new URLSearchParams(window.location.search)
type BenchmarkContentMode = 'default' | 'template' | 'canvas'
const contentParameter = benchmarkParameters.get('content')
const requestedContentMode: BenchmarkContentMode = contentParameter === 'template'
  || contentParameter === 'canvas'
  ? contentParameter
  : 'default'
const requestedResolution = resolveBenchmarkResolution(benchmarkParameters.get('resolution'))
const mipmapsParameter = benchmarkParameters.get('mipmaps')
const requestedMipmaps = mipmapsParameter === '1'
  ? true
  : mipmapsParameter === '0' ? false : undefined
const requestedTexturePrewarm = resolveTexturePrewarm(benchmarkParameters.get('prewarm'))
const requestedHighMaxVisibleItems = resolvePositiveInteger(
  benchmarkParameters.get('highMaxVisibleItems'),
)
const atlasParameter = benchmarkParameters.get('atlas')
const requestedAtlasMode = atlasParameter === 'single'
  || atlasParameter === 'array'
  || atlasParameter === 'auto'
  ? atlasParameter
  : 'auto'
let benchmarkTemplate: CardContentRenderer | undefined
if (requestedContentMode === 'template') {
  const { defineCardTemplate, html } = await import('@spatial-motion/card-template')
  benchmarkTemplate = defineCardTemplate((item) => html`
    <div class="benchmark-card">
      <img src=${item.image} style="height:70%;object-fit:cover;object-position:50% 35%" />
      <div class="benchmark-copy">
        <span class="benchmark-title">${item.title}</span>
        <span class="benchmark-rank">PARTICIPANT</span>
      </div>
    </div>
  `, {
    styles: {
      'benchmark-card': {
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        padding: 3,
        overflow: 'hidden',
        background: 'linear-gradient(145deg, #082f49, #155e75)',
      },
      'benchmark-copy': {
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
      },
      'benchmark-title': {
        color: '#ffffff',
        fontSize: 8,
        fontWeight: 800,
        lineClamp: 1,
        textAlign: 'center',
      },
      'benchmark-rank': {
        color: '#a5f3fc',
        fontSize: 5,
        fontWeight: 700,
        lineClamp: 1,
        textAlign: 'center',
      },
    },
  })
}
const benchmarkCanvasDraw: DrawCard = (context, item, bounds) => {
  const gradient = context.createLinearGradient(
    bounds.x,
    bounds.y,
    bounds.x + bounds.width,
    bounds.y + bounds.height,
  )
  gradient.addColorStop(0, '#312e81')
  gradient.addColorStop(1, '#7e22ce')
  context.fillStyle = gradient
  context.fillRect(bounds.x, bounds.y, bounds.width, bounds.height)
  context.fillStyle = 'rgba(255,255,255,.18)'
  context.beginPath()
  context.arc(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height * 0.38,
    bounds.width * 0.2,
    0,
    Math.PI * 2,
  )
  context.fill()
  context.fillStyle = '#ffffff'
  context.font = `800 ${Math.max(7, bounds.width * 0.16)}px sans-serif`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(
    item.title ?? item.id,
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height * 0.72,
  )
}
const stage = new MotionStage({
  container,
  renderer: cardsRenderer({
    resolution: requestedResolution,
    mipmaps: requestedMipmaps,
    texturePrewarm: requestedTexturePrewarm,
    atlasMode: requestedAtlasMode,
    content: requestedContentMode === 'template' ? benchmarkTemplate : undefined,
    draw: requestedContentMode === 'canvas' ? benchmarkCanvasDraw : undefined,
  }),
  quality: 'auto',
  qualityProfiles: requestedHighMaxVisibleItems === undefined
    ? undefined
    : {
        high: {
          ...qualityProfiles.high,
          maxVisibleItems: requestedHighMaxVisibleItems,
        },
      },
  adaptivePerformance: true,
  hoverEffect: 'highlight',
})
let itemCount = 500
let qualityMode: QualityMode = 'auto'
let layoutName = 'sphere'
let lastResult: BenchmarkResult | null = null
declare global {
  interface Window {
    __spatialMotionBenchmarkResult?: BenchmarkResult
    __spatialMotionBenchmarkConfigure?: (configuration: {
      itemCount?: number
      qualityMode?: QualityMode
    }) => Promise<void>
    __spatialMotionBenchmarkDiagnostics?: {
      firstRenderSubmitMs: number
      operations: number
    }
  }
}
let baselineResult: BenchmarkResult | null = null
let runTimer = 0
let sampleTimer = 0
let stressTimer = 0
let stressOperations = 0
let runGeneration = 0
let coldStartRenderSubmitMs = 0
type ExtensionMode = 'none' | 'native' | 'gsap' | 'both'
let extensionMode: ExtensionMode = 'none'
let extensionHandles: StageExtensionHandle[] = []
const stressSequence = [
  'sphere',
  'box',
  'tunnel-burst',
  'grid',
  'vortex',
  'cylinder',
  'shooter-wave',
  'ring',
  'burst',
  'helix',
  'tunnel-square',
  'cone',
]

await stage.setItems(createItems(itemCount))
stage.autoRotate({ y: 0.24 })
await stage.to(layouts[layoutName], { duration: 900 })
window.__spatialMotionBenchmarkConfigure = configureBenchmark

document.querySelectorAll<HTMLButtonElement>('[data-count]').forEach((button) => {
  button.addEventListener('click', async () => {
    await configureBenchmark({ itemCount: Number(button.dataset.count) })
    setActive('[data-count]', button)
  })
})

document.querySelectorAll<HTMLButtonElement>('[data-quality]').forEach((button) => {
  button.addEventListener('click', async () => {
    await configureBenchmark({
      qualityMode: (button.dataset.quality ?? 'auto') as QualityMode,
    })
    setActive('[data-quality]', button)
  })
})

document.querySelectorAll<HTMLButtonElement>('[data-benchmark-layout]').forEach((button) => {
  button.addEventListener('click', async () => {
    layoutName = button.dataset.benchmarkLayout ?? 'sphere'
    setActive('[data-benchmark-layout], [data-benchmark-effect]', button)
    await applyConfiguration()
  })
})

document.querySelectorAll<HTMLButtonElement>('[data-benchmark-effect]').forEach((button) => {
  button.addEventListener('click', async () => {
    layoutName = button.dataset.benchmarkEffect ?? 'tunnel'
    setActive('[data-benchmark-layout], [data-benchmark-effect]', button)
    await applyConfiguration()
  })
})

document.querySelectorAll<HTMLButtonElement>('[data-benchmark-extension]').forEach((button) => {
  button.addEventListener('click', async () => {
    extensionMode = (button.dataset.benchmarkExtension ?? 'none') as ExtensionMode
    setActive('[data-benchmark-extension]', button)
    await applyExtensions()
  })
})

document.querySelector('#run-benchmark')?.addEventListener('click', () => void runBenchmark())
document.querySelector('#run-stress')?.addEventListener('click', () => void runBenchmark('transition-stress'))
document.querySelector('#export-result')?.addEventListener('click', exportResult)
document.querySelector<HTMLInputElement>('#import-baseline')?.addEventListener('change', importBaseline)

const metricsTimer = window.setInterval(updateMetrics, 500)
updateMetrics()

async function configureBenchmark(configuration: {
  itemCount?: number
  qualityMode?: QualityMode
}): Promise<void> {
  if (configuration.itemCount !== undefined) {
    if (!Number.isSafeInteger(configuration.itemCount) || configuration.itemCount <= 0) {
      throw new TypeError('Benchmark itemCount must be a positive safe integer')
    }
    itemCount = configuration.itemCount
  }
  if (configuration.qualityMode !== undefined) {
    if (!['auto', 'high', 'medium', 'low'].includes(configuration.qualityMode)) {
      throw new TypeError('Benchmark qualityMode is unsupported')
    }
    qualityMode = configuration.qualityMode
  }
  await applyConfiguration()
}

function resolvePositiveInteger(value: string | null): number | undefined {
  if (value === null) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}

async function applyConfiguration(): Promise<void> {
  cancelRun('配置已更新，可以重新运行采样')
  stage.setQuality(qualityMode)
  const effect = effects[layoutName]
  if (effect || layoutName === 'grid' || layoutName === 'ring') {
    stage.stopRotation()
    stage.setRotation(0, 0)
  } else {
    stage.autoRotate({ y: 0.24 })
  }
  await stage.updateItems(createItems(itemCount), {
    layout: effect ? layouts.sphere : layouts[layoutName],
    duration: 650,
  })
  if (effect) await stage.enterEffect(effect, { duration: 650 })
  updateMetrics()
}

async function applyExtensions(): Promise<void> {
  cancelRun('扩展配置已更新，可以重新运行采样')
  extensionHandles.forEach((handle) => handle.remove())
  extensionHandles = []
  try {
    if (extensionMode === 'native' || extensionMode === 'both') {
      extensionHandles.push(await stage.addExtension(createNativeThreeExtension()))
    }
    if (extensionMode === 'gsap' || extensionMode === 'both') {
      extensionHandles.push(await stage.addExtension(createGsapExtension()))
    }
  } catch (error) {
    extensionHandles.forEach((handle) => handle.remove())
    extensionHandles = []
    extensionMode = 'none'
    setStatus(error instanceof Error ? error.message : '无法加载外部扩展')
  }
  updateMetrics()
}

type BenchmarkScenario =
  | 'steady'
  | 'cold-start'
  | 'atlas-update'
  | 'interaction-stress'
  | 'transition-stress'

async function runBenchmark(forcedScenario?: BenchmarkScenario): Promise<void> {
  cancelRun()
  const generation = runGeneration
  window.__spatialMotionBenchmarkDiagnostics = undefined
  const durationSeconds = Number((document.querySelector<HTMLSelectElement>('#duration'))?.value ?? 10)
  const scenario = forcedScenario
    ?? (document.querySelector<HTMLSelectElement>('#scenario')?.value ?? 'steady') as BenchmarkScenario
  const stressMode = scenario === 'transition-stress'
  const session = new BenchmarkSession({
    itemCount,
    qualityMode,
    layout: extensionMode === 'none' ? layoutName : `${layoutName}+${extensionMode}`,
    scenario,
    environment: stage.getPerformanceEnvironment(),
  })
  stressOperations = 0
  coldStartRenderSubmitMs = 0
  setRunButtonsDisabled(true)
  setStatus(`正在运行 ${durationSeconds} 秒${scenarioLabel(scenario)}…`)
  sampleTimer = window.setInterval(() => session.record(
    stage.getPerformanceStats(),
    performance.now(),
    benchmarkExtensionStats(),
  ), 500)
  if (stressMode) {
    void runStressOperation()
    stressTimer = window.setInterval(() => void runStressOperation(), 900)
  } else if (scenario === 'atlas-update') {
    void runAtlasUpdateOperation()
    stressTimer = window.setInterval(() => void runAtlasUpdateOperation(), 180)
  } else if (scenario === 'interaction-stress') {
    runInteractionOperation()
    stressTimer = window.setInterval(runInteractionOperation, 4)
  } else if (scenario === 'cold-start') {
    void runColdStart(generation)
  }
  session.record(stage.getPerformanceStats(), performance.now(), benchmarkExtensionStats())
  runTimer = window.setTimeout(() => {
    window.clearInterval(sampleTimer)
    window.clearInterval(stressTimer)
    sampleTimer = 0
    stressTimer = 0
    runTimer = 0
    session.record(stage.getPerformanceStats(), performance.now(), benchmarkExtensionStats())
    lastResult = session.finish()
    window.__spatialMotionBenchmarkResult = lastResult
    window.__spatialMotionBenchmarkDiagnostics = {
      firstRenderSubmitMs: coldStartRenderSubmitMs,
      operations: stressOperations,
    }
    renderResult(lastResult)
    setRunButtonsDisabled(false)
    const exportButton = document.querySelector<HTMLButtonElement>('#export-result')
    if (exportButton) exportButton.disabled = false
    setStatus(`采样完成：平均 ${lastResult.averageFps.toFixed(1)} FPS，P95 ${lastResult.maximumFrameTimeP95.toFixed(2)} ms${stressOperations ? `，完成 ${stressOperations} 次操作` : ''}`)
  }, durationSeconds * 1000)
}

async function runColdStart(generation: number): Promise<void> {
  await stage.updateItems([], { duration: 0 })
  if (generation !== runGeneration) return
  const effect = effects[layoutName]
  await stage.updateItems(createItems(itemCount), {
    layout: effect ? layouts.sphere : layouts[layoutName],
    duration: 0,
  })
  if (generation !== runGeneration) return
  await captureColdStartRenderSubmit(generation)
  if (generation !== runGeneration || !effect) return
  await stage.enterEffect(effect, { duration: 0 })
}

async function captureColdStartRenderSubmit(generation: number): Promise<void> {
  for (let frame = 0; frame < 2; frame += 1) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    if (generation !== runGeneration) return
    coldStartRenderSubmitMs = Math.max(
      coldStartRenderSubmitMs,
      stage.getPerformanceStats().renderSubmitMs,
    )
  }
}

async function runAtlasUpdateOperation(): Promise<void> {
  const operation = stressOperations
  stressOperations += 1
  const itemId = `benchmark-${operation % Math.max(1, itemCount) + 1}`
  await stage.updateItem(itemId, { title: operationTitle(operation) })
}

async function runStressOperation(): Promise<void> {
  const target = stressSequence[stressOperations % stressSequence.length]
  const operation = stressOperations
  stressOperations += 1
  const itemId = `benchmark-${operation % Math.max(1, itemCount) + 1}`
  await stage.updateItem(itemId, { title: operationTitle(operation) })
  const effect = effects[target]
  if (effect) await stage.enterEffect(effect, { duration: 700 })
  else await stage.to(layouts[target], { duration: 700 })
}

function runInteractionOperation(): void {
  const canvas = container!.querySelector('canvas')
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  const phase = stressOperations++ * 0.17
  canvas.dispatchEvent(new PointerEvent('pointermove', {
    clientX: rect.left + (Math.sin(phase) * 0.45 + 0.5) * rect.width,
    clientY: rect.top + (Math.cos(phase * 0.73) * 0.45 + 0.5) * rect.height,
  }))
}

function cancelRun(message?: string): void {
  runGeneration += 1
  if (runTimer) window.clearTimeout(runTimer)
  if (sampleTimer) window.clearInterval(sampleTimer)
  if (stressTimer) window.clearInterval(stressTimer)
  runTimer = 0
  sampleTimer = 0
  stressTimer = 0
  setRunButtonsDisabled(false)
  if (message) setStatus(message)
}

function updateMetrics(): void {
  const stats = stage.getPerformanceStats()
  setText('#metric-fps', stats.fps ? stats.fps.toFixed(1) : 'WARMUP')
  setText('#metric-frame', stats.averageFrameMs ? `${stats.averageFrameMs.toFixed(2)} ms` : '-- ms')
  setText('#metric-percentiles', stats.frameTimeP95
    ? `${stats.frameTimeP95.toFixed(1)} / ${stats.frameTimeP99.toFixed(1)} ms`
    : '--')
  setText('#metric-cpu', `${stats.frameCpuMs.toFixed(2)} / ${stats.renderSubmitMs.toFixed(2)} ms`)
  setText('#metric-extensions', `${stats.extensions} / ${stats.extensionUpdateMs.toFixed(3)} ms`)
  const extensionStats = stage.getExtensionStats().filter(({ active }) => active)
  setText('#metric-extension-detail', extensionStats.length
    ? extensionStats.map(({ name, enabled, updateTimeP95 }) =>
      `${name}:${enabled ? 'ON' : 'OFF'} ${updateTimeP95.toFixed(2)}`).join(' · ')
    : '--')
  setText('#metric-items', `${stats.renderer.instanceCount} / ${stats.inputItems}`)
  setText('#metric-submitted', String(stats.renderer.submittedInstanceCount))
  setText('#metric-visible', String(stats.visibleItems))
  setText('#metric-effect', stats.effect ? `${stats.effect} / ${stats.activeEffectItems}` : 'layout / 0')
  setText('#metric-calls', String(stats.render.drawCalls))
  setText('#metric-triangles', stats.render.triangles.toLocaleString())
  setText('#metric-texture', formatBytes(stats.renderer.metrics.textureBytes ?? 0))
  setText(
    '#metric-atlas-updates',
    `${stats.renderer.metrics.atlasBuilds ?? 0} / ${stats.renderer.metrics.atlasPatches ?? 0}`,
  )
  setText('#metric-quality', `${stats.quality.toUpperCase()} / ${stats.qualityMode.toUpperCase()}`)
  setText('#metric-context', stats.contextLost ? 'LOST' : 'READY')
}

function benchmarkExtensionStats() {
  return stage.getExtensionStats().filter(({ active, errorCount }) => active || errorCount > 0)
}

function renderResult(result: BenchmarkResult): void {
  const summary = {
    contentMode: requestedContentMode,
    configuration: result.configuration,
    durationMs: Math.round(result.durationMs),
    sampleCount: result.sampleCount,
    averageFps: Number(result.averageFps.toFixed(2)),
    minimumFps: Number(result.minimumFps.toFixed(2)),
    averageFrameMs: Number(result.averageFrameMs.toFixed(2)),
    maximumFrameMs: Number(result.maximumFrameMs.toFixed(2)),
    averageFrameTimeP50: Number(result.averageFrameTimeP50.toFixed(2)),
    maximumFrameTimeP95: Number(result.maximumFrameTimeP95.toFixed(2)),
    maximumFrameTimeP99: Number(result.maximumFrameTimeP99.toFixed(2)),
    longFrames: {
      over24Ms: result.longFramesOver24Ms,
      over33Ms: result.longFramesOver33Ms,
      over50Ms: result.longFramesOver50Ms,
    },
    averageFrameCpuMs: Number(result.averageFrameCpuMs.toFixed(3)),
    maximumFrameCpuMs: Number(result.maximumFrameCpuMs.toFixed(3)),
    averageRenderSubmitMs: Number(result.averageRenderSubmitMs.toFixed(3)),
    maximumRenderSubmitMs: Number(result.maximumRenderSubmitMs.toFixed(3)),
    pickingMs: Number(result.pickingMs.toFixed(2)),
    pickOperations: result.pickOperations,
    averageExtensionUpdateMs: Number(result.averageExtensionUpdateMs.toFixed(3)),
    maximumExtensionUpdateMs: Number(result.maximumExtensionUpdateMs.toFixed(3)),
    maximumExtensions: result.maximumExtensions,
    extensionStats: result.extensionStats.map((stats) => ({
      ...stats,
      averageUpdateMs: Number(stats.averageUpdateMs.toFixed(3)),
      updateTimeP95: Number(stats.updateTimeP95.toFixed(3)),
      updateTimeP99: Number(stats.updateTimeP99.toFixed(3)),
      maximumUpdateMs: Number(stats.maximumUpdateMs.toFixed(3)),
    })),
    maximumDrawCalls: result.maximumDrawCalls,
    maximumTriangles: result.maximumTriangles,
    maximumTextureBytes: result.maximumTextureBytes,
    renderedItems: result.renderedItems,
    submittedItems: result.submittedItems,
    visibleItems: result.visibleItems,
    contextLost: result.samples.some(({ stats }) => stats.contextLost),
    atlas: {
      builds: result.atlasBuilds,
      patches: result.atlasPatches,
      cellsUpdated: result.atlasCellsUpdated,
      buildMs: Number(result.atlasBuildMs.toFixed(2)),
      patchMs: Number(result.atlasPatchMs.toFixed(2)),
      prepareMs: Number(result.atlasPrepareMs.toFixed(2)),
      imageLoadWallMs: Number(result.atlasImageLoadWallMs.toFixed(2)),
      cellRenderMs: Number(result.atlasCellRenderMs.toFixed(2)),
      readbackMs: Number(result.atlasReadbackMs.toFixed(2)),
      arrayPackMs: Number((result.atlasArrayPackMs ?? 0).toFixed(2)),
      workerRenderMs: Number((result.atlasWorkerRenderMs ?? 0).toFixed(2)),
      workerRoundTripMs: Number((result.atlasWorkerRoundTripMs ?? 0).toFixed(2)),
      workerRuntimeLoadMs: Number((result.atlasWorkerRuntimeLoadMs ?? 0).toFixed(2)),
      workerConstructMs: Number((result.atlasWorkerConstructMs ?? 0).toFixed(2)),
      workerRequestPrepareMs: Number((result.atlasWorkerRequestPrepareMs ?? 0).toFixed(2)),
      workerPrePostMs: Number((result.atlasWorkerPrePostMs ?? 0).toFixed(2)),
      lastBuildMs: Number((result.atlasLastBuildMs ?? 0).toFixed(2)),
      lastPrepareMs: Number((result.atlasLastPrepareMs ?? 0).toFixed(2)),
      lastImageLoadWallMs: Number((result.atlasLastImageLoadWallMs ?? 0).toFixed(2)),
      lastCellRenderMs: Number((result.atlasLastCellRenderMs ?? 0).toFixed(2)),
      lastReadbackMs: Number((result.atlasLastReadbackMs ?? 0).toFixed(2)),
      lastArrayPackMs: Number((result.atlasLastArrayPackMs ?? 0).toFixed(2)),
      lastWorkerRenderMs: Number((result.atlasLastWorkerRenderMs ?? 0).toFixed(2)),
      lastWorkerRoundTripMs: Number((result.atlasLastWorkerRoundTripMs ?? 0).toFixed(2)),
      lastWorkerRuntimeLoadMs: Number((result.atlasLastWorkerRuntimeLoadMs ?? 0).toFixed(2)),
      lastWorkerConstructMs: Number((result.atlasLastWorkerConstructMs ?? 0).toFixed(2)),
      lastWorkerRequestPrepareMs:
        Number((result.atlasLastWorkerRequestPrepareMs ?? 0).toFixed(2)),
      lastWorkerPrePostMs: Number((result.atlasLastWorkerPrePostMs ?? 0).toFixed(2)),
      workerRenders: result.atlasWorkerRenders,
      imageBitmapDecodeMs: Number(result.atlasImageBitmapDecodeMs.toFixed(2)),
      texturePrewarms: result.atlasTexturePrewarms,
      texturePrewarmMs: Number(result.atlasTexturePrewarmMs.toFixed(2)),
      texturePrewarmFailures: result.atlasTexturePrewarmFailures,
      texturePrewarmSkips: result.atlasTexturePrewarmSkips,
      imageLoadMs: Number(result.imageLoadMs.toFixed(2)),
      imageRequests: result.imageRequests,
      imageFailures: result.imageFailures,
      estimatedUploadBytes: result.estimatedTextureUploadBytes,
      cpuResidentBytes: result.samples.at(-1)?.stats.renderer.metrics.atlasCpuBytes ?? 0,
      gpuResidentBytes: result.samples.at(-1)?.stats.renderer.metrics.atlasGpuBytes ?? 0,
      buildPixelBufferPeakBytes:
        result.samples.at(-1)?.stats.renderer.metrics.atlasBuildPixelBufferPeakBytes ?? 0,
      maxBuildPixelBufferBytes:
        result.samples.at(-1)?.stats.renderer.metrics.maxAtlasBuildPixelBufferBytes ?? 0,
      mainThreadRasterYields:
        result.samples.at(-1)?.stats.renderer.metrics.mainThreadRasterYields ?? 0,
      mainThreadRasterYieldMs:
        Number((result.samples.at(-1)?.stats.renderer.metrics.mainThreadRasterYieldMs ?? 0).toFixed(2)),
      totalMainThreadRasterYields:
        result.samples.at(-1)?.stats.renderer.metrics.totalMainThreadRasterYields ?? 0,
      totalMainThreadRasterYieldMs:
        Number((result.samples.at(-1)?.stats.renderer.metrics.totalMainThreadRasterYieldMs ?? 0).toFixed(2)),
      resolution: result.samples.at(-1)?.stats.renderer.metrics.atlasResolution ?? 0,
      mipmaps: Boolean(result.samples.at(-1)?.stats.renderer.metrics.atlasMipmaps),
      requestedResolution,
      requestedTexturePrewarm: requestedTexturePrewarm ?? 'auto',
      requestedAtlasMode,
      actualAtlasMode: result.samples.at(-1)?.stats.renderer.metrics.atlasMode ? 'array' : 'single',
      atlasLayers: result.samples.at(-1)?.stats.renderer.metrics.atlasLayers ?? 1,
      uploadedAtlasLayers: result.samples.at(-1)?.stats.renderer.metrics.uploadedLayers ?? 0,
      pendingAtlasLayers: result.samples.at(-1)?.stats.renderer.metrics.pendingLayers ?? 0,
      atlasLayerUploadFrames: result.samples.at(-1)?.stats.renderer.metrics.layerUploadFrames ?? 0,
      totalAtlasLayerUploadFrames:
        result.samples.at(-1)?.stats.renderer.metrics.totalLayerUploadFrames ?? 0,
      arrayUploadBudgetBytes:
        result.samples.at(-1)?.stats.renderer.metrics.arrayUploadBudgetBytes ?? 0,
      arrayUploadPeakBudgetBytes:
        result.samples.at(-1)?.stats.renderer.metrics.arrayUploadPeakBudgetBytes ?? 0,
      arrayUploadBackoffs:
        result.samples.at(-1)?.stats.renderer.metrics.arrayUploadBackoffs ?? 0,
      firstRenderSubmitMs: Number(coldStartRenderSubmitMs.toFixed(3)),
    },
    operations: stressOperations,
  }
  setText('#benchmark-result', JSON.stringify(summary, null, 2))
  renderComparison()
}

function resolveBenchmarkResolution(value: string | null): number | 'auto' {
  if (!value || value === 'auto') return 'auto'
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : 'auto'
}

function resolveTexturePrewarm(value: string | null): boolean | undefined {
  if (value === '1') return true
  if (value === '0') return false
  return undefined
}

async function importBaseline(event: Event): Promise<void> {
  const input = event.currentTarget as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    const parsed = parseBenchmarkResult(await file.text())
    baselineResult = parsed
    setStatus(`已导入基线：${parsed.configuration.itemCount} items / ${parsed.configuration.qualityMode} / ${parsed.configuration.scenario ?? parsed.configuration.layout}`)
    renderComparison()
  } catch {
    baselineResult = null
    setText('#benchmark-comparison', '无法读取该基准 JSON；请使用当前版本导出的完整结果。')
  } finally {
    input.value = ''
  }
}

function renderComparison(): void {
  if (!baselineResult || !lastResult) return
  const comparison = compareBenchmarkResults(baselineResult, lastResult)
  const metrics = Object.fromEntries(Object.entries(comparison.metrics).map(([name, metric]) => [name, {
    baseline: Number(metric.baseline.toFixed(3)),
    current: Number(metric.current.toFixed(3)),
    delta: Number(metric.delta.toFixed(3)),
    deltaPercent: metric.deltaPercent === null ? null : Number(metric.deltaPercent.toFixed(2)),
    lowerIsBetter: metric.lowerIsBetter,
  }]))
  setText('#benchmark-comparison', JSON.stringify({ compatible: comparison.compatible, metrics }, null, 2))
}

function setRunButtonsDisabled(disabled: boolean): void {
  const runButton = document.querySelector<HTMLButtonElement>('#run-benchmark')
  const stressButton = document.querySelector<HTMLButtonElement>('#run-stress')
  if (runButton) runButton.disabled = disabled
  if (stressButton) stressButton.disabled = disabled
}

function exportResult(): void {
  if (!lastResult) return
  const blob = new Blob([JSON.stringify(lastResult, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `spatial-motion-${itemCount}-${qualityMode}-${layoutName}-${extensionMode}.json`
  link.click()
  URL.revokeObjectURL(url)
}

function setActive(selector: string, active: HTMLButtonElement): void {
  document.querySelectorAll(selector).forEach((element) => element.classList.toggle('active', element === active))
}

function setStatus(value: string): void {
  setText('#benchmark-status', value)
}

function setText(selector: string, value: string): void {
  const element = document.querySelector(selector)
  if (element) element.textContent = value
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 MB'
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function scenarioLabel(scenario: BenchmarkScenario): string {
  switch (scenario) {
    case 'steady': return '稳定运行采样'
    case 'cold-start': return '冷启动与完整图集采样'
    case 'atlas-update': return '连续局部更新采样'
    case 'interaction-stress': return '高频指针交互采样'
    case 'transition-stress': return '切换/更新压力测试'
  }
}

function operationTitle(operation: number): string {
  return `${runGeneration.toString(36)}-${operation.toString(36)}`
}

function createAvatar(index: number): string {
  const hue = (index * 47) % 360
  const label = String(index + 1).padStart(2, '0')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="hsl(${hue} 80% 66%)"/><stop offset="1" stop-color="hsl(${(hue + 55) % 360} 65% 34%)"/></linearGradient></defs>
    <circle cx="48" cy="48" r="44" fill="url(#g)" stroke="#f5d77a" stroke-width="4"/>
    <circle cx="48" cy="39" r="14" fill="rgba(255,255,255,.88)"/>
    <path d="M22 79c3-17 13-25 26-25s23 8 26 25" fill="rgba(255,255,255,.88)"/>
    <text x="48" y="89" text-anchor="middle" font-family="sans-serif" font-size="10" font-weight="700" fill="#fff">${label}</text>
  </svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

window.addEventListener('beforeunload', () => {
  cancelRun()
  window.clearInterval(metricsTimer)
  stage.destroy()
})
