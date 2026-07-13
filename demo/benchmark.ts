import {
  BenchmarkSession,
  MotionStage,
  cone,
  cylinder,
  grid,
  helix,
  ring,
  sphere,
  type BenchmarkResult,
  type Layout,
  type MotionItem,
  type QualityMode,
} from '@spatial-motion'
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
  cylinder: cylinder({ radius: 5 }),
  grid: grid({ columns: 30, gap: 0.42 }),
  ring: ring({ innerRadius: 0.8, spacing: 0.42 }),
  helix: helix({ radius: 4.6, height: 9 }),
  cone: cone({ radius: 5, height: 9, stagger: true }),
}

const container = document.querySelector<HTMLElement>('#benchmark-stage')
if (!container) throw new Error('Benchmark stage container not found')

const stage = new MotionStage({ container, quality: 'auto', adaptivePerformance: true })
let itemCount = 600
let qualityMode: QualityMode = 'auto'
let layoutName = 'sphere'
let lastResult: BenchmarkResult | null = null
let runTimer = 0
let sampleTimer = 0

await stage.setItems(createItems(itemCount))
stage.autoRotate({ y: 0.24 })
await stage.to(layouts[layoutName], { duration: 900 })

document.querySelectorAll<HTMLButtonElement>('[data-count]').forEach((button) => {
  button.addEventListener('click', async () => {
    itemCount = Number(button.dataset.count)
    setActive('[data-count]', button)
    await applyConfiguration()
  })
})

document.querySelectorAll<HTMLButtonElement>('[data-quality]').forEach((button) => {
  button.addEventListener('click', async () => {
    qualityMode = (button.dataset.quality ?? 'auto') as QualityMode
    setActive('[data-quality]', button)
    await applyConfiguration()
  })
})

document.querySelectorAll<HTMLButtonElement>('[data-benchmark-layout]').forEach((button) => {
  button.addEventListener('click', async () => {
    layoutName = button.dataset.benchmarkLayout ?? 'sphere'
    setActive('[data-benchmark-layout]', button)
    await applyConfiguration()
  })
})

document.querySelector('#run-benchmark')?.addEventListener('click', runBenchmark)
document.querySelector('#export-result')?.addEventListener('click', exportResult)

const metricsTimer = window.setInterval(updateMetrics, 500)
updateMetrics()

async function applyConfiguration(): Promise<void> {
  cancelRun('配置已更新，可以重新运行采样')
  stage.setQuality(qualityMode)
  if (layoutName === 'grid' || layoutName === 'ring') {
    stage.stopRotation()
    stage.setRotation(0, 0)
  } else {
    stage.autoRotate({ y: 0.24 })
  }
  await stage.updateItems(createItems(itemCount), {
    layout: layouts[layoutName],
    duration: 650,
  })
  updateMetrics()
}

function runBenchmark(): void {
  cancelRun()
  const durationSeconds = Number((document.querySelector<HTMLSelectElement>('#duration'))?.value ?? 10)
  const session = new BenchmarkSession({ itemCount, qualityMode, layout: layoutName })
  const runButton = document.querySelector<HTMLButtonElement>('#run-benchmark')
  if (runButton) runButton.disabled = true
  setStatus(`正在采样 ${durationSeconds} 秒…`)
  sampleTimer = window.setInterval(() => session.record(stage.getPerformanceStats()), 500)
  session.record(stage.getPerformanceStats())
  runTimer = window.setTimeout(() => {
    window.clearInterval(sampleTimer)
    sampleTimer = 0
    runTimer = 0
    session.record(stage.getPerformanceStats())
    lastResult = session.finish()
    renderResult(lastResult)
    if (runButton) runButton.disabled = false
    const exportButton = document.querySelector<HTMLButtonElement>('#export-result')
    if (exportButton) exportButton.disabled = false
    setStatus(`采样完成：平均 ${lastResult.averageFps.toFixed(1)} FPS，最低 ${lastResult.minimumFps.toFixed(1)} FPS`)
  }, durationSeconds * 1000)
}

function cancelRun(message?: string): void {
  if (runTimer) window.clearTimeout(runTimer)
  if (sampleTimer) window.clearInterval(sampleTimer)
  runTimer = 0
  sampleTimer = 0
  const runButton = document.querySelector<HTMLButtonElement>('#run-benchmark')
  if (runButton) runButton.disabled = false
  if (message) setStatus(message)
}

function updateMetrics(): void {
  const stats = stage.getPerformanceStats()
  setText('#metric-fps', stats.fps ? stats.fps.toFixed(1) : 'WARMUP')
  setText('#metric-frame', stats.averageFrameMs ? `${stats.averageFrameMs.toFixed(2)} ms` : '-- ms')
  setText('#metric-items', `${stats.renderedItems} / ${stats.inputItems}`)
  setText('#metric-visible', String(stats.visibleItems))
  setText('#metric-calls', String(stats.drawCalls))
  setText('#metric-triangles', stats.triangles.toLocaleString())
  setText('#metric-texture', formatBytes(stats.textureBytes))
  setText('#metric-quality', `${stats.quality.toUpperCase()} / ${stats.qualityMode.toUpperCase()}`)
}

function renderResult(result: BenchmarkResult): void {
  const summary = {
    configuration: result.configuration,
    durationMs: Math.round(result.durationMs),
    sampleCount: result.sampleCount,
    averageFps: Number(result.averageFps.toFixed(2)),
    minimumFps: Number(result.minimumFps.toFixed(2)),
    averageFrameMs: Number(result.averageFrameMs.toFixed(2)),
    maximumFrameMs: Number(result.maximumFrameMs.toFixed(2)),
    maximumDrawCalls: result.maximumDrawCalls,
    maximumTriangles: result.maximumTriangles,
    maximumTextureBytes: result.maximumTextureBytes,
    renderedItems: result.renderedItems,
    visibleItems: result.visibleItems,
  }
  setText('#benchmark-result', JSON.stringify(summary, null, 2))
}

function exportResult(): void {
  if (!lastResult) return
  const blob = new Blob([JSON.stringify(lastResult, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `spatial-motion-${itemCount}-${qualityMode}-${layoutName}.json`
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
