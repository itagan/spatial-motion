import {
  MotionStage,
  cardsRenderer,
  cylinder,
  pointsRenderer,
  sphere,
  type MotionStageOptions,
} from '@itagan/spatial-motion'
import { defineCardTemplate, html } from '@itagan/spatial-motion/card-template'
import '../shared.css'
import { recipeSources } from './recipeSources'

const container = document.querySelector<HTMLElement>('#stage')!
const status = document.querySelector<HTMLElement>('#status')!
const recipeSource = document.querySelector<HTMLElement>('#recipe-source')!
const copyRecipe = document.querySelector<HTMLButtonElement>('#copy-recipe')!
let lastPicked = ''
const search = new URLSearchParams(location.search)
const requestedCount = Number(search.get('count'))
const patchDemo = search.get('patch') === '1'
const itemCount = [500, 1000, 2000].includes(requestedCount) ? requestedCount : 120
const rendererMode = search.get('renderer') === 'points' ? 'points' : 'cards'

type ContentMode = 'default' | 'product' | 'profile' | 'metric' | 'canvas'
type AspectMode = 'square' | 'portrait' | 'landscape'
interface DemoMeta {
  featured: boolean
  price: number
  role: string
  score: number
}

const legacyModes: Record<string, { content: ContentMode; aspect: AspectMode }> = {
  avatar: { content: 'default', aspect: 'square' },
  profile: { content: 'default', aspect: 'portrait' },
  landscape: { content: 'default', aspect: 'landscape' },
  'template-product': { content: 'product', aspect: 'square' },
  'template-profile': { content: 'profile', aspect: 'portrait' },
  'template-metric': { content: 'metric', aspect: 'landscape' },
  'canvas-metric': { content: 'canvas', aspect: 'landscape' },
}
const legacyMode = legacyModes[search.get('card') ?? '']
const requestedContent = search.get('content')
const requestedAspect = search.get('aspect')
const contentMode: ContentMode = requestedContent === 'default'
  || requestedContent === 'product'
  || requestedContent === 'profile'
  || requestedContent === 'metric'
  || requestedContent === 'canvas'
  ? requestedContent
  : legacyMode?.content ?? 'default'
const aspectMode: AspectMode = requestedAspect === 'square'
  || requestedAspect === 'portrait'
  || requestedAspect === 'landscape'
  ? requestedAspect
  : legacyMode?.aspect ?? 'square'

const aspectAppearance = {
  square: {
    ratio: 1,
    defaultStyle: {
      shape: 'circle' as const,
      borderWidth: 2,
      borderColor: '#67e8f9',
      imageFit: 'cover' as const,
    },
  },
  portrait: {
    ratio: 0.75,
    defaultStyle: {
      shape: 'rounded' as const,
      cornerRadius: 10,
      borderWidth: 2,
      borderColor: '#93c5fd',
      imageFit: 'cover' as const,
      imagePosition: { y: 0.25 },
      overlayColor: 'rgba(3, 10, 24, .22)',
      titleStyle: {
        position: 'bottom' as const,
        fontSizeRatio: 0.12,
        maxLines: 1 as const,
        backgroundColor: 'rgba(3, 10, 24, .72)',
      },
    },
  },
  landscape: {
    ratio: 16 / 9,
    defaultStyle: {
      shape: 'rounded' as const,
      cornerRadius: 8,
      borderWidth: 2,
      borderColor: '#c4b5fd',
      imageFit: 'cover' as const,
      imagePosition: { x: 0.7 },
      overlayColor: 'rgba(8, 5, 25, .18)',
      titleStyle: {
        position: 'bottom' as const,
        align: 'left' as const,
        fontSizeRatio: 0.16,
        maxLines: 1 as const,
        backgroundColor: 'rgba(8, 5, 25, .72)',
      },
    },
  },
}[aspectMode]
const contentStyles = {
  product: {
    shape: 'rounded' as const,
    cornerRadius: 10,
    borderWidth: 2,
    borderColor: '#fb7185',
    backgroundColor: '#1f1024',
  },
  profile: {
    shape: 'rounded' as const,
    cornerRadius: 10,
    borderWidth: 2,
    borderColor: '#67e8f9',
    backgroundColor: '#071827',
  },
  metric: {
    shape: 'rounded' as const,
    cornerRadius: 8,
    borderWidth: 2,
    borderColor: '#a78bfa',
    backgroundColor: '#130d2d',
  },
  canvas: {
    shape: 'rounded' as const,
    cornerRadius: 8,
    borderWidth: 2,
    borderColor: '#fbbf24',
    backgroundColor: '#130d2d',
  },
}
const cardStyle = contentMode === 'default'
  ? aspectAppearance.defaultStyle
  : contentStyles[contentMode]
recipeSource.textContent = recipeSources[rendererMode === 'points' ? 'points' : contentMode]
copyRecipe.addEventListener('click', async () => {
  const label = copyRecipe.textContent
  try {
    await navigator.clipboard.writeText(recipeSources[rendererMode === 'points' ? 'points' : contentMode])
    copyRecipe.textContent = '已复制'
  } catch {
    copyRecipe.textContent = '复制失败'
  }
  window.setTimeout(() => {
    copyRecipe.textContent = label
  }, 1200)
})

