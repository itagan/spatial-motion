import { MotionStage, cylinder, sphere } from '@itagan/spatial-motion'
import '../shared.css'

const container = document.querySelector<HTMLElement>('#stage')!
const status = document.querySelector<HTMLElement>('#status')!
let lastPicked = ''
const requestedCard = new URLSearchParams(location.search).get('card')
const requestedCount = Number(new URLSearchParams(location.search).get('count'))
const itemCount = [500, 1000, 2000].includes(requestedCount) ? requestedCount : 120
const cardMode = requestedCard === 'profile' || requestedCard === 'landscape'
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
}[cardMode]
const items = Array.from({ length: itemCount }, (_, index) => ({
  id: `guest-${index}`,
  title: `Guest ${index + 1}`,
  image: avatarData(index),
  meta: { featured: index % 11 === 0 },
}))

const stage = new MotionStage({
  container,
  quality: 'high',
  adaptivePerformance: false,
  cardAspectRatio: cardAppearance.aspectRatio,
  cardStyle: cardAppearance.style,
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
await stage.to(sphere({ fit: 'contain', poleMode: 'exclude', edgeFade: 0.06 }), { duration: 0 })
stage.autoRotate({ y: 0.22 })

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
    location.search = `?card=${button.dataset.card}`
  })
})

const statusTimer = window.setInterval(() => {
  const stats = stage.getPerformanceStats()
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
