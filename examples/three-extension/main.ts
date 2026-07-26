import {
  MotionStage,
  cardsRenderer,
  sphere,
  type QualityLevel,
  type StageExtension,
  type StageExtensionHandle,
} from '@itagan/spatial-motion'
import { Mesh, MeshBasicMaterial, TorusGeometry, type Group } from 'three'
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
stage.autoRotate({ y: 0.2 })

function orbitExtension(): StageExtension {
  let root: Group | null = null
  const geometry = new TorusGeometry(6.2, 0.045, 8, 160)
  const material = new MeshBasicMaterial({ color: 0x67e8f9 })
  let quality: QualityLevel = 'high'
  let reducedMotion = false
  const updateAppearance = () => {
    const opacity = quality === 'high' ? 1 : quality === 'medium' ? 0.75 : 0.5
    material.opacity = opacity * (reducedMotion ? 0.55 : 1)
    material.transparent = material.opacity < 1
  }

  return {
    name: 'native-orbit',
    order: -10,
    mount(context) {
      root = context.root
      const orbit = new Mesh(geometry, material)
      orbit.rotation.x = Math.PI / 2
      root.add(orbit)
    },
    update({ elapsed }) {
      if (root) root.rotation.z = reducedMotion ? 0 : elapsed * 0.24
    },
    qualityChange(value) {
      quality = value
      updateAppearance()
    },
    reducedMotionChange(value) {
      reducedMotion = value
      updateAppearance()
    },
    dispose() {
      geometry.dispose()
      material.dispose()
      root = null
    },
  }
}

let handle: StageExtensionHandle | null = null

async function addOrbit() {
  if (handle?.active) return
  handle = await stage.addExtension(orbitExtension())
}

document.querySelector('#add')?.addEventListener('click', () => { void addOrbit() })
document.querySelector('#disable')?.addEventListener('click', () => handle?.disable())
document.querySelector('#enable')?.addEventListener('click', () => handle?.enable())
document.querySelector('#remove')?.addEventListener('click', () => {
  handle?.remove()
  handle = null
})

await addOrbit()

const statusTimer = window.setInterval(() => {
  const stats = stage.getPerformanceStats()
  const diagnostic = stage.getExtensionStats().find(({ active }) => active)
  status.textContent = `${diagnostic?.enabled ? 'ON' : 'OFF'} · P95 ${(diagnostic?.updateTimeP95 ?? 0).toFixed(2)} MS · ${stats.render.drawCalls} CALLS`
}, 500)

window.addEventListener('pagehide', () => {
  window.clearInterval(statusTimer)
  stage.destroy()
}, { once: true })