const items = Array.from({ length: itemCount }, (_, index) => ({
  id: `guest-${index}`,
  title: `Guest ${index + 1}`,
  image: avatarData(index),
  meta: {
    featured: index % 11 === 0,
    price: 99 + index % 80,
    role: ['Designer', 'Engineer', 'Producer'][index % 3],
    score: 72 + index % 29,
  },
}))

const productTemplate = defineCardTemplate<DemoMeta>((item, { formatNumber, when }) => html`
  <div class="product">
    ${when(item.image, () => html`
      <img src=${item.image} style="height:62%;object-fit:cover;object-position:50% 28%" />
    `)}
    <div class="copy">
      <span class="title">${item.title}</span>
      <span class="accent">¥${formatNumber(item.meta?.price ?? 0)}</span>
    </div>
  </div>
`, {
  styles: {
    product: {
      display: 'flex',
      flexDirection: 'column',
      padding: 5,
      gap: 4,
      background: 'linear-gradient(135deg, #3b1029, #be123c)',
      overflow: 'hidden',
    },
    copy: { display: 'flex', flexDirection: 'column', gap: 2, flex: 1 },
    title: { fontSize: 10, fontWeight: 700, lineClamp: 1, textAlign: 'center' },
    accent: { color: '#ffe4e6', fontSize: 9, fontWeight: 700, textAlign: 'center' },
  },
})

const profileTemplate = defineCardTemplate<DemoMeta>((item) => html`
  <div class="profile">
    <img src=${item.image} style="height:68%;object-fit:cover;object-position:50% 20%" />
    <div class="copy">
      <span class="name">${item.title}</span>
      <span class="role">${item.meta?.role}</span>
    </div>
  </div>
`, {
  styles: {
    profile: {
      display: 'flex',
      flexDirection: 'column',
      padding: 5,
      gap: 3,
      background: 'linear-gradient(145deg, #083344, #155e75)',
      overflow: 'hidden',
    },
    copy: { display: 'flex', flexDirection: 'column', gap: 1, flex: 1 },
    name: { fontSize: 10, fontWeight: 700, lineClamp: 1, textAlign: 'center' },
    role: { color: '#a5f3fc', fontSize: 8, lineClamp: 1, textAlign: 'center' },
  },
})

const metricTemplate = defineCardTemplate<DemoMeta>((item) => html`
  <div class="metric">
    <span class="label">${item.title}</span>
    <span class="score">${item.meta?.score}</span>
    <span class="unit">ENGAGEMENT</span>
  </div>
`, {
  styles: {
    metric: {
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      gap: 2,
      padding: 5,
      background: 'linear-gradient(120deg, #1e1b4b, #6d28d9)',
    },
    label: { color: '#ddd6fe', fontSize: 8, lineClamp: 1, textAlign: 'center' },
    score: { color: '#ffffff', fontSize: 18, fontWeight: 800, lineClamp: 1, textAlign: 'center' },
    unit: { color: '#c4b5fd', fontSize: 6, fontWeight: 700, lineClamp: 1, textAlign: 'center' },
  },
})

const cardContent = contentMode === 'product'
  ? productTemplate
  : contentMode === 'profile'
    ? profileTemplate
    : contentMode === 'metric'
      ? metricTemplate
      : undefined

const baseStageOptions: Omit<MotionStageOptions<DemoMeta>, 'renderer'> = {
  container,
  quality: 'high',
  adaptivePerformance: false,
  onItemClick(item) {
    lastPicked = ` · PICK ${item.title ?? item.id}`
  },
  transition: { duration: 900 },
}
const cardRenderer = cardsRenderer<DemoMeta>({
  aspectRatio: aspectAppearance.ratio,
  style: cardStyle,
  content: cardContent,
  draw: contentMode === 'canvas'
    ? (context, item, bounds) => {
        const gradient = context.createLinearGradient(bounds.x, bounds.y, bounds.x + bounds.width, bounds.y)
        gradient.addColorStop(0, '#1e1b4b')
        gradient.addColorStop(1, '#6d28d9')
        context.fillStyle = gradient
        context.fillRect(bounds.x, bounds.y, bounds.width, bounds.height)
        context.fillStyle = '#ddd6fe'
        context.font = '700 8px sans-serif'
        context.textAlign = 'center'
        context.fillText(item.title ?? item.id, bounds.x + bounds.width / 2, bounds.y + 12)
        context.fillStyle = '#ffffff'
        context.font = '800 18px sans-serif'
        context.fillText(
          String((item.meta as { score?: number }).score ?? 0),
          bounds.x + bounds.width / 2,
          bounds.y + bounds.height / 2 + 6,
        )
        context.fillStyle = '#c4b5fd'
        context.font = '700 6px sans-serif'
        context.fillText('ENGAGEMENT', bounds.x + bounds.width / 2, bounds.y + bounds.height - 7)
      }
    : undefined,
  resolveStyle(item) {
    return (item.meta as { featured?: boolean }).featured
      ? { borderColor: '#facc15', borderWidth: 4 }
      : undefined
  },
})
const stage = new MotionStage({
  ...baseStageOptions,
  renderer: rendererMode === 'points'
    ? pointsRenderer<DemoMeta>({
      size: 0.72,
      resolveColor(item, index) {
        if (item.meta?.featured) return '#facc15'
        return `hsl(${index * 47 % 360} 72% 58%)`
      },
    })
    : cardRenderer,
})

