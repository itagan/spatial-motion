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
  TextureAtlasImageCache,
  type TextureAtlasOptions,
  type TextureAtlasPatch,
  type TextureAtlasResult,
} from './textureAtlas.js'

export interface CardRendererStats {
  instanceCount: number
  submittedInstanceCount: number
  textureBytes: number
  atlasBuilds: number
  atlasPatches: number
  atlasDiscardedBuilds: number
  atlasDiscardedPatches: number
  atlasCellsUpdated: number
  atlasBuildMs: number
  atlasPatchMs: number
  atlasDrawMs: number
  imageLoadMs: number
  imageRequests: number
  imageFailures: number
  estimatedTextureUploadBytes: number
}

interface CardRendererOptions extends TextureAtlasOptions {
  cellSize?: number
}

export class InstancedCardRenderer {
  private mesh: Mesh<InstancedBufferGeometry, ShaderMaterial> | null = null
  private instanceCapacity = 0
  private material: ShaderMaterial | null = null
  private generation = 0
  private itemsFingerprint = ''
  private textureBytes = 0
  private atlas: TextureAtlasResult | null = null
  private atlasBuilds = 0
  private atlasPatches = 0
  private atlasDiscardedBuilds = 0
  private atlasDiscardedPatches = 0
  private atlasCellsUpdated = 0
  private atlasBuildMs = 0
  private atlasPatchMs = 0
  private atlasDrawMs = 0
  private imageLoadMs = 0
  private imageRequests = 0
  private imageFailures = 0
  private estimatedTextureUploadBytes = 0
  private readonly euler = new Euler()
  private readonly quaternion = new Quaternion()
  private readonly imageCache: TextureAtlasImageCache
  private atlasAbortController: AbortController | null = null

  constructor(private readonly scene: Scene, private readonly atlasOptions: CardRendererOptions = {}) {
    this.imageCache = new TextureAtlasImageCache(normalizeImageCacheSize(atlasOptions.imageCacheSize))
  }

  async setItems(items: MotionItem[]): Promise<boolean> {
    const fingerprint = createItemsFingerprint(items, this.atlasOptions)
    if (this.mesh && fingerprint === this.itemsFingerprint && !this.atlasAbortController) return true
    const { controller, generation, options } = this.beginAtlasOperation()
    let atlas: TextureAtlasResult
    try {
      atlas = await createTextureAtlas(items, this.atlasOptions.cellSize ?? 64, options)
    } catch (error) {
      if (generation !== this.generation || isAbortError(error)) return false
      throw error
    } finally {
      if (this.atlasAbortController === controller) this.atlasAbortController = null
    }
    if (generation !== this.generation) {
      this.atlasDiscardedBuilds += 1
      atlas.texture.dispose()
      return false
    }
    this.disposeCurrent()
    const aspectRatio = resolveAspectRatio(this.atlasOptions.aspectRatio)
    const plane = new PlaneGeometry(
      aspectRatio >= 1 ? 1 : aspectRatio,
      aspectRatio >= 1 ? 1 / aspectRatio : 1,
    )
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
        fromBillboard: { value: 0 },
        toBillboard: { value: 0 },
        fromHideBackHemisphere: { value: 0 },
        toHideBackHemisphere: { value: 0 },
        fromHemisphereEdgeFade: { value: 0 },
        toHemisphereEdgeFade: { value: 0 },
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
        uniform float fromBillboard;
        uniform float toBillboard;
        uniform float fromHideBackHemisphere;
        uniform float toHideBackHemisphere;
        uniform float fromHemisphereEdgeFade;
        uniform float toHemisphereEdgeFade;
        uniform float effectMode;
        uniform float effectTime;
        uniform vec4 effectParamsA;
        uniform vec4 effectParamsB;
        uniform vec4 effectParamsC;
        uniform float visibleRatio;
        uniform float hoverIndex;
        varying vec2 vAtlasUv;
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
          float edge = min(0.1, burstDuration * 0.25);
          return smoothstep(0.0, edge, phase)
            * (1.0 - smoothstep(burstDuration - edge, burstDuration, phase));
        }

        float effectTravel(float progress) {
          float value = clamp(progress, 0.0, 1.0);
          return value * value * value * (value * (value * 6.0 - 15.0) + 10.0);
        }

        float effectEdgeFade(float progress, float fadeIn, float fadeOut) {
          return smoothstep(0.0, fadeIn, progress)
            * (1.0 - smoothstep(1.0 - fadeOut, 1.0, progress));
        }

        vec2 tunnelCrossSection(float angle, float radius, float squareShape) {
          vec2 direction = vec2(cos(angle), sin(angle));
          if (squareShape > 0.5) direction /= max(max(abs(direction.x), abs(direction.y)), 0.000001);
          return direction * radius;
        }

