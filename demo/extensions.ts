import { gsap } from 'gsap'
import {
  BufferGeometry,
  Float32BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  TorusGeometry,
  TorusKnotGeometry,
  type Group,
  type Material,
} from 'three'
import type { StageExtension } from '@spatial-motion'

export function createNativeThreeExtension(): StageExtension {
  let root: Group | null = null
  const geometries: BufferGeometry[] = []
  const materials: Material[] = []

  return {
    name: 'native-three-orbit',
    mount(context) {
      root = context.root

      const orbitGeometry = new TorusGeometry(6.25, 0.035, 8, 160)
      const orbitMaterial = new MeshBasicMaterial({ color: 0x65d6ff, transparent: true, opacity: 0.72 })
      const orbit = new Mesh(orbitGeometry, orbitMaterial)
      orbit.rotation.x = Math.PI / 2

      const pointsGeometry = new BufferGeometry()
      const positions: number[] = []
      for (let index = 0; index < 180; index += 1) {
        const angle = index / 180 * Math.PI * 2
        const radius = 6.6 + Math.sin(index * 1.7) * 0.18
        positions.push(Math.cos(angle) * radius, Math.sin(angle) * radius, Math.sin(index * 0.37) * 0.3)
      }
      pointsGeometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
      const pointsMaterial = new PointsMaterial({ color: 0xf5d77a, size: 0.055, transparent: true, opacity: 0.9 })

      geometries.push(orbitGeometry, pointsGeometry)
      materials.push(orbitMaterial, pointsMaterial)
      root.add(orbit, new Points(pointsGeometry, pointsMaterial))
    },
    update({ elapsed }) {
      if (!root) return
      root.rotation.z = elapsed * 0.16
      root.rotation.y = Math.sin(elapsed * 0.35) * 0.16
    },
    dispose() {
      geometries.forEach((geometry) => geometry.dispose())
      materials.forEach((material) => material.dispose())
      geometries.length = 0
      materials.length = 0
      root = null
    },
  }
}

export function createGsapExtension(): StageExtension {
  let root: Group | null = null
  let geometry: TorusKnotGeometry | null = null
  let material: MeshBasicMaterial | null = null
  let mesh: Mesh | null = null
  let timeline: gsap.core.Timeline | null = null
  const motion = { angle: 0, pulse: 0 }

  return {
    name: 'gsap-orbiter',
    mount(context) {
      root = context.root
      geometry = new TorusKnotGeometry(0.62, 0.18, 96, 12)
      material = new MeshBasicMaterial({ color: 0xff6ec7, wireframe: true })
      mesh = new Mesh(geometry, material)
      root.add(mesh)

      timeline = gsap.timeline({ paused: true, repeat: -1 })
        .to(motion, { angle: Math.PI * 2, pulse: 1, duration: 3, ease: 'sine.inOut' })
        .to(motion, { angle: Math.PI * 4, pulse: 0, duration: 3, ease: 'sine.inOut' })
    },
    update({ elapsed }) {
      if (!root || !mesh || !timeline) return
      timeline.totalTime(elapsed, false)
      mesh.position.set(Math.cos(motion.angle) * 7, Math.sin(motion.angle) * 3.8, Math.sin(motion.angle * 0.5) * 1.4)
      mesh.rotation.set(elapsed * 0.7, elapsed * 1.1, elapsed * 0.35)
      mesh.scale.setScalar(0.85 + motion.pulse * 0.35)
    },
    dispose() {
      timeline?.kill()
      geometry?.dispose()
      material?.dispose()
      timeline = null
      geometry = null
      material = null
      mesh = null
      root = null
    },
  }
}
