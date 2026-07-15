import {
  MotionStage,
  createLayout,
  linearShooter,
  radialBurst,
  scatter,
  tunnel,
  vortex,
  type LayoutConfig,
  type LayoutConfigType,
  type MotionItem,
  type Timeline,
} from '@spatial-motion'
import { createLayoutLab } from './layoutLab'
import './style.css'

const avatarPool = Array.from({ length: 24 }, (_, index) => createAvatar(index))
const createItems = (count: number): MotionItem[] => Array.from({ length: count }, (_, index) => ({
    id: `guest-${index + 1}`,
    title: String(index + 1).padStart(3, '0'),
    image: avatarPool[index % avatarPool.length],
  }))
let items = createItems(600)

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

const container = document.querySelector<HTMLElement>('#stage')
if (!container) throw new Error('Stage container not found')
const pickDebug = document.querySelector<HTMLElement>('#pick-debug')
const updateSelection = (count: number) => {
  document.querySelector('#selection')!.textContent = `${count} SELECTED`
}

const stage = new MotionStage({
  container,
  quality: 'auto',
  adaptivePerformance: true,
  onQualityChange(quality, stats) {
    document.querySelector('#quality')!.textContent = `${quality.toUpperCase()} QUALITY`
    console.info(`Spatial Motion quality changed to ${quality} at ${stats.fps.toFixed(1)} FPS`)
  },
  onItemClick(item) {
    activeTimeline?.cancel()
    stage.stopRotation()
    stage.setRotation(0, 0)
    updateSelection(1)
    void stage.focusItems([item.id])
  },
  onItemHover(item) {
    if (!pickDebug) return
    pickDebug.hidden = !item
    if (item) pickDebug.textContent = `${item.title ?? item.id} · depth pick`
  },
  hoverEffect: 'highlight',
  motionPreference: 'auto',
  cardStyle: {
    shape: 'circle',
    borderWidth: 2,
    borderColor: 'rgba(245, 215, 122, .9)',
    backgroundColor: '#111827',
  },
})
await stage.setItems(items)
let activeTimeline: Timeline | null = null

const applyLayoutConfig = async (config: LayoutConfig, duration: number) => {
  activeTimeline?.cancel()
  updateSelection(0)
  if (config.type === 'grid' || config.type === 'ring' || config.type === 'scatter') {
    stage.stopRotation()
    stage.setRotation(0, 0)
  } else {
    stage.autoRotate({ y: 0.24 })
  }
  return stage.to(createLayout(config), { duration })
}

const labRoot = document.querySelector<HTMLElement>('#layout-lab')
if (!labRoot) throw new Error('Layout lab not found')
const layoutLab = createLayoutLab({ root: labRoot, onApply: applyLayoutConfig })
await applyLayoutConfig(layoutLab.getConfig(layoutLab.currentType), 1600)

const tunnelEffect = tunnel({
  directionCount: 20,
  speed: 0.18,
  outerRadius: 4.2,
  maxActiveItems: 260,
})
const shooterEffect = linearShooter({
  directionCount: 18,
  speed: 0.26,
  outerRadius: 10,
  maxActiveItems: 180,
})
const vortexEffect = vortex({
  direction: 'in',
  speed: 0.14,
  turns: 2.6,
  outerRadius: 5.6,
  maxActiveItems: 240,
})
const burstEffect = radialBurst({
  direction: 'out',
  speed: 0.23,
  outerRadius: 9.5,
  depthScale: 0.3,
  maxActiveItems: 190,
})
const scatterLayouts = {
  random: scatter({ direction: 'random', distance: 11, depth: 7, opacity: 0, layers: 5, seed: 31 }),
  radial: scatter({ direction: 'radial', distance: 12, depth: 8, opacity: 0, spinMode: 'directional', layers: 6, seed: 32 }),
  right: scatter({ direction: 'right', distance: 12, depth: 6, opacity: 0, spinMode: 'directional', layers: 5, seed: 33 }),
}

const playRecipe = (steps: (timeline: Timeline) => Timeline) => {
  activeTimeline?.cancel()
  stage.stopRotation()
  stage.setRotation(0, 0)
  activeTimeline = steps(stage.timeline())
  void activeTimeline.play()
}

document.querySelectorAll<HTMLButtonElement>('[data-layout]').forEach((button) => {
  button.addEventListener('click', () => {
    layoutLab.select((button.dataset.layout ?? 'sphere') as LayoutConfigType)
  })
})

document.querySelector('#tunnel')?.addEventListener('click', () => {
  activeTimeline?.cancel()
  updateSelection(0)
  stage.stopRotation()
  stage.setRotation(0, 0)
  void stage.enterEffect(tunnelEffect, { duration: 1300 })
})

document.querySelector('#shooter')?.addEventListener('click', () => {
  activeTimeline?.cancel()
  updateSelection(0)
  stage.stopRotation()
  stage.setRotation(0, 0)
  void stage.enterEffect(shooterEffect, { duration: 1200 })
})

document.querySelector('#vortex')?.addEventListener('click', () => {
  activeTimeline?.cancel()
  updateSelection(0)
  stage.stopRotation()
  stage.setRotation(0, 0)
  void stage.enterEffect(vortexEffect, { duration: 1300 })
})

document.querySelector('#burst')?.addEventListener('click', () => {
  activeTimeline?.cancel()
  updateSelection(0)
  stage.stopRotation()
  stage.setRotation(0, 0)
  void stage.enterEffect(burstEffect, { duration: 1100 })
})