        void main() {
          vAtlasUv = atlasRect.xy + uv * atlasRect.zw;
          if (visibilityRank > visibleRatio) {
            vOpacity = 0.0;
            vInstanceVisible = 0.0;
            vHighlight = 0.0;
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            return;
          }
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
            float radialCurvedProgress = effectTravel(radialProgress);
            float radialTravel = effectParamsB.z > 0.5 ? radialCurvedProgress : 1.0 - radialCurvedProgress;
            float radialDistance = mix(effectParamsA.x, effectPath.z, smoothstep(0.0, 1.0, radialTravel));
            float radialHorizontal = cos(effectPath.y) * radialDistance;
            center = vec3(
              cos(effectPath.x) * radialHorizontal,
              sin(effectPath.y) * radialDistance,
              effectParamsA.w + sin(effectPath.x) * radialHorizontal * effectParamsB.w
            );
            itemScale = mix(effectParamsB.x, effectParamsB.y, radialTravel);
            vOpacity *= effectEdgeFade(radialProgress, 0.06, 0.2);
          } else if (effectMode > 2.5) {
            effectVisible = step(0.0, effectSpeedFactor);
            float vortexProgress = fract(effectPath.z + effectTime * effectParamsB.x * abs(effectSpeedFactor));
            float vortexCurvedProgress = effectTravel(vortexProgress);
            float vortexTravel = effectParamsC.x > 0.5 ? vortexCurvedProgress : 1.0 - vortexCurvedProgress;
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
            vOpacity *= effectEdgeFade(vortexProgress, 0.07, 0.18);
          } else if (effectMode > 1.5) {
            effectVisible = step(0.0, effectSpeedFactor);
            float shooterProgress = fract(effectPath.z + effectTime * effectParamsA.y * abs(effectSpeedFactor));
            float shooterTravel = effectTravel(shooterProgress);
            float currentDistance = mix(effectParamsA.x, effectPath.y, shooterTravel);
            center = vec3(
              cos(effectPath.x) * currentDistance,
              sin(effectPath.x) * currentDistance,
              effectParamsB.x
            );
            itemScale = mix(effectParamsA.z, effectParamsA.w, shooterTravel);
            vOpacity *= effectEdgeFade(shooterProgress, 0.06, 0.22);
            vOpacity *= emissionEnvelope(effectTime, effectParamsB.w, effectParamsC.x, effectParamsC.y, effectParamsC.z, effectParamsC.w);
          } else if (effectMode > 0.5) {
            effectVisible = step(0.0, effectSpeedFactor);
            float tunnelProgress = fract(effectPath.z + effectTime * effectParamsA.w * abs(effectSpeedFactor));
            float tunnelTravel = effectTravel(tunnelProgress);
            float spread = smoothstep(0.0, 1.0, tunnelTravel);
            float currentAngle = effectPath.x + tunnelProgress * effectParamsB.x;
            float currentRadius = mix(effectParamsA.z, effectPath.y, spread);
            vec2 tunnelPoint = tunnelCrossSection(currentAngle, currentRadius, effectPath.w);
            center = vec3(
              tunnelPoint,
              mix(effectParamsA.x, effectParamsA.y, tunnelTravel)
            );
            itemScale = mix(effectParamsB.y, effectParamsB.z, tunnelTravel);
            vOpacity *= effectEdgeFade(tunnelProgress, 0.08, 0.18);
            vOpacity *= emissionEnvelope(effectTime, effectParamsB.w, effectParamsC.x, effectParamsC.y, effectParamsC.z, effectParamsC.w);
          }