await stage.setItems(items)
document.documentElement.dataset.atlasBuildMs =
  String(stage.getPerformanceStats().renderer.metrics.atlasBuildMs ?? 0)
await stage.to(sphere({ fit: 'contain', poleMode: 'exclude', edgeFade: 0.06 }), { duration: 0 })
stage.autoRotate({ y: 0.22 })
if (patchDemo) {
  window.setTimeout(() => {
    void stage.updateItem('guest-0', {
      title: 'Updated Guest',
      meta: { featured: true, price: 188, role: 'Director', score: 100 },
    })
  }, 500)
}

document.querySelector('[data-layout="sphere"]')?.addEventListener('click', () => {
  void stage.to(sphere({ fit: 'contain', poleMode: 'exclude', edgeFade: 0.06 }))
})
document.querySelector('[data-layout="cylinder"]')?.addEventListener('click', () => {
  void stage.to(cylinder({ radius: 4.8, rows: 12 }))
})
document.querySelector('#pause')?.addEventListener('click', () => stage.pause())
document.querySelector('#resume')?.addEventListener('click', () => stage.resume())
document.querySelectorAll<HTMLButtonElement>('[data-renderer]').forEach((button) => {
  button.addEventListener('click', () => {
    const next = new URLSearchParams(location.search)
    next.set('renderer', button.dataset.renderer ?? 'cards')
    location.search = next.toString()
  })
  button.setAttribute('aria-pressed', String(button.dataset.renderer === rendererMode))
})
document.querySelectorAll<HTMLButtonElement>('[data-content]').forEach((button) => {
  button.addEventListener('click', () => {
    const next = new URLSearchParams(location.search)
    next.delete('card')
    next.set('content', button.dataset.content ?? 'default')
    if (!next.has('aspect')) next.set('aspect', aspectMode)
    location.search = next.toString()
  })
  button.setAttribute('aria-pressed', String(button.dataset.content === contentMode))
  button.disabled = rendererMode === 'points'
})
document.querySelectorAll<HTMLButtonElement>('[data-aspect]').forEach((button) => {
  button.addEventListener('click', () => {
    const next = new URLSearchParams(location.search)
    next.delete('card')
    if (!next.has('content')) next.set('content', contentMode)
    next.set('aspect', button.dataset.aspect ?? 'square')
    location.search = next.toString()
  })
  button.setAttribute('aria-pressed', String(button.dataset.aspect === aspectMode))
  button.disabled = rendererMode === 'points'
})

const statusTimer = window.setInterval(() => {
  const stats = stage.getPerformanceStats()
  document.documentElement.dataset.atlasBuildMs = String(stats.renderer.metrics.atlasBuildMs ?? 0)
  document.documentElement.dataset.atlasPatchMs = String(stats.renderer.metrics.atlasPatchMs ?? 0)
  document.documentElement.dataset.atlasPatches = String(stats.renderer.metrics.atlasPatches ?? 0)
  document.documentElement.dataset.atlasCellsUpdated =
    String(stats.renderer.metrics.atlasCellsUpdated ?? 0)
  document.documentElement.dataset.rendererCapacity =
    String(stats.renderer.metrics.capacity ?? stats.renderer.instanceCount)
  document.documentElement.dataset.geometryBuilds =
    String(stats.renderer.metrics.geometryBuilds ?? 0)
  document.documentElement.dataset.attributeReuses =
    String(stats.renderer.metrics.attributeReuses ?? 0)
  document.documentElement.dataset.atlasUploadRanges =
    String(stats.renderer.metrics.atlasUploadRanges ?? 0)
  status.textContent =
    `${stats.fps.toFixed(0)} FPS · ${stats.render.drawCalls} CALL · ${stats.renderer.instanceCount} ITEMS${lastPicked}`
}, 500)

window.addEventListener('pagehide', () => {
  window.clearInterval(statusTimer)
  stage.destroy()
}, { once: true })

function avatarData(index: number): string {
  index %= 24
  const hue = index * 47 % 360
  const label = String(index + 1).padStart(2, '0')
  return `data:image/svg+xml,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">
      <defs><linearGradient id="g" x2="1" y2="1">
        <stop stop-color="hsl(${hue} 68% 58%)"/>
        <stop offset="1" stop-color="hsl(${(hue + 55) % 360} 65% 28%)"/>
      </linearGradient></defs>
      <rect width="256" height="256" fill="url(#g)"/>
      <circle cx="128" cy="92" r="44" fill="rgba(255,255,255,.86)"/>
      <path d="M48 226c8-52 39-78 80-78s72 26 80 78" fill="rgba(255,255,255,.86)"/>
      <text x="128" y="246" text-anchor="middle" fill="white" font-size="20">${label}</text>
    </svg>
  `)}`
}
