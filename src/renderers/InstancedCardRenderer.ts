import {
  DynamicDrawUsage,
  Euler,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  Object3D,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
} from 'three'
import type { Texture } from 'three'
import type { MotionItem, Transform } from '../core/types.js'
import type { StreamingEffectGpuData } from '../effects/types.js'
import { createCardProgramMaterial } from './CardProgramMaterial.js'
import type {
  CardEffectProgram,
  CardEffectProgramLoader,
  CardMotionProgram,
  CardProgramUploadContext,
} from './cards/programs.js'
import type {
  TextureAtlasImageCache,
  TextureAtlasOptions,
  TextureAtlasPatch,
  TextureAtlasResult,
} from './textureAtlas.js'
import type {
  MotionRenderer,
  MotionRendererCapabilities,
  MotionRendererDescriptor,
  MotionRendererFactoryContext,
  MotionRendererStats,
  MotionRendererViewport,
  MotionRendererVisualState,
} from './MotionRenderer.js'

export interface CardRendererOptions<TMeta = unknown> extends TextureAtlasOptions<TMeta> {
  cellSize?: number | 'auto'
  prepareTexture?: (texture: Texture) => number
  texturePrewarm?: boolean
  prepareProgram?: MotionRendererFactoryContext['prepareProgram']
  motionProgram?: CardMotionProgram<TMeta>
  effectPrograms?: Readonly<Record<string, CardEffectProgramLoader>>
}

interface CardProgramRuntime {
  program: CardEffectProgram
  material: ShaderMaterial
}

const INITIAL_ARRAY_UPLOAD_BYTES = 3 * 1024 * 1024
const FRAME_ARRAY_UPLOAD_BYTES = 768 * 1024

export class InstancedCardRenderer<TMeta = unknown> implements MotionRenderer<TMeta> {
  readonly capabilities: MotionRendererCapabilities<TMeta>
  readonly descriptor: MotionRendererDescriptor
  private mesh: Mesh<InstancedBufferGeometry, ShaderMaterial> | null = null
  private instanceCapacity = 0
  private itemCount = 0
  private material: ShaderMaterial | null = null
  private baseMaterial: ShaderMaterial | null = null
  private readonly programRuntimes = new Map<string, CardProgramRuntime>()
  private readonly programLoads = new Map<string, Promise<CardEffectProgram | null>>()
  private effectGeneration = 0
  private activeProgram: CardProgramRuntime | null = null
  private configureArrayMaterial: ((material: ShaderMaterial) => void) | undefined
  private programLoadCount = 0
  private programLoadMs = 0
  private programPrepareMs = 0
  private programSwitches = 0
  private programFailures = 0
  private generation = 0
  private itemFingerprints: string[] = []
  private fingerprintFullScans = 0
  private fingerprintPatchScans = 0
  private fingerprintItemsScanned = 0
  private nextLayer = 0
  private skipUploadFrames = 0
  private layerUploadFrames = 0
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
  private atlasWorkerRenders = 0
  private atlasImageBitmapDecodeMs = 0
  private atlasTexturePrewarms = 0
  private atlasTexturePrewarmMs = 0
  private atlasTexturePrewarmFailures = 0
  private atlasTexturePrewarmSkips = 0
  private imageLoadMs = 0
  private imageRequests = 0
  private imageFailures = 0
  private estimatedTextureUploadBytes = 0
  private geometryBuilds = 0
  private attributeReuses = 0
  private atlasUploadRanges = 0
  private readonly euler = new Euler()
  private readonly quaternion = new Quaternion()
  private imageCache: TextureAtlasImageCache | null = null
  private atlasApi: typeof import('./textureAtlas.js') | null = null
  private atlasApiPromise: Promise<typeof import('./textureAtlas.js')> | null = null
  private atlasAbortController: AbortController | null = null
  private disposed = false

