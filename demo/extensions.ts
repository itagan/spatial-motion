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
import type { QualityLevel, StageExtension } from '@spatial-motion'

export function createNativeThreeExtension(): StageExtension {
  let root: Group | null = null
  let orbitMaterial: MeshBasicMaterial | null = null
  let pointsMaterial: PointsMaterial | null = null
  let quality: QualityLevel = 'high'
  let reducedMotion = false
  const geometries: BufferGeometry[] = []
  const materials: Material[] = []

  const updateAppearance = () => {
    const qualityFactor = quality === 'high' ? 1 : quality === 'medium' ? 0.78 : 0.58
    if (orbitMaterial) orbitMaterial.opacity = (reducedMotion ? 0.42 : 0.72) * qualityFactor
    if (pointsMaterial) {
      pointsMaterial.opacity = reducedMotion ? 0.35 : 0.9 * qualityFactor
      pointsMaterial.size = 0.055 * qualityFactor
    }
  }

  return {
    name: 'native-three-orbit',
    order: -10,
    mount(context) {
      root = context.root

      const orbitGeometry = new TorusGeometry(6.25, 0.035, 8, 160)
      orbitMaterial = new MeshBasicMaterial({ color: 0x65d6ff, transparent: true, opacity: 0.72 })
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
      pointsMaterial = new PointsMaterial({ color: 0xf5d77a, size: 0.055, transparent: true, opacity: 0.9 })

      geometries.push(orbitGeometry, pointsGeometry)
      materials.push(orbitMaterial, pointsMaterial)
      root.add(orbit, new Points(pointsGeometry, pointsMaterial))
      updateAppearance()
    },
    update({ elapsed }) {
      if (!root) return
      root.rotation.z = reducedMotion ? 0 : elapsed * 0.16
      root.rotation.y = reducedMotion ? 0 : Math.sin(elapsed * 0.35) * 0.16
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
      geometries.forEach((geometry) => geometry.dispose())
      materials.forEach((material) => material.dispose())
      geometries.length = 0
      materials.length = 0
      orbitMaterial = null
      pointsMaterial = null
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
  let quality: QualityLevel = 'high'
  let reducedMotion = false
  const motion = { angle: 0, pulse: 0 }

  return {
    name: 'gsap-orbiter',
    order: 10,
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
      timeline.totalTime(reducedMotion ? 0 : elapsed, false)
      const qualityFactor = quality === 'high' ? 1 : quality === 'medium' ? 0.82 : 0.65
      mesh.position.set(Math.cos(motion.angle) * 7, Math.sin(motion.angle) * 3.8, Math.sin(motion.angle * 0.5) * 1.4)
      mesh.rotation.set(
        reducedMotion ? 0 : elapsed * 0.7,
        reducedMotion ? 0 : elapsed * 1.1,
        reducedMotion ? 0 : elapsed * 0.35,
      )
      mesh.scale.setScalar((0.85 + motion.pulse * 0.35) * qualityFactor)
    },
    qualityChange(value) {
      quality = value
    },
    reducedMotionChange(value) {
      reducedMotion = value
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
