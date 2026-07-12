import {
  DynamicDrawUsage,
  Euler,
  FrontSide,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  PlaneGeometry,
  Quaternion,
  Scene,
  ShaderMaterial,
  Vector3,
} from 'three'
import type { MotionItem, Transform } from '../core/types'
import { createTextureAtlas } from './textureAtlas'

export class InstancedCardRenderer {
  private mesh: InstancedMesh | null = null
  private material: ShaderMaterial | null = null
  private readonly matrix = new Matrix4()
  private readonly position = new Vector3()
  private readonly rotation = new Quaternion()
  private readonly euler = new Euler()
  private readonly scale = new Vector3()

  constructor(private readonly scene: Scene) {}

  async setItems(items: MotionItem[]): Promise<void> {
    this.dispose()
    const atlas = await createTextureAtlas(items)
    const geometry = new PlaneGeometry(1, 1)
    geometry.setAttribute('atlasRect', new InstancedBufferAttribute(atlas.rects, 4))
    this.material = new ShaderMaterial({
      uniforms: {
        atlas: { value: atlas.texture },
        billboard: { value: 0 },
        hideBackHemisphere: { value: 0 },
      },
      vertexShader: `
        attribute vec4 atlasRect;
        uniform float billboard;
        uniform float hideBackHemisphere;
        varying vec2 vAtlasUv;
        varying vec2 vLocalUv;
        varying float vInstanceVisible;
        void main() {
          vAtlasUv = atlasRect.xy + uv * atlasRect.zw;
          vLocalUv = uv;
          if (billboard > 0.5) {
            vec4 centerView = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
            vec4 sphereCenterView = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
            float instanceScale = length(instanceMatrix[0].xyz);
            vInstanceVisible = hideBackHemisphere > 0.5
              ? step(sphereCenterView.z, centerView.z)
              : 1.0;
            centerView.xy += position.xy * instanceScale;
            gl_Position = projectionMatrix * centerView;
          } else {
            vInstanceVisible = 1.0;
            gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          }
        }
      `,
      fragmentShader: `
        uniform sampler2D atlas;
        varying vec2 vAtlasUv;
        varying vec2 vLocalUv;
        varying float vInstanceVisible;
        void main() {
          if (vInstanceVisible < 0.5) discard;
          vec4 color = texture2D(atlas, vAtlasUv);
          vec2 edgeIn = smoothstep(vec2(0.0), vec2(0.04), vLocalUv);
          vec2 edgeOut = smoothstep(vec2(0.0), vec2(0.04), vec2(1.0) - vLocalUv);
          float edge = edgeIn.x * edgeIn.y * edgeOut.x * edgeOut.y;
          gl_FragColor = vec4(color.rgb, color.a * edge);
        }
      `,
      transparent: true,
      side: FrontSide,
    })
    this.mesh = new InstancedMesh(geometry, this.material, items.length)
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    this.mesh.frustumCulled = false
    this.scene.add(this.mesh)
  }

  apply(transforms: Transform[]): void {
    if (!this.mesh) return
    transforms.forEach((transform, index) => {
      this.position.set(transform.x, transform.y, transform.z)
      this.euler.set(transform.rotationX, transform.rotationY, transform.rotationZ, 'XYZ')
      this.rotation.setFromEuler(this.euler)
      this.scale.setScalar(transform.scale)
      this.matrix.compose(this.position, this.rotation, this.scale)
      this.mesh?.setMatrixAt(index, this.matrix)
    })
    this.mesh.instanceMatrix.needsUpdate = true
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
}
