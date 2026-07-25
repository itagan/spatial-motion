import { MotionStage, cylinder, sphere } from '@itagan/spatial-motion'
import { defineCardTemplate, html } from '@itagan/spatial-motion/card-template'
import '../shared.css'

const container = document.querySelector<HTMLElement>('#stage')!
const status = document.querySelector<HTMLElement>('#status')!
let lastPicked = ''
const requestedCard = new URLSearchParams(location.search).get('card')
const requestedCount = Number(new URLSearchParams(location.search).get('count'))
const patchDemo = new URLSearchParams(location.search).get('patch') === '1'
const itemCount = [500, 1000, 2000].includes(requestedCount) ? requestedCount : 120
const cardMode = requestedCard === 'profile'
  || requestedCard === 'landscape'
  || requestedCard === 'template-product'
  || requestedCard === 'template-profile'
  || requestedCard === 'template-metric'
  || requestedCard === 'canvas-metric'
  ? requestedCard
  : 'avatar'
const cardAppearance = {
  avatar: {
    aspectRatio: 1,
    style: {
      shape: 'circle' as const,
      borderWidth: 2,
      borderColor: '#67e8f9',
      imageFit: 'cover' as const,
    },
  },
  profile: {
    aspectRatio: 0.75,
    style: {
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
    aspectRatio: 16 / 9,
    style: {
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
  'template-product': {
    aspectRatio: 1,
    style: {
      shape: 'rounded' as const,
      cornerRadius: 10,
      borderWidth: 2,
      borderColor: '#fb7185',
      backgroundColor: '#1f1024',
    },
  },
  'template-profile': {
    aspectRatio: 0.75,
    style: {
      shape: 'rounded' as const,
      cornerRadius: 10,
      borderWidth: 2,
      borderColor: '#67e8f9',
      backgroundColor: '#071827',
    },
  },
  'template-metric': {
    aspectRatio: 16 / 9,
    style: {
      shape: 'rounded' as const,
      cornerRadius: 8,
      borderWidth: 2,
      borderColor: '#a78bfa',
      backgroundColor: '#130d2d',
    },
  },
  'canvas-metric': {
    aspectRatio: 16 / 9,
    style: {
      shape: 'rounded' as const,
      cornerRadius: 8,
      borderWidth: 2,
      borderColor: '#a78bfa',
      backgroundColor: '#130d2d',
    },
  },
}[cardMode]
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

const productTemplate = defineCardTemplate<{
  price: number
}>((item, { formatNumber }) => html`
  <div class="product">
    <img src=${item.image} style="height:62%;object-fit:cover;object-position:50% 28%" />
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

const profileTemplate = defineCardTemplate<{
  role: string
}>((item) => html`
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

const metricTemplate = defineCardTemplate<{
  score: number
}>((item) => html`
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

const cardContent = cardMode === 'template-product'
  ? productTemplate
  : cardMode === 'template-profile'
    ? profileTemplate
    : cardMode === 'template-metric'
      ? metricTemplate
      : undefined

const stage = new MotionStage({
  container,
  quality: 'high',
  adaptivePerformance: false,
  cardAspectRatio: cardAppearance.aspectRatio,
  cardStyle: cardAppearance.style,
  cardContent,
  drawCard: cardMode === 'canvas-metric'
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
  resolveCardStyle(item) {
    return (item.meta as { featured?: boolean }).featured
      ? { borderColor: '#facc15', borderWidth: 4 }
      : undefined
  },
  onItemClick(item) {
    lastPicked = ` · PICK ${item.title ?? item.id}`
  },
  transition: { duration: 900 },
})

await stage.setItems(items)
document.documentElement.dataset.atlasBuildMs = String(stage.getPerformanceStats().atlasBuildMs)
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
document.querySelectorAll<HTMLButtonElement>('[data-card]').forEach((button) => {
  button.addEventListener('click', () => {
    const next = new URLSearchParams(location.search)
    next.set('card', button.dataset.card ?? 'avatar')
    location.search = next.toString()
  })
})

const statusTimer = window.setInterval(() => {
  const stats = stage.getPerformanceStats()
  document.documentElement.dataset.atlasBuildMs = String(stats.atlasBuildMs)
  document.documentElement.dataset.atlasPatchMs = String(stats.atlasPatchMs)
  document.documentElement.dataset.atlasPatches = String(stats.atlasPatches)
  document.documentElement.dataset.atlasCellsUpdated = String(stats.atlasCellsUpdated)
  status.textContent = `${stats.fps.toFixed(0)} FPS · ${stats.drawCalls} CALL · ${stats.renderedItems} ITEMS${lastPicked}`
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