  constructor(
    private readonly root: Object3D,
    private readonly atlasOptions: CardRendererOptions<TMeta> = {},
  ) {
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
      frame: { update: () => this.advanceAtlasUploads() },
      streamingEffects: {
        enable: (data) => this.enableEffect(data),
        disable: () => this.disableEffect(),
        setTime: (elapsedSeconds) => this.setEffectTime(elapsedSeconds),
      },
    }
  }

  async setItems(items: readonly MotionItem<TMeta>[]): Promise<boolean> {
    const atlasApi = await this.loadAtlasApi()
    if (this.disposed) return false
    const fingerprints = createItemFingerprints(items, this.atlasOptions)
    this.fingerprintFullScans += 1
    this.fingerprintItemsScanned += items.length
    if (
      this.mesh
      && equalFingerprints(fingerprints, this.itemFingerprints)
      && !this.atlasAbortController
    ) return true
    const { controller, generation, options } = this.beginAtlasOperation(atlasApi)
    let atlas: TextureAtlasResult
    try {
      atlas = await atlasApi.createTextureAtlas(
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
    if (
      this.mesh
      && this.material
      && nextCapacity === this.instanceCapacity
      && atlas.mode === this.atlas?.mode
    ) {
      this.replaceAtlas(atlas, items.length)
      this.uploadMotionProgram(items)
      this.prewarmAtlas(atlas)
      this.itemFingerprints = fingerprints
      this.recordAtlasBuild(atlas)
      this.attributeReuses += 1
      return true
    }
    let configureArrayMaterial: ((material: ShaderMaterial) => void) | undefined
    try {
      if (atlas.mode === 'array') {
        configureArrayMaterial = (await import('./ArrayCardShader.js')).configureArrayCardMaterial
      }
    } catch (error) {
      atlas.texture.dispose()
      if (generation !== this.generation) return false
      throw error
    }
    if (generation !== this.generation) {
      this.atlasDiscardedBuilds += 1
      atlas.texture.dispose()
      return false
    }
    this.disposeCurrent()
    this.prepareAtlasUploads(atlas)
    this.prewarmAtlas(atlas)
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
    this.instanceCapacity = nextCapacity
    this.ensureProgramAttributes(geometry, this.atlasOptions.motionProgram)
    const arrayAtlas = atlas.mode === 'array'
    this.baseMaterial = createCardProgramMaterial(
      atlas.texture,
      arrayAtlas ? this.nextLayer : 1_000_000,
      this.atlasOptions.motionProgram,
    )
    this.configureArrayMaterial = configureArrayMaterial
    configureArrayMaterial?.(this.baseMaterial)
    this.material = this.baseMaterial
    this.mesh = new Mesh(geometry, this.material)
    this.itemCount = items.length
    this.geometryBuilds += 1
    this.mesh.frustumCulled = false
    this.root.add(this.mesh)
    this.itemFingerprints = fingerprints
    this.atlas = atlas
    this.uploadMotionProgram(items)
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
    const indices = normalizeChangedIndices(changedIndices, items.length)
    const fingerprints = indices.map((index) => ({
      index,
      value: createItemFingerprint(items[index], this.atlasOptions),
    }))
    this.fingerprintPatchScans += 1
    this.fingerprintItemsScanned += fingerprints.length
    if (
      fingerprints.every(({ index, value }) => this.itemFingerprints[index] === value)
      && !this.atlasAbortController
    ) return true
    const atlasApi = await this.loadAtlasApi()
    if (this.disposed) return false
    const { controller, generation, options } = this.beginAtlasOperation(atlasApi)
    let patch: TextureAtlasPatch
    try {
      patch = await atlasApi.createTextureAtlasPatch(items, indices, this.atlas.cellSize, options)
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
    const atlas = this.atlas
    const metrics = patch.metrics
    const arrayAtlas = atlas.mode === 'array'
    const applyMs = atlasApi.applyTextureAtlasPatch(
      atlas,
      patch,
      arrayAtlas ? this.nextLayer : undefined,
    )
    this.atlasPatches += 1
    this.atlasCellsUpdated += metrics.cells
    this.atlasPatchMs += metrics.renderMs + applyMs
    this.atlasDrawMs += applyMs
    this.atlasPrepareMs += metrics.prepareMs
    this.atlasImageLoadWallMs += metrics.imageLoadWallMs
    this.atlasCellRenderMs += metrics.cellRenderMs
    this.imageLoadMs += metrics.imageLoadMs
    this.imageRequests += metrics.imageRequests
    this.imageFailures += metrics.imageFailures
    this.estimatedTextureUploadBytes += metrics.uploadBytes
    this.atlasUploadRanges += metrics.uploadRanges ?? 0
    fingerprints.forEach(({ index, value }) => {
      this.itemFingerprints[index] = value
    })
    this.uploadMotionProgram(items)
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
    this.forEachMaterial(({ uniforms }) => {
      uniforms.fromBillboard!.value = from.billboard
      uniforms.toBillboard!.value = to.billboard
      uniforms.fromHideBackHemisphere!.value = from.hideBackHemisphere
      uniforms.toHideBackHemisphere!.value = to.hideBackHemisphere
      uniforms.fromHemisphereEdgeFade!.value = from.hemisphereEdgeFade
      uniforms.toHemisphereEdgeFade!.value = to.hemisphereEdgeFade
    })
  }

  setProgress(progress: number): void {
    this.forEachMaterial(({ uniforms }) => {
      uniforms.progress!.value = progress
    })
  }

  setVisualState(state: MotionRendererVisualState): void {
    this.forEachMaterial(({ uniforms }) => {
      uniforms.fromBillboard!.value = state.billboard
      uniforms.toBillboard!.value = state.billboard
      uniforms.fromHideBackHemisphere!.value = state.hideBackHemisphere
      uniforms.toHideBackHemisphere!.value = state.hideBackHemisphere
      uniforms.fromHemisphereEdgeFade!.value = state.hemisphereEdgeFade
      uniforms.toHemisphereEdgeFade!.value = state.hemisphereEdgeFade
    })
  }

  async enableEffect(data: StreamingEffectGpuData): Promise<boolean> {
    if (!this.mesh || !this.baseMaterial) return false
    const generation = ++this.effectGeneration
    let temporaryRuntime: CardProgramRuntime | null = null
    let createdRuntimeKind: string | null = null
    try {
      const program = await this.loadEffectProgram(data.kind)
      if (!program || generation !== this.effectGeneration || !this.mesh) return false
      let runtime = this.programRuntimes.get(program.kind)
      if (!runtime) {
        const preparedAt = performance.now()
        this.ensureProgramAttributes(this.mesh.geometry, program)
        const material = createCardProgramMaterial(
          this.atlas!.texture,
          this.atlas?.mode === 'array' ? this.nextLayer : 1_000_000,
          program,
        )
        this.configureArrayMaterial?.(material)
        temporaryRuntime = { program, material }
        try {
          if (this.atlasOptions.prepareProgram) {
            await this.atlasOptions.prepareProgram(material, this.mesh.geometry)
          }
        } catch (error) {
          material.dispose()
          temporaryRuntime = null
          throw error
        }
        if (generation !== this.effectGeneration) {
          material.dispose()
          temporaryRuntime = null
          return false
        }
        runtime = temporaryRuntime
        this.programRuntimes.set(program.kind, runtime)
        createdRuntimeKind = program.kind
        temporaryRuntime = null
        this.programPrepareMs += performance.now() - preparedAt
      }
      if (generation !== this.effectGeneration) return false
      this.syncCommonUniforms(runtime.material)
      program.upload(this.createUploadContext(program, runtime.material), data.payload)
      if (generation !== this.effectGeneration) return false
      this.activeProgram = runtime
      this.material = runtime.material
      this.mesh.material = runtime.material
      this.mesh.geometry.instanceCount = Math.min(this.itemCount, data.activeCount)
      this.programSwitches += 1
      return true
    } catch (error) {
      if (temporaryRuntime) temporaryRuntime.material.dispose()
      if (createdRuntimeKind) {
        this.programRuntimes.get(createdRuntimeKind)?.material.dispose()
        this.programRuntimes.delete(createdRuntimeKind)
      }
      this.programFailures += 1
      if (generation === this.effectGeneration) this.disableEffect()
      throw error
    }
  }

  disableEffect(): void {
    this.effectGeneration += 1
    this.activeProgram = null
    if (this.mesh && this.baseMaterial) {
      this.material = this.baseMaterial
      this.mesh.material = this.baseMaterial
      this.mesh.geometry.instanceCount = this.itemCount
    }
  }

  setEffectTime(elapsedSeconds: number): void {
    const runtime = this.activeProgram
    if (!runtime) return
    const time = runtime.program.uniforms?.find(({ name }) => name.endsWith('_time'))
    if (time) runtime.material.uniforms[time.name]!.value = elapsedSeconds
  }

  setVisibleRatio(ratio: number): void {
    const value = Math.min(1, Math.max(0.05, ratio))
    this.forEachMaterial(({ uniforms }) => {
      uniforms.visibleRatio!.value = value
    })
  }

  setHoverIndex(index: number | null): void {
    this.forEachMaterial(({ uniforms }) => {
      uniforms.hoverIndex!.value = index ?? -1
    })
  }

  resize(_viewport: MotionRendererViewport): void {}

  refreshResources(): void {
    if (this.atlas) {
      this.atlas.initialized = false
      this.prepareAtlasUploads(this.atlas)
      this.forEachMaterial(({ uniforms }) => {
        uniforms.uLayers!.value = this.atlas!.mode === 'array' ? this.nextLayer : 1_000_000
      })
      this.atlas.texture.needsUpdate = true
      this.estimatedTextureUploadBytes += this.atlas.data.byteLength
      this.prewarmAtlas(this.atlas)
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
        atlasWorkerRenders: this.atlasWorkerRenders,
        atlasImageBitmapDecodeMs: this.atlasImageBitmapDecodeMs,
        atlasTexturePrewarms: this.atlasTexturePrewarms,
        atlasTexturePrewarmMs: this.atlasTexturePrewarmMs,
        atlasTexturePrewarmFailures: this.atlasTexturePrewarmFailures,
        atlasTexturePrewarmSkips: this.atlasTexturePrewarmSkips,
        atlasMode: this.atlas?.mode === 'array' ? 1 : 0,
        atlasLayers: this.atlas?.depth ?? 0,
        uploadedLayers: this.atlas?.mode === 'array' ? this.nextLayer : 0,
        pendingLayers: this.atlas?.mode === 'array'
          ? Math.max(0, this.atlas.depth - this.nextLayer)
          : 0,
        layerUploadFrames: this.layerUploadFrames,
        fingerprintFullScans: this.fingerprintFullScans,
        fingerprintPatchScans: this.fingerprintPatchScans,
        fingerprintItemsScanned: this.fingerprintItemsScanned,
        imageLoadMs: this.imageLoadMs,
        imageRequests: this.imageRequests,
        imageFailures: this.imageFailures,
        estimatedTextureUploadBytes: this.estimatedTextureUploadBytes,
        capacity: this.mesh ? this.instanceCapacity : 0,
        geometryBuilds: this.geometryBuilds,
        attributeReuses: this.attributeReuses,
        programLoads: this.programLoadCount,
        programLoadMs: this.programLoadMs,
        programPrepareMs: this.programPrepareMs,
        programSwitches: this.programSwitches,
        programFailures: this.programFailures,
        cachedPrograms: this.programRuntimes.size,
        atlasUploadRanges: this.atlasUploadRanges,
        atlasResolution: this.atlas?.cellSize ?? 0,
        atlasMipmaps: this.atlas?.mipmaps ? 1 : 0,
        ...this.atlasOptions.cardContent?.getMetrics?.(),
      },
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.generation += 1
    this.effectGeneration += 1
    this.atlasAbortController?.abort()
    this.atlasAbortController = null
    this.imageCache?.clear()
    this.disposeCurrent()
  }

  private replaceAtlas(atlas: TextureAtlasResult, itemCount: number): void {
    if (!this.mesh || !this.material) return
    this.atlas?.texture.dispose()
    this.atlas = atlas
    this.forEachMaterial(({ uniforms }) => {
      uniforms.atlas!.value = atlas.texture
    })
    this.prepareAtlasUploads(atlas)
    this.forEachMaterial(({ uniforms }) => {
      uniforms.uLayers!.value = atlas.mode === 'array' ? this.nextLayer : 1_000_000
    })
    copyAttribute(
      this.mesh.geometry.getAttribute('atlasRect') as InstancedBufferAttribute,
      atlas.rects,
    )
    this.itemCount = itemCount
    this.mesh.geometry.instanceCount = itemCount
  }

  private recordAtlasBuild(atlas: TextureAtlasResult): void {
    this.textureBytes = Math.ceil(
      atlas.width * atlas.height * atlas.depth * 4 * (atlas.mipmaps ? 4 / 3 : 1),
    )
    this.atlasBuilds += 1
    this.atlasCellsUpdated += atlas.metrics.cells
    this.atlasBuildMs += atlas.metrics.renderMs
    this.atlasDrawMs += atlas.metrics.applyMs
    this.atlasPrepareMs += atlas.metrics.prepareMs
    this.atlasImageLoadWallMs += atlas.metrics.imageLoadWallMs
    this.atlasCellRenderMs += atlas.metrics.cellRenderMs
    this.atlasReadbackMs += atlas.metrics.readbackMs
    this.atlasWorkerRenders += atlas.metrics.workerRenders ?? 0
    this.atlasImageBitmapDecodeMs += atlas.metrics.imageBitmapDecodeMs ?? 0
    this.imageLoadMs += atlas.metrics.imageLoadMs
    this.imageRequests += atlas.metrics.imageRequests
    this.imageFailures += atlas.metrics.imageFailures
    this.estimatedTextureUploadBytes += atlas.metrics.uploadBytes
    this.atlasUploadRanges += atlas.metrics.uploadRanges ?? 0
  }

  private prewarmAtlas(atlas: TextureAtlasResult): void {
    const shouldPrewarm = this.atlasOptions.texturePrewarm === true
      || (
        this.atlasOptions.texturePrewarm !== false
        && atlas.data.byteLength <= 16 * 1024 * 1024
      )
    if (!shouldPrewarm || !this.atlasOptions.prepareTexture) {
      this.atlasTexturePrewarmSkips += 1
      return
    }
    try {
      this.atlasTexturePrewarmMs += Math.max(
        0,
        this.atlasOptions.prepareTexture(atlas.texture),
      )
      this.atlasTexturePrewarms += 1
    } catch {
      this.atlasTexturePrewarmFailures += 1
    }
  }

  private prepareAtlasUploads(atlas: TextureAtlasResult): void {
    this.nextLayer = 0
    this.skipUploadFrames = 0
    this.atlasApi?.clearTextureAtlasPatchQueue(atlas)
    if (atlas.mode !== 'array' || !('layerUpdates' in atlas.texture)) return
    atlas.texture.layerUpdates.clear()
    const initialLayers = Math.min(
      atlas.depth,
      this.layersPerUpload(atlas, INITIAL_ARRAY_UPLOAD_BYTES),
    )
    for (let layer = 0; layer < initialLayers; layer += 1) {
      atlas.texture.addLayerUpdate(layer)
    }
    this.nextLayer = initialLayers
    this.skipUploadFrames = 1
  }

  private advanceAtlasUploads(): void {
    const atlas = this.atlas
    if (
      !atlas
      || atlas.mode !== 'array'
      || !this.material
      || !('layerUpdates' in atlas.texture)
    ) return
    if (this.skipUploadFrames > 0) {
      this.skipUploadFrames -= 1
      return
    }
    const [end, uploaded] = this.atlasApi!.advanceTextureAtlasUploads(
      atlas,
      this.nextLayer,
      this.layersPerUpload(atlas, FRAME_ARRAY_UPLOAD_BYTES),
    )
    this.nextLayer = end
    this.forEachMaterial(({ uniforms }) => {
      uniforms.uLayers!.value = end
    })
    if (uploaded) this.layerUploadFrames += 1
  }

  private layersPerUpload(atlas: TextureAtlasResult, byteBudget: number): number {
    return Math.max(1, Math.floor(byteBudget / (atlas.width * atlas.height * 4)))
  }

  private beginAtlasOperation(atlasApi: typeof import('./textureAtlas.js')): {
    controller: AbortController
    generation: number
    options: TextureAtlasOptions<TMeta>
  } {
    this.atlasAbortController?.abort()
    this.imageCache ??= new atlasApi.TextureAtlasImageCache(
      normalizeImageCacheSize(this.atlasOptions.imageCacheSize),
    )
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

  private async loadAtlasApi(): Promise<typeof import('./textureAtlas.js')> {
    if (this.atlasApi) return this.atlasApi
    this.atlasApiPromise ??= import('./textureAtlas.js')
    this.atlasApi = await this.atlasApiPromise
    return this.atlasApi
  }

  private disposeCurrent(): void {
    if (!this.mesh) return
    this.effectGeneration += 1
    this.root.remove(this.mesh)
    this.mesh.geometry.dispose()
    const texture = this.material?.uniforms.atlas?.value as { dispose?: () => void } | undefined
    texture?.dispose?.()
    this.baseMaterial?.dispose()
    this.programRuntimes.forEach(({ material }) => material.dispose())
    this.programRuntimes.clear()
    this.mesh = null
    this.instanceCapacity = 0
    this.itemCount = 0
    this.material = null
    this.baseMaterial = null
    this.activeProgram = null
    this.itemFingerprints = []
    this.textureBytes = 0
    this.atlas = null
  }

  private async loadEffectProgram(kind: string): Promise<CardEffectProgram | null> {
    const cached = this.programLoads.get(kind)
    if (cached) return cached
    const configured = this.atlasOptions.effectPrograms?.[kind]
    const builtin = isBuiltinEffect(kind)
    if (!configured && !builtin) return null
    this.programLoadCount += 1
    const startedAt = performance.now()
    const loading = Promise.resolve().then(async () => {
      const program = configured
        ? typeof configured === 'function' ? await configured() : configured
        : (await import('./cards/builtinEffectPrograms.js')).builtinEffectPrograms[kind]
      if (!program) return null
      if (program.kind !== kind) {
        throw new TypeError(`Cards effect program "${kind}" loaded mismatched kind "${program.kind}"`)
      }
      return program
    }).finally(() => {
      this.programLoadMs += performance.now() - startedAt
    })
    this.programLoads.set(kind, loading)
    return loading
  }

  private createUploadContext(
    program: CardEffectProgram | CardMotionProgram<TMeta>,
    material: ShaderMaterial,
  ): CardProgramUploadContext {
    const geometry = this.mesh!.geometry
    const attributes = new Map((program.attributes ?? []).map((field) => [field.name, field]))
    const uniforms = new Set((program.uniforms ?? []).map(({ name }) => name))
    return {
      capacity: this.instanceCapacity,
      itemCount: this.itemCount,
      setAttribute: (name, values) => {
        const field = attributes.get(name)
        if (!field) throw new TypeError(`Effect program cannot upload undeclared attribute "${name}"`)
        let attribute = geometry.getAttribute(name) as InstancedBufferAttribute | undefined
        if (!attribute) {
          const array = new Float32Array(this.instanceCapacity * field.itemSize)
          array.fill(field.initialValue ?? 0)
          attribute = dynamicAttribute(array, field.itemSize)
          geometry.setAttribute(name, attribute)
        }
        const target = attribute.array as Float32Array
        target.fill(field.initialValue ?? 0)
        target.set(values.subarray(0, target.length))
        markAttribute(attribute, Math.min(target.length, values.length))
        this.attributeReuses += 1
      },
      setUniform: (name, value) => {
        if (!uniforms.has(name)) {
          throw new TypeError(`Effect program cannot upload undeclared uniform "${name}"`)
        }
        const target = material.uniforms[name]?.value as
          | number
          | { fromArray(values: ArrayLike<number>): void }
          | undefined
        if (typeof target === 'number') {
          if (typeof value !== 'number') throw new TypeError(`Uniform "${name}" requires a number`)
          material.uniforms[name]!.value = value
        } else if (target && typeof target.fromArray === 'function' && typeof value !== 'number') {
          target.fromArray(value)
        } else {
          throw new TypeError(`Invalid uniform upload for "${name}"`)
        }
      },
    }
  }

  private ensureProgramAttributes(
    geometry: InstancedBufferGeometry,
    program: CardEffectProgram | CardMotionProgram<TMeta> | undefined,
  ): void {
    for (const field of program?.attributes ?? []) {
      if (geometry.getAttribute(field.name)) continue
      const values = new Float32Array(this.instanceCapacity * field.itemSize)
      values.fill(field.initialValue ?? 0)
      geometry.setAttribute(field.name, dynamicAttribute(values, field.itemSize))
    }
  }

  private uploadMotionProgram(items: readonly MotionItem<TMeta>[]): void {
    const program = this.atlasOptions.motionProgram
    if (!program?.upload || !this.mesh || !this.baseMaterial) return
    program.upload(this.createUploadContext(program, this.baseMaterial), items)
  }

  private syncCommonUniforms(target: ShaderMaterial): void {
    if (!this.baseMaterial) return
    for (const name of [
      'atlas',
      'progress',
      'fromBillboard',
      'toBillboard',
      'fromHideBackHemisphere',
      'toHideBackHemisphere',
      'fromHemisphereEdgeFade',
      'toHemisphereEdgeFade',
      'visibleRatio',
      'hoverIndex',
      'uLayers',
    ]) {
      target.uniforms[name]!.value = this.baseMaterial.uniforms[name]!.value
    }
  }

  private forEachMaterial(callback: (material: ShaderMaterial) => void): void {
    if (this.baseMaterial) callback(this.baseMaterial)
    this.programRuntimes.forEach(({ material }) => callback(material))
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

function isBuiltinEffect(kind: string): boolean {
  return kind === 'tunnel'
    || kind === 'linear-shooter'
    || kind === 'vortex'
    || kind === 'radial-burst'
}

function createItemFingerprints<TMeta>(
  items: readonly MotionItem<TMeta>[],
  options: TextureAtlasOptions<TMeta>,
): string[] {
  return items.map((item) => createItemFingerprint(item, options))
}

function createItemFingerprint<TMeta>(
  item: MotionItem<TMeta>,
  options: TextureAtlasOptions<TMeta>,
): string {
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
}

function equalFingerprints(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index])
}

function normalizeChangedIndices(indices: readonly number[], itemCount: number): number[] {
  return [...new Set(indices)]
    .filter((index) => Number.isInteger(index) && index >= 0 && index < itemCount)
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