          vec4 centerView = modelViewMatrix * vec4(center, 1.0);
          if (effectMode > 0.5) {
            vInstanceVisible = effectVisible;
            centerView.xy += position.xy * itemScale;
            gl_Position = projectionMatrix * centerView;
          } else {
            vec3 localPosition = rotateByQuaternion(position * itemScale, itemQuaternion);
            vec4 surfaceView = modelViewMatrix * vec4(center + localPosition, 1.0);
            vec4 billboardView = centerView;
            billboardView.xy += position.xy * itemScale;
            float billboardAmount = mix(fromBillboard, toBillboard, progress);
            gl_Position = projectionMatrix * mix(surfaceView, billboardView, billboardAmount);

            vec4 sphereCenterView = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
            float hemisphereVisible = step(sphereCenterView.z, centerView.z);
            float hideBackAmount = mix(fromHideBackHemisphere, toHideBackHemisphere, progress);
            vOpacity *= mix(1.0, hemisphereVisible, hideBackAmount);
            float edgeFade = mix(fromHemisphereEdgeFade, toHemisphereEdgeFade, progress);
            if (edgeFade > 0.0) {
              vec3 radialView = normalize(centerView.xyz - sphereCenterView.xyz);
              float facing = dot(radialView, normalize(-centerView.xyz));
              vOpacity *= smoothstep(0.0, edgeFade, facing);
            }
            vInstanceVisible = 1.0;
          }
        }
      `,
      fragmentShader: `
        uniform sampler2D atlas;
        varying vec2 vAtlasUv;
        varying float vOpacity;
        varying float vInstanceVisible;
        varying float vHighlight;
        void main() {
          if (vInstanceVisible < 0.5) discard;
          vec4 color = texture2D(atlas, vAtlasUv);
          vec3 highlighted = mix(color.rgb, min(vec3(1.0), color.rgb * 1.16 + 0.06), vHighlight);
          gl_FragColor = vec4(highlighted, color.a * vOpacity);
        }
      `,
      transparent: true,
      side: FrontSide,
    })
    this.mesh = new Mesh(geometry, this.material)
    this.instanceCapacity = items.length
    this.mesh.frustumCulled = false
    this.scene.add(this.mesh)
    this.itemsFingerprint = fingerprint
    this.textureBytes = Math.ceil(atlas.width * atlas.height * 4 * 4 / 3)
    this.atlasBuilds += 1
    this.atlasCellsUpdated += atlas.metrics.cells
    this.atlasBuildMs += atlas.metrics.renderMs
    this.atlasDrawMs += atlas.metrics.applyMs
    this.imageLoadMs += atlas.metrics.imageLoadMs
    this.imageRequests += atlas.metrics.imageRequests
    this.imageFailures += atlas.metrics.imageFailures
    this.estimatedTextureUploadBytes += atlas.metrics.uploadBytes
    this.atlas = atlas
    return true
  }

  async updateItems(items: MotionItem[], changedIndices: number[]): Promise<boolean> {
    if (!this.mesh || !this.atlas || items.length !== this.instanceCapacity) {
      return this.setItems(items)
    }
    const fingerprint = createItemsFingerprint(items, this.atlasOptions)
    if (fingerprint === this.itemsFingerprint && !this.atlasAbortController) return true
    const { controller, generation, options } = this.beginAtlasOperation()
    let patch: TextureAtlasPatch
    try {
      patch = await createTextureAtlasPatch(items, changedIndices, this.atlas.cellSize, options)
    } catch (error) {
      if (generation !== this.generation || isAbortError(error)) return false
      throw error
    } finally {
      if (this.atlasAbortController === controller) this.atlasAbortController = null
    }
    if (generation !== this.generation || !this.atlas) {
      this.atlasDiscardedPatches += 1
      return false
    }
    const applyMs = applyTextureAtlasPatch(this.atlas, patch)
    this.atlasPatches += 1
    this.atlasCellsUpdated += patch.metrics.cells
    this.atlasPatchMs += patch.metrics.renderMs + applyMs
    this.atlasDrawMs += applyMs
    this.imageLoadMs += patch.metrics.imageLoadMs
    this.imageRequests += patch.metrics.imageRequests
    this.imageFailures += patch.metrics.imageFailures
    this.estimatedTextureUploadBytes += patch.metrics.uploadBytes
    this.itemsFingerprint = fingerprint
    return true
  }

  setTransforms(transforms: Transform[]): void {
    this.prepareTransition(transforms, transforms)
    this.setProgress(1)
  }

  prepareTransition(
    from: Transform[],
    to: Transform[],
    fromBillboard?: number,
    toBillboard?: number,
    fromHideBackHemisphere?: number,
    toHideBackHemisphere?: number,
    fromHemisphereEdgeFade?: number,
    toHemisphereEdgeFade?: number,
  ): void {
    if (!this.mesh) return
    const count = Math.min(from.length, to.length, this.instanceCapacity)
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
    if (this.material) {
      const uniforms = this.material.uniforms
      uniforms.fromBillboard.value = fromBillboard ?? uniforms.toBillboard.value
      uniforms.toBillboard.value = toBillboard ?? uniforms.toBillboard.value
      uniforms.fromHideBackHemisphere.value = fromHideBackHemisphere ?? uniforms.toHideBackHemisphere.value
      uniforms.toHideBackHemisphere.value = toHideBackHemisphere ?? uniforms.toHideBackHemisphere.value
      uniforms.fromHemisphereEdgeFade.value = fromHemisphereEdgeFade ?? uniforms.toHemisphereEdgeFade.value
      uniforms.toHemisphereEdgeFade.value = toHemisphereEdgeFade ?? uniforms.toHemisphereEdgeFade.value
    }
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
    if (!this.material) return
    const value = orientation === 'camera' ? 1 : 0
    this.material.uniforms.fromBillboard.value = value
    this.material.uniforms.toBillboard.value = value
  }

  setHideBackHemisphere(hidden: boolean): void {
    if (!this.material) return
    const value = hidden ? 1 : 0
    this.material.uniforms.fromHideBackHemisphere.value = value
    this.material.uniforms.toHideBackHemisphere.value = value
  }

  setHemisphereEdgeFade(amount: number): void {
    if (!this.material) return
    this.material.uniforms.fromHemisphereEdgeFade.value = amount
    this.material.uniforms.toHemisphereEdgeFade.value = amount
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
    uniforms.fromHideBackHemisphere.value = 0
    uniforms.toHideBackHemisphere.value = 0
    uniforms.fromHemisphereEdgeFade.value = 0
    uniforms.toHemisphereEdgeFade.value = 0
    let activeCount = 0
    while (activeCount < data.speedFactors.length && data.speedFactors[activeCount] >= 0) {
      activeCount += 1
    }
    this.mesh.geometry.instanceCount = Math.min(this.instanceCapacity, activeCount)
  }

  disableEffect(): void {
    if (this.material) this.material.uniforms.effectMode.value = 0
    if (this.mesh) this.mesh.geometry.instanceCount = this.instanceCapacity
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

  refreshTexture(): void {
    if (this.atlas) {
      this.atlas.initialized = false
      this.atlas.texture.clearUpdateRanges()
      this.atlas.texture.needsUpdate = true
      this.estimatedTextureUploadBytes += this.atlas.data.byteLength
    }
  }

  getStats(): CardRendererStats {
    return {
      instanceCount: this.mesh ? this.instanceCapacity : 0,
      submittedInstanceCount: this.mesh?.geometry.instanceCount ?? 0,
      textureBytes: this.textureBytes,
      atlasBuilds: this.atlasBuilds,
      atlasPatches: this.atlasPatches,
      atlasDiscardedBuilds: this.atlasDiscardedBuilds,
      atlasDiscardedPatches: this.atlasDiscardedPatches,
      atlasCellsUpdated: this.atlasCellsUpdated,
      atlasBuildMs: this.atlasBuildMs,
      atlasPatchMs: this.atlasPatchMs,
      atlasDrawMs: this.atlasDrawMs,
      imageLoadMs: this.imageLoadMs,
      imageRequests: this.imageRequests,
      imageFailures: this.imageFailures,
      estimatedTextureUploadBytes: this.estimatedTextureUploadBytes,
    }
  }

  dispose(): void {
    this.generation += 1
    this.atlasAbortController?.abort()
    this.atlasAbortController = null
    this.imageCache.clear()
    this.disposeCurrent()
  }

  private beginAtlasOperation(): {
    controller: AbortController
    generation: number
    options: TextureAtlasOptions
  } {
    this.atlasAbortController?.abort()
    const controller = new AbortController()
    this.atlasAbortController = controller
    return {
      controller,
      generation: ++this.generation,
      options: {
        ...this.atlasOptions,
        imageCache: this.imageCache,
        signal: controller.signal,
      },
    }
  }

  private disposeCurrent(): void {
    if (!this.mesh) return
    this.scene.remove(this.mesh)
    this.mesh.geometry.dispose()
    const texture = this.material?.uniforms.atlas?.value as { dispose?: () => void } | undefined
    texture?.dispose?.()
    this.material?.dispose()
    this.mesh = null
    this.instanceCapacity = 0
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

function normalizeImageCacheSize(value: number | undefined): number {
  return Math.min(1024, Math.max(0, Math.floor(Number.isFinite(value) ? value as number : 128)))
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
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

function createItemsFingerprint(items: MotionItem[], options: TextureAtlasOptions): string {
  return items
    .map((item) => {
      let meta = ''
      let style = ''
      try {
        meta = JSON.stringify(item.meta) ?? ''
      } catch {
        meta = String(item.meta ?? '')
      }
      try {
        style = JSON.stringify(options.resolveCardStyle?.(item)) ?? ''
      } catch {
        style = ''
      }
      return `${item.id.length}:${item.id}|${item.image?.length ?? 0}:${item.image ?? ''}|${item.title?.length ?? 0}:${item.title ?? ''}|${meta.length}:${meta}|${style.length}:${style}`
    })
    .join('\n')
}

function resolveAspectRatio(value: number | undefined): number {
  return Number.isFinite(value) ? Math.min(4, Math.max(0.25, value as number)) : 1
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
