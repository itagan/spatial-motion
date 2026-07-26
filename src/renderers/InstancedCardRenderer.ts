import {
  DynamicDrawUsage,
  Euler,
  FrontSide,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  Object3D,
  PlaneGeometry,
  Quaternion,
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
import type {
  MotionRenderer,
  MotionRendererCapabilities,
  MotionRendererDescriptor,
  MotionRendererStats,
  MotionRendererViewport,
  MotionRendererVisualState,
} from './MotionRenderer.js'

export interface CardRendererOptions<TMeta = unknown> extends TextureAtlasOptions<TMeta> {
  cellSize?: number | 'auto'
}

export class InstancedCardRenderer<TMeta = unknown> implements MotionRenderer<TMeta> {
  readonly capabilities: MotionRendererCapabilities<TMeta>
  readonly descriptor: MotionRendererDescriptor
  private mesh: Mesh<InstancedBufferGeometry, ShaderMaterial> | null = null
  private instanceCapacity = 0
  private itemCount = 0
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
  private atlasPrepareMs = 0
  private atlasImageLoadWallMs = 0
  private atlasCellRenderMs = 0
  private atlasReadbackMs = 0
  private imageLoadMs = 0
  private imageRequests = 0
  private imageFailures = 0
  private estimatedTextureUploadBytes = 0
  private geometryBuilds = 0
  private attributeReuses = 0
  private atlasUploadRanges = 0
  private readonly euler = new Euler()
  private readonly quaternion = new Quaternion()
  private readonly imageCache: TextureAtlasImageCache
  private atlasAbortController: AbortController | null = null

  constructor(
    private readonly root: Object3D,
    private readonly atlasOptions: CardRendererOptions<TMeta> = {},
  ) {
    this.imageCache = new TextureAtlasImageCache(normalizeImageCacheSize(atlasOptions.imageCacheSize))
    const aspectRatio = resolveAspectRatio(atlasOptions.aspectRatio)
    this.descriptor = {
      itemBounds: {
        kind: 'quad',
        width: aspectRatio >= 1 ? 1 : aspectRatio,
        height: aspectRatio >= 1 ? 1 / aspectRatio : 1,
        facing: 'layout',
      },
    }
    this.capabilities = {
      patch: { updateItems: (items, changedIndices) => this.updateItems(items, changedIndices) },
      visual: {
        setVisualState: (state) => this.setVisualState(state),
        prepareVisualTransition: (from, to) => this.prepareVisualTransition(from, to),
      },
      highlight: { setHighlightIndex: (index) => this.setHoverIndex(index) },
      viewport: { resize: (viewport) => this.resize(viewport) },
      resourceRecovery: { refreshResources: () => this.refreshResources() },
      streamingEffects: {
        enable: (data) => this.enableEffect(data),
        disable: () => this.disableEffect(),
        setTime: (elapsedSeconds) => this.setEffectTime(elapsedSeconds),
      },
    }
  }

  async setItems(items: readonly MotionItem<TMeta>[]): Promise<boolean> {
    const fingerprint = createItemsFingerprint(items, this.atlasOptions)
    if (this.mesh && fingerprint === this.itemsFingerprint && !this.atlasAbortController) return true
    const { controller, generation, options } = this.beginAtlasOperation()
    let atlas: TextureAtlasResult
    try {
      atlas = await createTextureAtlas(
        items,
        resolveAtlasResolution(
          this.atlasOptions.cellSize,
          items.length,
          Boolean(this.atlasOptions.cardContent || this.atlasOptions.drawCard),
        ),
        options,
      )
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
    const nextCapacity = resolveBufferCapacity(this.instanceCapacity, items.length)
    if (this.mesh && this.material && nextCapacity === this.instanceCapacity) {
      this.replaceAtlas(atlas, items.length)
      this.itemsFingerprint = fingerprint
      this.recordAtlasBuild(atlas)
      this.attributeReuses += 1
      return true
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
    geometry.setAttribute('atlasRect', dynamicAttribute(new Float32Array(nextCapacity * 4), 4))
    geometry.setAttribute('effectPath', dynamicAttribute(new Float32Array(nextCapacity * 4), 4))
    geometry.setAttribute('effectSpeedFactor', dynamicAttribute(new Float32Array(nextCapacity), 1))
    geometry.setAttribute('visibilityRank', new InstancedBufferAttribute(createVisibilityRanks(nextCapacity), 1))
    geometry.setAttribute('itemIndex', new InstancedBufferAttribute(createItemIndices(nextCapacity), 1))
    geometry.setAttribute('fromPosition', dynamicAttribute(new Float32Array(nextCapacity * 3), 3))
    geometry.setAttribute('toPosition', dynamicAttribute(new Float32Array(nextCapacity * 3), 3))
    geometry.setAttribute('fromQuaternion', dynamicAttribute(new Float32Array(nextCapacity * 4), 4))
    geometry.setAttribute('toQuaternion', dynamicAttribute(new Float32Array(nextCapacity * 4), 4))
    geometry.setAttribute('fromScale', dynamicAttribute(new Float32Array(nextCapacity), 1))
    geometry.setAttribute('toScale', dynamicAttribute(new Float32Array(nextCapacity), 1))
    geometry.setAttribute('fromOpacity', dynamicAttribute(new Float32Array(nextCapacity), 1))
    geometry.setAttribute('toOpacity', dynamicAttribute(new Float32Array(nextCapacity), 1))
    copyAttribute(geometry.getAttribute('atlasRect') as InstancedBufferAttribute, atlas.rects)
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
    this.instanceCapacity = nextCapacity
    this.itemCount = items.length
    this.geometryBuilds += 1
    this.mesh.frustumCulled = false
    this.root.add(this.mesh)
    this.itemsFingerprint = fingerprint
    this.atlas = atlas
    this.recordAtlasBuild(atlas)
    return true
  }

  async updateItems(
    items: readonly MotionItem<TMeta>[],
    changedIndices: readonly number[],
  ): Promise<boolean> {
    if (!this.mesh || !this.atlas || items.length !== this.itemCount) {
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
    this.atlasPrepareMs += patch.metrics.prepareMs
    this.atlasImageLoadWallMs += patch.metrics.imageLoadWallMs
    this.atlasCellRenderMs += patch.metrics.cellRenderMs
    this.imageLoadMs += patch.metrics.imageLoadMs
    this.imageRequests += patch.metrics.imageRequests
    this.imageFailures += patch.metrics.imageFailures
    this.estimatedTextureUploadBytes += patch.metrics.uploadBytes
    this.atlasUploadRanges += patch.metrics.uploadRanges ?? 0
    this.itemsFingerprint = fingerprint
    return true
  }

  setTransforms(transforms: readonly Transform[]): void {
    this.prepareTransition(transforms, transforms)
    this.setProgress(1)
  }

  prepareTransition(
    from: readonly Transform[],
    to: readonly Transform[],
  ): void {
    if (!this.mesh) return
    const count = Math.min(from.length, to.length, this.itemCount)
    const geometry = this.mesh.geometry
    const fromPosition = geometry.getAttribute('fromPosition') as InstancedBufferAttribute
    const toPosition = geometry.getAttribute('toPosition') as InstancedBufferAttribute
    const fromQuaternion = geometry.getAttribute('fromQuaternion') as InstancedBufferAttribute
    const toQuaternion = geometry.getAttribute('toQuaternion') as InstancedBufferAttribute
    const fromScale = geometry.getAttribute('fromScale') as InstancedBufferAttribute
    const toScale = geometry.getAttribute('toScale') as InstancedBufferAttribute
    const fromOpacity = geometry.getAttribute('fromOpacity') as InstancedBufferAttribute
    const toOpacity = geometry.getAttribute('toOpacity') as InstancedBufferAttribute

    for (let index = 0; index < count; index += 1) {
      this.writeTransform(
        from[index],
        index,
        fromPosition.array as Float32Array,
        fromQuaternion.array as Float32Array,
        fromScale.array as Float32Array,
        fromOpacity.array as Float32Array,
      )
      this.writeTransform(
        to[index],
        index,
        toPosition.array as Float32Array,
        toQuaternion.array as Float32Array,
        toScale.array as Float32Array,
        toOpacity.array as Float32Array,
      )
    }

    ;[fromPosition, toPosition].forEach((attribute) => markAttribute(attribute, count * 3))
    ;[fromQuaternion, toQuaternion].forEach((attribute) => markAttribute(attribute, count * 4))
    ;[fromScale, toScale, fromOpacity, toOpacity]
      .forEach((attribute) => markAttribute(attribute, count))
    this.attributeReuses += 8
    geometry.instanceCount = count
    this.setProgress(0)
  }

  prepareVisualTransition(
    from: MotionRendererVisualState,
    to: MotionRendererVisualState,
  ): void {
    if (!this.material) return
    const uniforms = this.material.uniforms
    uniforms.fromBillboard.value = from.billboard
    uniforms.toBillboard.value = to.billboard
    uniforms.fromHideBackHemisphere.value = from.hideBackHemisphere
    uniforms.toHideBackHemisphere.value = to.hideBackHemisphere
    uniforms.fromHemisphereEdgeFade.value = from.hemisphereEdgeFade
    uniforms.toHemisphereEdgeFade.value = to.hemisphereEdgeFade
  }

  setProgress(progress: number): void {
    if (this.material) this.material.uniforms.progress.value = progress
  }

  setVisualState(state: MotionRendererVisualState): void {
    if (!this.material) return
    const uniforms = this.material.uniforms
    uniforms.fromBillboard.value = state.billboard
    uniforms.toBillboard.value = state.billboard
    uniforms.fromHideBackHemisphere.value = state.hideBackHemisphere
    uniforms.toHideBackHemisphere.value = state.hideBackHemisphere
    uniforms.fromHemisphereEdgeFade.value = state.hemisphereEdgeFade
    uniforms.toHemisphereEdgeFade.value = state.hemisphereEdgeFade
  }

  enableEffect(data: StreamingEffectGpuData): void {
    if (!this.mesh || !this.material) return
    const effectPath = this.mesh.geometry.getAttribute('effectPath') as InstancedBufferAttribute
    const effectSpeed = this.mesh.geometry.getAttribute('effectSpeedFactor') as InstancedBufferAttribute
    ;(effectPath.array as Float32Array).fill(0)
    ;(effectSpeed.array as Float32Array).fill(-1)
    ;(effectPath.array as Float32Array).set(data.paths.subarray(0, effectPath.array.length))
    ;(effectSpeed.array as Float32Array).set(
      data.speedFactors.subarray(0, effectSpeed.array.length),
    )
    markAttribute(effectPath, Math.min(effectPath.array.length, data.paths.length))
    markAttribute(effectSpeed, Math.min(effectSpeed.array.length, data.speedFactors.length))
    this.attributeReuses += 2
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
    this.mesh.geometry.instanceCount = Math.min(this.itemCount, activeCount)
  }

  disableEffect(): void {
    if (this.material) this.material.uniforms.effectMode.value = 0
    if (this.mesh) this.mesh.geometry.instanceCount = this.itemCount
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

  resize(_viewport: MotionRendererViewport): void {}

  refreshResources(): void {
    if (this.atlas) {
      this.atlas.initialized = false
      this.atlas.texture.clearUpdateRanges()
      this.atlas.texture.needsUpdate = true
      this.estimatedTextureUploadBytes += this.atlas.data.byteLength
    }
  }

  getStats(): MotionRendererStats {
    return {
      instanceCount: this.mesh ? this.itemCount : 0,
      submittedInstanceCount: this.mesh?.geometry.instanceCount ?? 0,
      gpuBytes: this.textureBytes + geometryByteLength(this.mesh?.geometry),
      metrics: {
        textureBytes: this.textureBytes,
        atlasBuilds: this.atlasBuilds,
        atlasPatches: this.atlasPatches,
        atlasDiscardedBuilds: this.atlasDiscardedBuilds,
        atlasDiscardedPatches: this.atlasDiscardedPatches,
        atlasCellsUpdated: this.atlasCellsUpdated,
        atlasBuildMs: this.atlasBuildMs,
        atlasPatchMs: this.atlasPatchMs,
        atlasDrawMs: this.atlasDrawMs,
        atlasPrepareMs: this.atlasPrepareMs,
        atlasImageLoadWallMs: this.atlasImageLoadWallMs,
        atlasCellRenderMs: this.atlasCellRenderMs,
        atlasReadbackMs: this.atlasReadbackMs,
        imageLoadMs: this.imageLoadMs,
        imageRequests: this.imageRequests,
        imageFailures: this.imageFailures,
        estimatedTextureUploadBytes: this.estimatedTextureUploadBytes,
        capacity: this.mesh ? this.instanceCapacity : 0,
        geometryBuilds: this.geometryBuilds,
        attributeReuses: this.attributeReuses,
        atlasUploadRanges: this.atlasUploadRanges,
        atlasResolution: this.atlas?.cellSize ?? 0,
        atlasMipmaps: this.atlas?.mipmaps ? 1 : 0,
        ...this.atlasOptions.cardContent?.getMetrics?.(),
      },
    }
  }

  dispose(): void {
    this.generation += 1
    this.atlasAbortController?.abort()
    this.atlasAbortController = null
    this.imageCache.clear()
    this.disposeCurrent()
  }

  private replaceAtlas(atlas: TextureAtlasResult, itemCount: number): void {
    if (!this.mesh || !this.material) return
    this.atlas?.texture.dispose()
    this.atlas = atlas
    this.material.uniforms.atlas.value = atlas.texture
    copyAttribute(
      this.mesh.geometry.getAttribute('atlasRect') as InstancedBufferAttribute,
      atlas.rects,
    )
    this.itemCount = itemCount
    this.mesh.geometry.instanceCount = itemCount
  }

  private recordAtlasBuild(atlas: TextureAtlasResult): void {
    this.textureBytes = Math.ceil(
      atlas.width * atlas.height * 4 * (atlas.mipmaps ? 4 / 3 : 1),
    )
    this.atlasBuilds += 1
    this.atlasCellsUpdated += atlas.metrics.cells
    this.atlasBuildMs += atlas.metrics.renderMs
    this.atlasDrawMs += atlas.metrics.applyMs
    this.atlasPrepareMs += atlas.metrics.prepareMs
    this.atlasImageLoadWallMs += atlas.metrics.imageLoadWallMs
    this.atlasCellRenderMs += atlas.metrics.cellRenderMs
    this.atlasReadbackMs += atlas.metrics.readbackMs
    this.imageLoadMs += atlas.metrics.imageLoadMs
    this.imageRequests += atlas.metrics.imageRequests
    this.imageFailures += atlas.metrics.imageFailures
    this.estimatedTextureUploadBytes += atlas.metrics.uploadBytes
    this.atlasUploadRanges += atlas.metrics.uploadRanges ?? 0
  }

  private beginAtlasOperation(): {
    controller: AbortController
    generation: number
    options: TextureAtlasOptions<TMeta>
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
    this.root.remove(this.mesh)
    this.mesh.geometry.dispose()
    const texture = this.material?.uniforms.atlas?.value as { dispose?: () => void } | undefined
    texture?.dispose?.()
    this.material?.dispose()
    this.mesh = null
    this.instanceCapacity = 0
    this.itemCount = 0
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

function resolveAtlasResolution(
  value: number | 'auto' | undefined,
  itemCount: number,
  customContent: boolean,
): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 64
  if (value === undefined && customContent) return 64
  return itemCount > 1024 ? 48 : 64
}

function geometryByteLength(geometry: InstancedBufferGeometry | undefined): number {
  if (!geometry) return 0
  const attributes = Object.values(geometry.attributes)
    .reduce((total, attribute) => total + attribute.array.byteLength, 0)
  return attributes + (geometry.index?.array.byteLength ?? 0)
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

function createItemsFingerprint<TMeta>(
  items: readonly MotionItem<TMeta>[],
  options: TextureAtlasOptions<TMeta>,
): string {
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

function resolveBufferCapacity(current: number, required: number): number {
  if (required <= 0) return 0
  if (required <= current && required >= current / 2) return current
  return 2 ** Math.ceil(Math.log2(required))
}

function dynamicAttribute(array: Float32Array, itemSize: number): InstancedBufferAttribute {
  return new InstancedBufferAttribute(array, itemSize).setUsage(DynamicDrawUsage)
}

function copyAttribute(attribute: InstancedBufferAttribute, values: Float32Array): void {
  const target = attribute.array as Float32Array
  target.fill(0)
  target.set(values.subarray(0, target.length))
  markAttribute(attribute, Math.min(target.length, values.length))
}

function markAttribute(attribute: InstancedBufferAttribute, count: number): void {
  attribute.clearUpdateRanges()
  if (count > 0) attribute.addUpdateRange(0, count)
  attribute.needsUpdate = true
}
