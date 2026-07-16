import { MotionStage, cylinder, sphere } from '@itagan/spatial-motion'
import '../shared.css'

const container = document.querySelector<HTMLElement>('#stage')!
const status = document.querySelector<HTMLElement>('#status')!
const items = Array.from({ length: 120 }, (_, index) => ({
  id: `guest-${index}`,
  title: `Guest ${index + 1}`,
}))

const stage = new MotionStage({
  container,
  quality: 'auto',
  adaptivePerformance: true,
  transition: { duration: 900 },
})

await stage.setItems(items)
await stage.to(sphere({ radius: 4.8 }), { duration: 0 })
stage.autoRotate({ y: 0.22 })

document.querySelector('[data-layout="sphere"]')?.addEventListener('click', () => {
  void stage.to(sphere({ radius: 4.8 }))
})
document.querySelector('[data-layout="cylinder"]')?.addEventListener('click', () => {
  void stage.to(cylinder({ radius: 4.8, rows: 12 }))
})
document.querySelector('#pause')?.addEventListener('click', () => stage.pause())
document.querySelector('#resume')?.addEventListener('click', () => stage.resume())

const statusTimer = window.setInterval(() => {
  const stats = stage.getPerformanceStats()
  status.textContent = `${stats.fps.toFixed(0)} FPS · ${stats.drawCalls} CALL · ${stats.renderedItems} ITEMS`
}, 500)

window.addEventListener('pagehide', () => {
  window.clearInterval(statusTimer)
  stage.destroy()
}, { once: true })
