import {
  Euler,
  FrontSide,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  PlaneGeometry,
  Quaternion,
  Scene,
  ShaderMaterial,
} from 'three'
import type { MotionItem, Transform } from '../core/types'
import type { TunnelGpuData } from '../effects/TunnelEffect'
import type { LinearShooterGpuData } from '../effects/LinearShooterEffect'
import { createTextureAtlas } from './textureAtlas'

export class InstancedCardRenderer {
  private mesh: Mesh<InstancedBufferGeometry, ShaderMaterial> | null = null
  private material: ShaderMaterial | null = null
  private readonly euler = new Euler()
  private readonly quaternion = new Quaternion()

  constructor(private readonly scene: Scene) {}

  async setItems(items: MotionItem[]): Promise<void> {
    this.dispose()
    const atlas = await createTextureAtlas(items)
    const plane = new PlaneGeometry(1, 1)
    const geometry = new InstancedBufferGeometry()
    geometry.index = plane.index
    geometry.setAttribute('position', plane.getAttribute('position'))
    geometry.setAttribute('uv', plane.getAttribute('uv'))
    geometry.instanceCount = items.length
    geometry.setAttribute('atlasRect', new InstancedBufferAttribute(atlas.rects, 4))
    geometry.setAttribute('tunnelPath', new InstancedBufferAttribute(new Float32Array(items.length * 3), 3))
    geometry.setAttribute('tunnelSpeedFactor', new InstancedBufferAttribute(new Float32Array(items.length), 1))
    geometry.setAttribute('visibilityRank', new InstancedBufferAttribute(createVisibilityRanks(items.length), 1))
    this.material = new ShaderMaterial({
      uniforms: {
        atlas: { value: atlas.texture },
        progress: { value: 1 },
        billboard: { value: 0 },
        hideBackHemisphere: { value: 0 },
        effectMode: { value: 0 },
        effectTime: { value: 0 },
        tunnelFarZ: { value: -18 },
        tunnelNearZ: { value: 12 },
        tunnelInnerRadius: { value: 0.18 },
        tunnelSpeed: { value: 0.16 },
        tunnelTwist: { value: 0.08 },
        tunnelFarScale: { value: 0.32 },
        tunnelNearScale: { value: 1.15 },
        shooterSourceRadius: { value: 0.15 },
        shooterSpeed: { value: 0.24 },
        shooterStartScale: { value: 0.16 },
        shooterEndScale: { value: 1 },
        shooterZ: { value: 1.5 },
        visibleRatio: { value: 1 },
      },
      vertexShader: `
        attribute vec4 atlasRect;
        attribute vec3 fromPosition;
        attribute vec3 toPosition;
        attribute vec4 fromQuaternion;
        attribute vec4 toQuaternion;
        attribute float fromScale;
        attribute float toScale;
        attribute float fromOpacity;
        attribute float toOpacity;
        attribute vec3 tunnelPath;
        attribute float tunnelSpeedFactor;
        attribute float visibilityRank;
        uniform float progress;
        uniform float billboard;
        uniform float hideBackHemisphere;
        uniform float effectMode;
        uniform float effectTime;
        uniform float tunnelFarZ;
        uniform float tunnelNearZ;
        uniform float tunnelInnerRadius;
        uniform float tunnelSpeed;
        uniform float tunnelTwist;
        uniform float tunnelFarScale;
        uniform float tunnelNearScale;
        uniform float shooterSourceRadius;
        uniform float shooterSpeed;
        uniform float shooterStartScale;
        uniform float shooterEndScale;
        uniform float shooterZ;
        uniform float visibleRatio;
        varying vec2 vAtlasUv;
        varying vec2 vLocalUv;
        varying float vOpacity;
        varying float vInstanceVisible;

        vec3 rotateByQuaternion(vec3 value, vec4 quaternion) {
          return value + 2.0 * cross(quaternion.xyz, cross(quaternion.xyz, value) + quaternion.w * value);
        }

        vec4 interpolateQuaternion(vec4 fromValue, vec4 toValue, float amount) {
          vec4 target = dot(fromValue, toValue) < 0.0 ? -toValue : toValue;
          return normalize(mix(fromValue, target, amount));
        }

        void main() {
          vAtlasUv = atlasRect.xy + uv * atlasRect.zw;
          vLocalUv = uv;
          vOpacity = mix(fromOpacity, toOpacity, progress);
          vec3 center = mix(fromPosition, toPosition, progress);
          float itemScale = mix(fromScale, toScale, progress);
          vec4 itemQuaternion = interpolateQuaternion(fromQuaternion, toQuaternion, progress);
          float effectVisible = 1.0;

          if (effectMode > 1.5) {
            effectVisible = step(0.0, tunnelSpeedFactor);
            float shooterProgress = fract(tunnelPath.z + effectTime * shooterSpeed * abs(tunnelSpeedFactor));
            float currentDistance = mix(shooterSourceRadius, tunnelPath.y, shooterProgress);
            center = vec3(
              cos(tunnelPath.x) * currentDistance,
              sin(tunnelPath.x) * currentDistance,
              shooterZ
            );
            itemScale = mix(shooterStartScale, shooterEndScale, shooterProgress);
            vOpacity *= smoothstep(0.0, 0.04, shooterProgress)
              * (1.0 - smoothstep(0.82, 1.0, shooterProgress));
          } else if (effectMode > 0.5) {
            effectVisible = step(0.0, tunnelSpeedFactor);
            float tunnelProgress = fract(tunnelPath.z + effectTime * tunnelSpeed * abs(tunnelSpeedFactor));
            float spread = smoothstep(0.0, 1.0, tunnelProgress);
            float currentAngle = tunnelPath.x + tunnelProgress * tunnelTwist;
            float currentRadius = mix(tunnelInnerRadius, tunnelPath.y, spread);
            center = vec3(
              cos(currentAngle) * currentRadius,
              sin(currentAngle) * currentRadius,
              mix(tunnelFarZ, tunnelNearZ, tunnelProgress)
            );
            itemScale = mix(tunnelFarScale, tunnelNearScale, tunnelProgress);
            vOpacity *= smoothstep(0.0, 0.06, tunnelProgress)
              * (1.0 - smoothstep(0.9, 1.0, tunnelProgress));
          }

          if (billboard > 0.5 || effectMode > 0.5) {
            vec4 centerView = modelViewMatrix * vec4(center, 1.0);
            vec4 sphereCenterView = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
            vInstanceVisible = hideBackHemisphere > 0.5
              ? step(sphereCenterView.z, centerView.z)
              : 1.0;
            vInstanceVisible *= effectVisible;
            centerView.xy += position.xy * itemScale;
            gl_Position = projectionMatrix * centerView;
          } else {
            vInstanceVisible = 1.0;
            vec3 localPosition = rotateByQuaternion(position * itemScale, itemQuaternion);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(center + localPosition, 1.0);
          }
          vInstanceVisible *= step(visibilityRank, visibleRatio);
        }
      `,
      fragmentShader: `
        uniform sampler2D atlas;
        varying vec2 vAtlasUv;
        varying vec2 vLocalUv;
        varying float vOpacity;
        varying float vInstanceVisible;
        void main() {
          if (vInstanceVisible < 0.5) discard;
          vec4 color = texture2D(atlas, vAtlasUv);
          vec2 edgeIn = smoothstep(vec2(0.0), vec2(0.04), vLocalUv);
          vec2 edgeOut = smoothstep(vec2(0.0), vec2(0.04), vec2(1.0) - vLocalUv);
          float edge = edgeIn.x * edgeIn.y * edgeOut.x * edgeOut.y;
          gl_FragColor = vec4(color.rgb, color.a * edge * vOpacity);
        }
      `,
      transparent: true,
      side: FrontSide,
    })
    this.mesh = new Mesh(geometry, this.material)
    this.mesh.frustumCulled = false
    this.scene.add(this.mesh)
  }

