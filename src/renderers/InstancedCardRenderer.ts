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
  Vector4,
} from 'three'
import type { MotionItem, Transform } from '../core/types.js'
import type { StreamingEffectGpuData, StreamingEffectKind } from '../effects/types.js'
import {
  applyTextureAtlasPatch,
  createTextureAtlas,
  createTextureAtlasPatch,
  type TextureAtlasOptions,
  type TextureAtlasResult,
} from './textureAtlas.js'

export interface CardRendererStats {
  instanceCount: number
  textureBytes: number
}

export class InstancedCardRenderer {
  private mesh: Mesh<InstancedBufferGeometry, ShaderMaterial> | null = null
  private material: ShaderMaterial | null = null
  private generation = 0
  private itemsFingerprint = ''
  private textureBytes = 0
  private atlas: TextureAtlasResult | null = null
  private readonly euler = new Euler()
  private readonly quaternion = new Quaternion()

  constructor(private readonly scene: Scene, private readonly atlasOptions: TextureAtlasOptions = {}) {}

  async setItems(items: MotionItem[]): Promise<boolean> {
    const fingerprint = createItemsFingerprint(items)
    if (this.mesh && fingerprint === this.itemsFingerprint) return true
    const generation = ++this.generation
    const atlas = await createTextureAtlas(items, 64, this.atlasOptions)
    if (generation !== this.generation) {
      atlas.texture.dispose()
      return false
    }
    this.disposeCurrent()
    const plane = new PlaneGeometry(1, 1)
    const geometry = new InstancedBufferGeometry()
    geometry.index = plane.index
    geometry.setAttribute('position', plane.getAttribute('position'))
    geometry.setAttribute('uv', plane.getAttribute('uv'))
    geometry.instanceCount = items.length
    geometry.setAttribute('atlasRect', new InstancedBufferAttribute(atlas.rects, 4))
    geometry.setAttribute('effectPath', new InstancedBufferAttribute(new Float32Array(items.length * 4), 4))
    geometry.setAttribute('effectSpeedFactor', new InstancedBufferAttribute(new Float32Array(items.length), 1))
    geometry.setAttribute('visibilityRank', new InstancedBufferAttribute(createVisibilityRanks(items.length), 1))
    geometry.setAttribute('itemIndex', new InstancedBufferAttribute(createItemIndices(items.length), 1))
    this.material = new ShaderMaterial({
      uniforms: {
        atlas: { value: atlas.texture },
        progress: { value: 1 },
        billboard: { value: 0 },
        hideBackHemisphere: { value: 0 },
        effectMode: { value: 0 },
        effectTime: { value: 0 },
        effectParamsA: { value: new Vector4() },
        effectParamsB: { value: new Vector4() },
        effectParamsC: { value: new Vector4() },
        visibleRatio: { value: 1 },
        hoverIndex: { value: -1 },
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
        attribute vec4 effectPath;
        attribute float effectSpeedFactor;
        attribute float visibilityRank;
        attribute float itemIndex;
        uniform float progress;
        uniform float billboard;
        uniform float hideBackHemisphere;
        uniform float effectMode;
        uniform float effectTime;
        uniform vec4 effectParamsA;
        uniform vec4 effectParamsB;
        uniform vec4 effectParamsC;
        uniform float visibleRatio;
        uniform float hoverIndex;
        varying vec2 vAtlasUv;
        varying vec2 vLocalUv;
        varying float vOpacity;
        varying float vInstanceVisible;
        varying float vHighlight;

        vec3 rotateByQuaternion(vec3 value, vec4 quaternion) {
          return value + 2.0 * cross(quaternion.xyz, cross(quaternion.xyz, value) + quaternion.w * value);
        }

        vec4 interpolateQuaternion(vec4 fromValue, vec4 toValue, float amount) {
          vec4 target = dot(fromValue, toValue) < 0.0 ? -toValue : toValue;
          return normalize(mix(fromValue, target, amount));
        }

        float emissionEnvelope(float time, float mode, float burstInterval, float burstDuration, float waveFrequency, float waveStrength) {
          if (mode < 0.5) return 1.0;
          if (mode > 1.5) {
            float wave = sin(time * waveFrequency * 6.28318530718) * 0.5 + 0.5;
            return mix(1.0 - waveStrength, 1.0, wave);
          }
          float phase = mod(time, max(0.001, burstInterval));
          float edge = min(0.08, burstDuration * 0.25);
          return 1.0 - smoothstep(burstDuration - edge, burstDuration, phase);
        }

        vec2 tunnelCrossSection(float angle, float radius, float squareShape) {
          vec2 direction = vec2(cos(angle), sin(angle));
          if (squareShape > 0.5) direction /= max(max(abs(direction.x), abs(direction.y)), 0.000001);
          return direction * radius;
        }

        void main() {
          vAtlasUv = atlasRect.xy + uv * atlasRect.zw;
          vLocalUv = uv;
          vOpacity = mix(fromOpacity, toOpacity, progress);
          vec3 center = mix(fromPosition, toPosition, progress);
          float itemScale = mix(fromScale, toScale, progress);
          vHighlight = 1.0 - step(0.5, abs(itemIndex - hoverIndex));
          itemScale *= mix(1.0, 1.08, vHighlight);
          vec4 itemQuaternion = interpolateQuaternion(fromQuaternion, toQuaternion, progress);
          float effectVisible = 1.0;

          if (effectMode > 3.5) {
            effectVisible = step(0.0, effectSpeedFactor);
            float radialProgress = fract(effectPath.w + effectTime * effectParamsA.z * abs(effectSpeedFactor));
            float radialTravel = effectParamsB.z > 0.5 ? radialProgress : 1.0 - radialProgress;
            float radialDistance = mix(effectParamsA.x, effectPath.z, smoothstep(0.0, 1.0, radialTravel));
            float radialHorizontal = cos(effectPath.y) * radialDistance;
            center = vec3(
              cos(effectPath.x) * radialHorizontal,
              sin(effectPath.y) * radialDistance,
              effectParamsA.w + sin(effectPath.x) * radialHorizontal * effectParamsB.w
            );
            itemScale = mix(effectParamsB.x, effectParamsB.y, radialTravel);
            vOpacity *= smoothstep(0.0, 0.04, radialProgress)
              * (1.0 - smoothstep(0.86, 1.0, radialProgress));
          } else if (effectMode > 2.5) {
            effectVisible = step(0.0, effectSpeedFactor);
            float vortexProgress = fract(effectPath.z + effectTime * effectParamsB.x * abs(effectSpeedFactor));
            float vortexTravel = effectParamsC.x > 0.5 ? vortexProgress : 1.0 - vortexProgress;
            float vortexSpread = smoothstep(0.0, 1.0, vortexTravel);
            float vortexDirection = effectParamsC.x > 0.5 ? 1.0 : -1.0;
            float vortexAngle = effectPath.x + vortexProgress * effectParamsB.y * 6.28318530718 * vortexDirection;
            float vortexRadius = mix(effectParamsA.x, effectPath.y, vortexSpread);
            center = vec3(
              cos(vortexAngle) * vortexRadius,
              sin(vortexAngle) * vortexRadius,
              mix(effectParamsA.w, effectParamsA.z, vortexTravel)
            );
            itemScale = mix(effectParamsB.z, effectParamsB.w, vortexTravel);
            vOpacity *= smoothstep(0.0, 0.05, vortexProgress)
              * (1.0 - smoothstep(0.9, 1.0, vortexProgress));
          } else if (effectMode > 1.5) {
            effectVisible = step(0.0, effectSpeedFactor);
            float shooterProgress = fract(effectPath.z + effectTime * effectParamsA.y * abs(effectSpeedFactor));
            float currentDistance = mix(effectParamsA.x, effectPath.y, shooterProgress);
            center = vec3(
              cos(effectPath.x) * currentDistance,
              sin(effectPath.x) * currentDistance,
              effectParamsB.x
            );
            itemScale = mix(effectParamsA.z, effectParamsA.w, shooterProgress);
            vOpacity *= smoothstep(0.0, 0.04, shooterProgress)
              * (1.0 - smoothstep(0.82, 1.0, shooterProgress));
            vOpacity *= emissionEnvelope(effectTime, effectParamsB.w, effectParamsC.x, effectParamsC.y, effectParamsC.z, effectParamsC.w);
          } else if (effectMode > 0.5) {
            effectVisible = step(0.0, effectSpeedFactor);
            float tunnelProgress = fract(effectPath.z + effectTime * effectParamsA.w * abs(effectSpeedFactor));
            float spread = smoothstep(0.0, 1.0, tunnelProgress);
            float currentAngle = effectPath.x + tunnelProgress * effectParamsB.x;
            float currentRadius = mix(effectParamsA.z, effectPath.y, spread);
            vec2 tunnelPoint = tunnelCrossSection(currentAngle, currentRadius, effectPath.w);
            center = vec3(
              tunnelPoint,
              mix(effectParamsA.x, effectParamsA.y, tunnelProgress)
            );
            itemScale = mix(effectParamsB.y, effectParamsB.z, tunnelProgress);
            vOpacity *= smoothstep(0.0, 0.06, tunnelProgress)
              * (1.0 - smoothstep(0.9, 1.0, tunnelProgress));
            vOpacity *= emissionEnvelope(effectTime, effectParamsB.w, effectParamsC.x, effectParamsC.y, effectParamsC.z, effectParamsC.w);
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
        varying float vHighlight;
        void main() {
          if (vInstanceVisible < 0.5) discard;
          vec4 color = texture2D(atlas, vAtlasUv);
          vec2 edgeIn = smoothstep(vec2(0.0), vec2(0.04), vLocalUv);
          vec2 edgeOut = smoothstep(vec2(0.0), vec2(0.04), vec2(1.0) - vLocalUv);
          float edge = edgeIn.x * edgeIn.y * edgeOut.x * edgeOut.y;
          vec3 highlighted = mix(color.rgb, min(vec3(1.0), color.rgb * 1.16 + 0.06), vHighlight);
          gl_FragColor = vec4(highlighted, color.a * edge * vOpacity);
        }
      `,
      transparent: true,
      side: FrontSide,
    })
    this.mesh = new Mesh(geometry, this.material)
    this.mesh.frustumCulled = false
    this.scene.add(this.mesh)
    this.itemsFingerprint = fingerprint
    this.textureBytes = atlas.width * atlas.height * 4
    this.atlas = atlas
    return true
  }

  async updateItems(items: MotionItem[], changedIndices: number[]): Promise<boolean> {
    if (!this.mesh || !this.atlas || items.length !== this.mesh.geometry.instanceCount) {
      return this.setItems(items)
    }
    const fingerprint = createItemsFingerprint(items)
    if (fingerprint === this.itemsFingerprint) return true
    const generation = ++this.generation
    const patch = await createTextureAtlasPatch(items, changedIndices, this.atlas.cellSize, this.atlasOptions)
    if (generation !== this.generation || !this.atlas) return false
    applyTextureAtlasPatch(this.atlas, patch)
    this.itemsFingerprint = fingerprint
    return true
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

  enableEffect(data: StreamingEffectGpuData): void {
    if (!this.mesh || !this.material) return
    this.mesh.geometry.setAttribute('effectPath', new InstancedBufferAttribute(data.paths, 4))
    this.mesh.geometry.setAttribute('effectSpeedFactor', new InstancedBufferAttribute(data.speedFactors, 1))
    const uniforms = this.material.uniforms
    setVector4(uniforms.effectParamsA.value as Vector4, data.parameters, 0)
    setVector4(uniforms.effectParamsB.value as Vector4, data.parameters, 4)
    setVector4(uniforms.effectParamsC.value as Vector4, data.parameters, 8)
    uniforms.effectTime.value = 0
    uniforms.effectMode.value = effectMode(data.kind)
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

  setHoverIndex(index: number | null): void {
    if (this.material) this.material.uniforms.hoverIndex.value = index ?? -1
  }

  getStats(): CardRendererStats {
    return {
      instanceCount: this.mesh?.geometry.instanceCount ?? 0,
      textureBytes: this.textureBytes,
    }
  }

  dispose(): void {
    this.generation += 1
    this.disposeCurrent()
  }

  private disposeCurrent(): void {
    if (!this.mesh) return
    this.scene.remove(this.mesh)
    this.mesh.geometry.dispose()
    const texture = this.material?.uniforms.atlas?.value as { dispose?: () => void } | undefined
    texture?.dispose?.()
    this.material?.dispose()
    this.mesh = null
    this.material = null
    this.itemsFingerprint = ''
    this.textureBytes = 0
    this.atlas = null
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

function effectMode(kind: StreamingEffectKind): number {
  switch (kind) {
    case 'tunnel': return 1
    case 'linear-shooter': return 2
    case 'vortex': return 3
    case 'radial-burst': return 4
  }
}

function setVector4(target: Vector4, values: Float32Array, offset: number): void {
  target.set(values[offset], values[offset + 1], values[offset + 2], values[offset + 3])
}

function createItemsFingerprint(items: MotionItem[]): string {
  return items
    .map((item) => {
      let meta = ''
      try {
        meta = JSON.stringify(item.meta) ?? ''
      } catch {
        meta = String(item.meta ?? '')
      }
      return `${item.id.length}:${item.id}|${item.image?.length ?? 0}:${item.image ?? ''}|${item.title?.length ?? 0}:${item.title ?? ''}|${meta.length}:${meta}`
    })
    .join('\n')
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

function createItemIndices(count: number): Float32Array {
  return Float32Array.from({ length: count }, (_, index) => index)
}
