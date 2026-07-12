import { MotionStage, cylinder, grid, sphere, type Layout, type MotionItem } from '@spatial-motion'
import './style.css'

const itemCount = 600
const avatarPool = Array.from({ length: 24 }, (_, index) => createAvatar(index))
const items: MotionItem[] = Array.from({ length: itemCount }, (_, index) => ({
  id: `guest-${index + 1}`,
  title: String(index + 1).padStart(3, '0'),
  image: avatarPool[index % avatarPool.length],
}))

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

const stage = new MotionStage({ container, quality: 'auto' })
await stage.setItems(items)
stage.autoRotate({ y: 0.24 })
await stage.to(sphere({ radius: 5.2 }), { duration: 1600 })

const layouts: Record<string, Layout> = {
  sphere: sphere({ radius: 5.2 }),
  cylinder: cylinder({ radius: 5 }),
  grid: grid({ columns: 30, gap: 0.42 }),
}

document.querySelectorAll<HTMLButtonElement>('[data-layout]').forEach((button) => {
  button.addEventListener('click', () => {
    const layout = layouts[button.dataset.layout ?? 'sphere']
    if (layout) void stage.to(layout, { duration: 1300 })
  })
})

document.querySelector('#sequence')?.addEventListener('click', () => {
  const timeline = stage
    .timeline()
    .add(() => stage.to(layouts.sphere, { duration: 1200 }))
    .wait(900)
    .add(() => stage.to(layouts.cylinder, { duration: 1300 }))
    .wait(900)
    .add(() => stage.to(layouts.grid, { duration: 1200 }))
    .wait(900)
    .add(() => stage.to(layouts.sphere, { duration: 1400 }))
  void timeline.play()
})

document.querySelector('#quality')!.textContent = `${stage.getQuality().toUpperCase()} QUALITY`
document.querySelector('#count')!.textContent = `${itemCount} ITEMS`

let frames = 0
let measuredAt = performance.now()
const updateFps = (now: number) => {
  frames += 1
  if (now - measuredAt >= 1000) {
    document.querySelector('#fps')!.textContent = `${Math.round((frames * 1000) / (now - measuredAt))} FPS`
    frames = 0
    measuredAt = now
  }
  requestAnimationFrame(updateFps)
}
requestAnimationFrame(updateFps)

window.addEventListener('beforeunload', () => stage.destroy())