  setTransforms(transforms: Transform[]): void {
    this.prepareTransition(transforms, transforms)
    this.setProgress(1)
  }

  prepareTransition(from: Transform[], to: Transform[]): void {
    if (!this.mesh) return
    const count = Math.min(from.length, to.length, this.mesh.geometry.instanceCount)
    const fromPosition = new Float32Array(count * 3)
    const toPosition = new Float32Array(count * 3)
    const fromQuaternion = new Float32Array(count * 4)
    const toQuaternion = new Float32Array(count * 4)
    const fromScale = new Float32Array(count)
    const toScale = new Float32Array(count)
    const fromOpacity = new Float32Array(count)
    const toOpacity = new Float32Array(count)

    for (let index = 0; index < count; index += 1) {
      this.writeTransform(from[index], index, fromPosition, fromQuaternion, fromScale, fromOpacity)
      this.writeTransform(to[index], index, toPosition, toQuaternion, toScale, toOpacity)
    }

    const geometry = this.mesh.geometry
    geometry.setAttribute('fromPosition', new InstancedBufferAttribute(fromPosition, 3))
    geometry.setAttribute('toPosition', new InstancedBufferAttribute(toPosition, 3))
    geometry.setAttribute('fromQuaternion', new InstancedBufferAttribute(fromQuaternion, 4))
    geometry.setAttribute('toQuaternion', new InstancedBufferAttribute(toQuaternion, 4))
    geometry.setAttribute('fromScale', new InstancedBufferAttribute(fromScale, 1))
    geometry.setAttribute('toScale', new InstancedBufferAttribute(toScale, 1))
    geometry.setAttribute('fromOpacity', new InstancedBufferAttribute(fromOpacity, 1))
    geometry.setAttribute('toOpacity', new InstancedBufferAttribute(toOpacity, 1))
    this.mesh.geometry.instanceCount = count
    this.setProgress(0)
  }

