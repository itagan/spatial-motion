import {
  MotionStage,
  sphere,
  type StageExtension,
  type StageExtensionHandle,
} from '@itagan/spatial-motion'
import { Mesh, MeshBasicMaterial, TorusGeometry, type Group } from 'three'
import '../shared.css'

const container = document.querySelector<HTMLElement>('#stage')!
const status = document.querySelector<HTMLElement>('#status')!
const stage = new MotionStage({ container, quality: 'auto', adaptivePerformance: true })

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

  return {
    name: 'native-orbit',
    mount(context) {
      root = context.root
      const orbit = new Mesh(geometry, material)
      orbit.rotation.x = Math.PI / 2
      root.add(orbit)
    },
    update({ elapsed }) {
      if (root) root.rotation.z = elapsed * 0.24
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
document.querySelector('#remove')?.addEventListener('click', () => {
  handle?.remove()
  handle = null
})

await addOrbit()

const statusTimer = window.setInterval(() => {
  const stats = stage.getPerformanceStats()
  status.textContent = `${stats.extensions} EXT · ${stats.extensionUpdateMs.toFixed(2)} MS · ${stats.drawCalls} CALLS`
}, 500)

window.addEventListener('pagehide', () => {
  window.clearInterval(statusTimer)
  stage.destroy()
}, { once: true })
