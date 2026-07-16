import {
  MotionStage,
  sphere,
  type StageExtension,
  type StageExtensionHandle,
} from '@itagan/spatial-motion'
import { gsap } from 'gsap'
import { Mesh, MeshBasicMaterial, TorusKnotGeometry, type Group } from 'three'
import '../shared.css'

const container = document.querySelector<HTMLElement>('#stage')!
const status = document.querySelector<HTMLElement>('#status')!
const stage = new MotionStage({ container, quality: 'auto', adaptivePerformance: true })

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
  const timeline = gsap.timeline({ paused: true, repeat: -1 })
    .to(motion, { angle: Math.PI * 2, pulse: 1, duration: 3, ease: 'sine.inOut' })
    .to(motion, { angle: Math.PI * 4, pulse: 0, duration: 3, ease: 'sine.inOut' })

  return {
    name: 'gsap-orbiter',
    mount(context) {
      root = context.root
      root.add(mesh)
    },
    update({ elapsed }) {
      if (!root) return
      timeline.totalTime(elapsed, false)
      mesh.position.set(Math.cos(motion.angle) * 6.8, Math.sin(motion.angle) * 3.7, 0.8)
      mesh.rotation.set(elapsed * 0.7, elapsed * 1.1, elapsed * 0.35)
      mesh.scale.setScalar(0.85 + motion.pulse * 0.35)
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
document.querySelector('#remove')?.addEventListener('click', () => {
  handle?.remove()
  handle = null
})

const statusTimer = window.setInterval(() => {
  const stats = stage.getPerformanceStats()
  status.textContent = `${stats.extensions} EXT · ${stats.extensionUpdateMs.toFixed(2)} MS · ${stats.fps.toFixed(0)} FPS`
}, 500)

window.addEventListener('pagehide', () => {
  window.clearInterval(statusTimer)
  stage.destroy()
}, { once: true })