  setProgress(progress: number): void {
    if (this.material) this.material.uniforms.progress.value = progress
  }

  setGroupRotation(x: number, y: number): void {
    if (this.mesh) this.mesh.rotation.set(x, y, 0)
  }

  setOrientation(orientation: 'surface' | 'camera'): void {
    if (this.material) this.material.uniforms.billboard.value = orientation === 'camera' ? 1 : 0
  }

  setHideBackHemisphere(hidden: boolean): void {
    if (this.material) this.material.uniforms.hideBackHemisphere.value = hidden ? 1 : 0
  }

  enableTunnel(data: TunnelGpuData): void {
    if (!this.mesh || !this.material) return
    this.mesh.geometry.setAttribute('tunnelPath', new InstancedBufferAttribute(data.paths, 3))
    this.mesh.geometry.setAttribute('tunnelSpeedFactor', new InstancedBufferAttribute(data.speedFactors, 1))
    const uniforms = this.material.uniforms
    uniforms.tunnelFarZ.value = data.farZ
    uniforms.tunnelNearZ.value = data.nearZ
    uniforms.tunnelInnerRadius.value = data.innerRadius
    uniforms.tunnelSpeed.value = data.speed
    uniforms.tunnelTwist.value = data.twist
    uniforms.tunnelFarScale.value = data.farScale
    uniforms.tunnelNearScale.value = data.nearScale
    uniforms.effectTime.value = 0
    uniforms.effectMode.value = 1
    uniforms.hideBackHemisphere.value = 0
  }

  enableLinearShooter(data: LinearShooterGpuData): void {
    if (!this.mesh || !this.material) return
    this.mesh.geometry.setAttribute('tunnelPath', new InstancedBufferAttribute(data.paths, 3))
    this.mesh.geometry.setAttribute('tunnelSpeedFactor', new InstancedBufferAttribute(data.speedFactors, 1))
    const uniforms = this.material.uniforms
    uniforms.shooterSourceRadius.value = data.sourceRadius
    uniforms.shooterSpeed.value = data.speed
    uniforms.shooterStartScale.value = data.startScale
    uniforms.shooterEndScale.value = data.endScale
    uniforms.shooterZ.value = data.z
    uniforms.effectTime.value = 0
    uniforms.effectMode.value = 2
    uniforms.hideBackHemisphere.value = 0
  }

  disableEffect(): void {
    if (this.material) this.material.uniforms.effectMode.value = 0
  }

  setEffectTime(elapsedSeconds: number): void {
    if (this.material) this.material.uniforms.effectTime.value = elapsedSeconds
  }

  setVisibleRatio(ratio: number): void {
    if (this.material) this.material.uniforms.visibleRatio.value = Math.min(1, Math.max(0.05, ratio))
  }

  dispose(): void {
    if (!this.mesh) return
    this.scene.remove(this.mesh)
    this.mesh.geometry.dispose()
    const texture = this.material?.uniforms.atlas?.value as { dispose?: () => void } | undefined
    texture?.dispose?.()
    this.material?.dispose()
    this.mesh = null
    this.material = null
  }

  private writeTransform(
    transform: Transform,
    index: number,
    positions: Float32Array,
    quaternions: Float32Array,
    scales: Float32Array,
    opacities: Float32Array,
  ): void {
    positions.set([transform.x, transform.y, transform.z], index * 3)
    this.euler.set(transform.rotationX, transform.rotationY, transform.rotationZ, 'XYZ')
    this.quaternion.setFromEuler(this.euler)
    quaternions.set(
      [this.quaternion.x, this.quaternion.y, this.quaternion.z, this.quaternion.w],
      index * 4,
    )
    scales[index] = transform.scale
    opacities[index] = transform.opacity
  }
}

function createVisibilityRanks(count: number): Float32Array {
  const ranks = new Float32Array(count)
  for (let index = 0; index < count; index += 1) {
    // Irrational-step sequence distributes retained instances across layouts
    // instead of removing complete latitude rings or rows from the tail.
    ranks[index] = (index * 0.618033988749895) % 1
  }
  return ranks
}
