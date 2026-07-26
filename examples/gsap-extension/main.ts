import {
  MotionStage,
  cardsRenderer,
  sphere,
  type StageExtension,
  type StageExtensionHandle,
} from '@itagan/spatial-motion'
import { gsap } from 'gsap'
import { Mesh, MeshBasicMaterial, TorusKnotGeometry, type Group } from 'three'
import '../shared.css'

const container = document.querySelector<HTMLElement>('#stage')!
const status = document.querySelector<HTMLElement>('#status')!
const stage = new MotionStage({
  container,
  renderer: cardsRenderer(),
  quality: 'auto',
  adaptivePerformance: true,
})

await stage.setItems(Array.from({ length: 180 }, (_, index) => ({
  id: `card-${index}`,
  title: `Card ${index + 1}`,
})))
await stage.to(sphere({ radius: 4.9 }), { duration: 0 })

function gsapExtension(): StageExtension {
  let root: Group | null = null
  const geometry = new TorusKnotGeometry(0.62, 0.18, 96, 12)
  const material = new MeshBasicMaterial({ color: 0xff6ec7, wireframe: true })
  const mesh = new Mesh(geometry, material)
  const motion = { angle: 0, pulse: 0 }
  let qualityScale = 1
  let reducedMotion = false
  const timeline = gsap.timeline({ paused: true, repeat: -1 })
    .to(motion, { angle: Math.PI * 2, pulse: 1, duration: 3, ease: 'sine.inOut' })
    .to(motion, { angle: Math.PI * 4, pulse: 0, duration: 3, ease: 'sine.inOut' })

  return {
    name: 'gsap-orbiter',
    order: 10,
    mount(context) {
      root = context.root
      root.add(mesh)
    },
    update({ elapsed }) {
      if (!root) return
      timeline.totalTime(reducedMotion ? 0 : elapsed, false)
      mesh.position.set(Math.cos(motion.angle) * 6.8, Math.sin(motion.angle) * 3.7, 0.8)
      mesh.rotation.set(0, reducedMotion ? 0 : elapsed * 1.1, 0)
      mesh.scale.setScalar((0.85 + motion.pulse * 0.35) * qualityScale)
    },
    qualityChange(quality) {
      qualityScale = quality === 'high' ? 1 : quality === 'medium' ? 0.82 : 0.65
    },
    reducedMotionChange(value) {
      reducedMotion = value
    },
    dispose() {
      timeline.kill()
      geometry.dispose()
      material.dispose()
      root = null
    },
  }
}

let handle: StageExtensionHandle | null = await stage.addExtension(gsapExtension())

document.querySelector('#pause')?.addEventListener('click', () => stage.pause())
document.querySelector('#resume')?.addEventListener('click', () => stage.resume())
document.querySelector('#disable')?.addEventListener('click', () => handle?.disable())
document.querySelector('#enable')?.addEventListener('click', () => handle?.enable())
document.querySelector('#remove')?.addEventListener('click', () => {
  handle?.remove()
  handle = null
})

const statusTimer = window.setInterval(() => {
  const stats = stage.getPerformanceStats()
  const diagnostic = stage.getExtensionStats().find(({ active }) => active)
  status.textContent = `${diagnostic?.enabled ? 'ON' : 'OFF'} · P95 ${(diagnostic?.updateTimeP95 ?? 0).toFixed(2)} MS · ${stats.fps.toFixed(0)} FPS`
}, 500)

window.addEventListener('pagehide', () => {
  window.clearInterval(statusTimer)
  stage.destroy()
}, { once: true })