document.querySelector('#focus')?.addEventListener('click', () => {
  activeTimeline?.cancel()
  updateSelection(5)
  stage.stopRotation()
  stage.setRotation(0, 0)
  void stage.focusItems(items.slice(0, 5).map((item) => item.id))
})

document.querySelector('#restore')?.addEventListener('click', () => {
  activeTimeline?.cancel()
  updateSelection(0)
  void stage.restoreLayout({ duration: 1000 }).then((restored) => {
    if (restored) stage.autoRotate({ y: 0.24 })
  })
})

document.querySelector('#add-items')?.addEventListener('click', async () => {
  activeTimeline?.cancel()
  updateSelection(0)
  items = createItems(Math.min(2000, items.length + 100))
  await stage.updateItems(items)
  updateItemCount()
})

document.querySelector('#remove-items')?.addEventListener('click', async () => {
  activeTimeline?.cancel()
  updateSelection(0)
  items = createItems(Math.max(100, items.length - 100))
  await stage.updateItems(items)
  updateItemCount()
})

document.querySelector('#sequence')?.addEventListener('click', () => {
  activeTimeline?.cancel()
  updateSelection(0)
  activeTimeline = stage
    .timeline()
    .add(() => stage.autoRotate({ y: 0.24 }))
    .add(() => stage.to(layoutLab.getLayout('sphere'), { duration: 1200 }))
    .wait(900)
    .add(() => stage.to(layoutLab.getLayout('box'), { duration: 1300 }))
    .wait(900)
    .add(() => stage.enterEffect(vortexEffect, { duration: 1300 }))
    .wait(2600)
    .add(() => stage.to(layoutLab.getLayout('ring'), { duration: 1200 }))
    .wait(700)
    .add(() => stage.enterEffect(burstEffect, { duration: 1100 }))
    .wait(2200)
    .add(() => stage.to(layoutLab.getLayout('cylinder'), { duration: 1300 }))
    .wait(800)
    .add(() => {
      stage.stopRotation()
      stage.setRotation(0, 0)
    })
    .add(() => stage.enterEffect(tunnelEffect, { duration: 1400 }))
    .wait(3200)
    .add(() => stage.enterEffect(shooterEffect, { duration: 1200 }))
    .wait(2600)
    .add(() => stage.to(layoutLab.getLayout('cylinder'), { duration: 1300 }))
    .wait(900)
    .add(() => {
      stage.stopRotation()
      stage.setRotation(0, 0)
    })
    .add(() => stage.to(layoutLab.getLayout('grid'), { duration: 1200 }))
    .wait(900)
    .add(() => stage.autoRotate({ y: 0.24 }))
    .add(() => stage.to(layoutLab.getLayout('sphere'), { duration: 1400 }))
  void activeTimeline.play()
})

document.querySelector('#recipe-sphere')?.addEventListener('click', () => playRecipe((timeline) => timeline
  .add(() => stage.to(scatterLayouts.random, { duration: 700 }))
  .add(() => stage.to(layoutLab.getLayout('sphere'), { duration: 1300 }))
  .add(() => stage.autoRotate({ y: 0.24 }))))

document.querySelector('#recipe-box')?.addEventListener('click', () => playRecipe((timeline) => timeline
  .add(() => stage.to(layoutLab.getLayout('box'), { duration: 1000 }))
  .wait(500)
  .add(() => stage.to(scatterLayouts.radial, { duration: 900 }))
  .add(() => stage.to(layoutLab.getLayout('box'), { duration: 1300 }))))

document.querySelector('#recipe-cylinder')?.addEventListener('click', () => playRecipe((timeline) => timeline
  .add(() => stage.to(layoutLab.getLayout('cylinder'), { duration: 1000 }))
  .wait(500)
  .add(() => stage.to(scatterLayouts.right, { duration: 900 }))
  .add(() => stage.to(layoutLab.getLayout('cylinder'), { duration: 1200 }))))

document.querySelector('#recipe-grid')?.addEventListener('click', () => playRecipe((timeline) => timeline
  .add(() => stage.to(layoutLab.getLayout('grid'), { duration: 900 }))
  .wait(500)
  .add(() => stage.to(scatterLayouts.random, { duration: 900 }))
  .add(() => stage.to(layoutLab.getLayout('grid'), { duration: 1200 }))))

document.querySelector('#quality')!.textContent = `${stage.getQuality().toUpperCase()} QUALITY`
const updateItemCount = () => {
  document.querySelector('#count')!.textContent = `${items.length} ITEMS`
}
updateItemCount()

container.addEventListener('pointermove', (event) => {
  if (!pickDebug || pickDebug.hidden) return
  const rect = container.getBoundingClientRect()
  pickDebug.style.left = `${event.clientX - rect.left + 12}px`
  pickDebug.style.top = `${event.clientY - rect.top + 12}px`
})

let frames = 0
let measuredAt = performance.now()
const updateFps = (now: number) => {
  frames += 1
  if (now - measuredAt >= 1000) {
    document.querySelector('#fps')!.textContent = `${Math.round((frames * 1000) / (now - measuredAt))} FPS`
    const stats = stage.getPerformanceStats()
    document.querySelector('#render-stats')!.textContent = `${stats.drawCalls} CALL · ${stats.atlasBuilds} ATLAS`
    document.querySelector('#effect')!.textContent = stats.effect
      ? `${stats.effect.toUpperCase()} · ${stats.activeEffectItems} ACTIVE`
      : 'LAYOUT MODE'
    frames = 0
    measuredAt = now
  }
  requestAnimationFrame(updateFps)
}
requestAnimationFrame(updateFps)

window.addEventListener('beforeunload', () => stage.destroy())
