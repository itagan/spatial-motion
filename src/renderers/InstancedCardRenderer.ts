import {
  Euler,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  Object3D,
  Quaternion,
  ShaderMaterial,
} from 'three'
import type { MotionItem } from '../core/types.js'
import type { TransformBufferView } from '../core/TransformBuffer.js'
import type { StreamingEffectGpuData } from '../effects/types.js'
import type {
  CardEffectProgram,
  CardMotionProgram,
  CardProgramUploadContext,
} from './cards/programs.js'
import {
  createItemFingerprint,
  createItemFingerprints,
  resolveAspectRatio,
  resolveAtlasResolution,
  type CardRendererOptions,
} from './cards/CardRendererConfig.js'
import {
  copyAttribute,
  createCardGeometry,
  dynamicAttribute,
  geometryByteLength,
  markAttribute,
  resolveBufferCapacity,
} from './cards/CardGeometry.js'
import type {
  ArrayAtlasUploadPolicy,
  CardAtlasMetrics,
} from './cards/CardAtlasMetrics.js'
import { CardMaterialRuntime } from './cards/CardMaterialRuntime.js'
import type { CardPatchWorkspacePool } from './cards/CardPatchWorkspacePool.js'
import type { CardAtlasBackend } from './cards/CardAtlasBackend.js'
import { LazyDefaultCardAtlasBackend } from './cards/LazyDefaultCardAtlasBackend.js'
import {
  ResourceScheduler,
} from '../runtime/ResourceScheduler.js'
import type { TextureAtlasResult } from './textureAtlas.js'
import type {
  MotionRenderer,
  MotionRendererCapabilities,
  MotionRendererDescriptor,
  MotionRendererStats,
  MotionRendererViewport,
  MotionRendererVisualState,
} from './MotionRenderer.js'

export type { CardRendererOptions } from './cards/CardRendererConfig.js'

const INITIAL_ARRAY_UPLOAD_BYTES = 3 * 1024 * 1024
const FRAME_ARRAY_UPLOAD_BYTES = 768 * 1024
const EMPTY_ATLAS_METRICS = {
  atlasBuilds: 0,
  atlasPatches: 0,
  atlasDiscardedBuilds: 0,
  atlasDiscardedPatches: 0,
  atlasCellsUpdated: 0,
  atlasBuildMs: 0,
  atlasPatchMs: 0,
  atlasDrawMs: 0,
  atlasPrepareMs: 0,
  atlasImageLoadWallMs: 0,
  atlasCellRenderMs: 0,
  atlasReadbackMs: 0,
  atlasArrayPackMs: 0,
  atlasWorkerRenderMs: 0,
  atlasWorkerRoundTripMs: 0,
  atlasWorkerRuntimeLoadMs: 0,
  atlasWorkerConstructMs: 0,
  atlasWorkerRequestPrepareMs: 0,
  atlasWorkerPrePostMs: 0,
  atlasWorkerRenders: 0,
  atlasLastBuildMs: 0,
  atlasLastPrepareMs: 0,
  atlasLastImageLoadWallMs: 0,
  atlasLastCellRenderMs: 0,
  atlasLastReadbackMs: 0,
  atlasLastArrayPackMs: 0,
  atlasLastWorkerRenderMs: 0,
  atlasLastWorkerRoundTripMs: 0,
  atlasLastWorkerRuntimeLoadMs: 0,
  atlasLastWorkerConstructMs: 0,
  atlasLastWorkerRequestPrepareMs: 0,
  atlasLastWorkerPrePostMs: 0,
  atlasImageBitmapDecodeMs: 0,
  atlasTexturePrewarms: 0,
  atlasTexturePrewarmMs: 0,
  atlasTexturePrewarmFailures: 0,
  atlasTexturePrewarmSkips: 0,
  imageLoadMs: 0,
  imageRequests: 0,
  imageFailures: 0,
  estimatedTextureUploadBytes: 0,
  atlasUploadRanges: 0,
  totalMainThreadRasterYields: 0,
  totalMainThreadRasterYieldMs: 0,
} as const

export class InstancedCardRenderer<TMeta = unknown> implements MotionRenderer<TMeta> {
  readonly capabilities: MotionRendererCapabilities<TMeta>
  readonly descriptor: MotionRendererDescriptor
  private mesh: Mesh<InstancedBufferGeometry, ShaderMaterial> | null = null
  private instanceCapacity = 0
  private itemCount = 0
  private readonly materialRuntime: CardMaterialRuntime<TMeta>
  private readonly resourceScheduler: ResourceScheduler
  private readonly atlasBackend: CardAtlasBackend<TMeta>
  private atlasBackendReady: Promise<void> | null = null
  private itemFingerprints: string[] = []
  private nextLayer = 0
  private skipUploadFrames = 0
  private layerUploadFrames = 0
  private totalLayerUploadFrames = 0
  private atlas: TextureAtlasResult | null = null
  private atlasMetrics: CardAtlasMetrics | undefined
  private arrayUploadPolicy: ArrayAtlasUploadPolicy | undefined
  private patchWorkspacePool: Promise<CardPatchWorkspacePool> | null = null
  private geometryBuilds = 0
  private attributeReuses = 0
  private readonly euler = new Euler()
  private readonly quaternion = new Quaternion()
  private disposed = false

  constructor(
    private readonly root: Object3D,
    private readonly atlasOptions: CardRendererOptions<TMeta> = {},
  ) {
    this.resourceScheduler = new ResourceScheduler()
    this.atlasBackend = atlasOptions.atlasBackend
      ?? new LazyDefaultCardAtlasBackend(atlasOptions)
    this.materialRuntime = new CardMaterialRuntime({
      scheduler: this.resourceScheduler,
      motionProgram: atlasOptions.motionProgram,
      effectPrograms: atlasOptions.effectPrograms,
      prepareProgram: atlasOptions.prepareProgram,
    })
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
      resourcePreparation: { prewarm: (request) => this.prewarm(request) },
      frame: {
        update: (deltaSeconds) => this.advanceAtlasUploads(deltaSeconds),
        needsUpdate: () => this.hasPendingAtlasUploads(),
      },
      streamingEffects: {
        enable: (data) => this.enableEffect(data),
        disable: () => this.disableEffect(),
        setTime: (elapsedSeconds) => this.setEffectTime(elapsedSeconds),
      },
    }
  }

  async setItems(items: readonly MotionItem<TMeta>[]): Promise<boolean> {
    await this.prepareAtlasBackend()
    if (this.disposed) return false
    const fingerprints = createItemFingerprints(items, this.atlasOptions)
    if (
      this.mesh
      && !this.resourceScheduler.isPending('cards-content')
      && matchesFingerprintPrefix(fingerprints, this.itemFingerprints)
    ) {
      if (items.length === this.itemCount) return true
      this.itemCount = items.length
      this.mesh.geometry.instanceCount = items.length
      this.materialRuntime.uploadMotion(items)
      return true
    }
    const result = await this.resourceScheduler.scheduleLatest('cards-content', {
      prepare: (signal) => this.atlasBackend.build(
        items,
        resolveAtlasResolution(
          this.atlasOptions.cellSize,
          items.length,
          Boolean(this.atlasOptions.cardContent || this.atlasOptions.drawCard),
        ),
        signal,
      ),
      commit: ({ atlas, configureMaterial }) =>
        this.commitAtlasBuild(items, fingerprints, atlas, configureMaterial),
      discard: ({ atlas }) => {
        this.atlasMetrics!.discardBuild()
        atlas.texture.dispose()
      },
    })
    return result.status === 'committed' && result.value
  }

  private commitAtlasBuild(
    items: readonly MotionItem<TMeta>[],
    fingerprints: string[],
    atlas: TextureAtlasResult,
    configureArrayMaterial: ((material: ShaderMaterial) => void) | undefined,
  ): boolean {
    if (this.disposed) return false
    const nextCapacity = resolveBufferCapacity(this.instanceCapacity, items.length)
    if (
      this.mesh
      && nextCapacity === this.instanceCapacity
      && atlas.mode === this.atlas?.mode
    ) {
      this.replaceAtlas(atlas, items.length)
      this.materialRuntime.uploadMotion(items)
      this.prewarmAtlas(atlas)
      this.itemFingerprints = fingerprints
      this.recordAtlasBuild(atlas)
      this.attributeReuses += 1
      return true
    }
    this.disposeCurrent()
    this.prepareAtlasUploads(atlas)
    this.prewarmAtlas(atlas)
    const aspectRatio = resolveAspectRatio(this.atlasOptions.aspectRatio)
    const geometry = createCardGeometry(
      nextCapacity,
      items.length,
      aspectRatio,
      atlas.rects,
    )
    this.instanceCapacity = nextCapacity
    this.ensureProgramAttributes(geometry, this.atlasOptions.motionProgram)
    const arrayAtlas = atlas.mode === 'array'
    const material = this.materialRuntime.createBaseMaterial(
      atlas.texture,
      arrayAtlas ? this.nextLayer : 1_000_000,
      configureArrayMaterial,
    )
    this.mesh = new Mesh(geometry, material)
    this.materialRuntime.bind({
      mesh: this.mesh,
      ensureAttributes: (program) => this.ensureProgramAttributes(geometry, program),
      createUploadContext: (program, targetMaterial) =>
        this.createUploadContext(program, targetMaterial),
    })
    this.itemCount = items.length
    this.geometryBuilds += 1
    this.mesh.frustumCulled = false
    this.root.add(this.mesh)
    this.itemFingerprints = fingerprints
    this.atlas = atlas
    this.materialRuntime.uploadMotion(items)
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
    const patchWorkspacePool = await this.preparePatchWorkspacePool()
    if (this.disposed) return false
    const workspace = patchWorkspacePool.acquire(changedIndices, items.length)
    const { indices, fingerprints } = workspace
    try {
      for (let offset = 0; offset < indices.length; offset += 1) {
        fingerprints.push(createItemFingerprint(items[indices[offset]], this.atlasOptions))
      }
      let contentChanged = false
      for (let offset = 0; offset < indices.length; offset += 1) {
        if (this.itemFingerprints[indices[offset]] !== fingerprints[offset]) {
          contentChanged = true
          break
        }
      }
      if (!contentChanged && !this.resourceScheduler.isPending('cards-content')) return true
      const baseAtlas = this.atlas
      await this.prepareAtlasBackend()
      if (this.disposed) return false
      const result = await this.resourceScheduler.scheduleLatest('cards-content', {
        prepare: (signal) => this.atlasBackend.patch(items, indices, baseAtlas, signal),
        commit: (patch) => {
          if (this.disposed || this.atlas !== baseAtlas) return false
          const applyMs = this.atlasBackend.applyPatch(
            baseAtlas,
            patch,
            baseAtlas.mode === 'array' ? this.nextLayer : undefined,
          )
          this.atlasMetrics!.recordPatch(patch.metrics, applyMs)
          for (let offset = 0; offset < indices.length; offset += 1) {
            this.itemFingerprints[indices[offset]] = fingerprints[offset]
          }
          this.materialRuntime.uploadMotion(items)
          return true
        },
        discard: () => this.atlasMetrics!.discardPatch(),
      })
      return result.status === 'committed' && result.value
    } finally {
      patchWorkspacePool.release(workspace)
    }
  }

  setTransforms(buffer: TransformBufferView): void {
    this.prepareTransition(buffer, buffer)
    this.setProgress(1)
  }

  prepareTransition(
    from: TransformBufferView,
    to: TransformBufferView,
  ): void {
    if (!this.mesh) return
    const count = Math.min(from.count, to.count, this.itemCount)
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
      this.writeBufferTransform(
        from,
        index,
        fromPosition.array as Float32Array,
        fromQuaternion.array as Float32Array,
        fromScale.array as Float32Array,
        fromOpacity.array as Float32Array,
      )
      this.writeBufferTransform(
        to,
        index,
        toPosition.array as Float32Array,
        toQuaternion.array as Float32Array,
        toScale.array as Float32Array,
        toOpacity.array as Float32Array,
      )
    }

    markAttributePair(fromPosition, toPosition, count * 3)
    markAttributePair(fromQuaternion, toQuaternion, count * 4)
    markAttributePair(fromScale, toScale, count)
    markAttributePair(fromOpacity, toOpacity, count)
    this.attributeReuses += 8
    geometry.instanceCount = count
    this.setProgress(0)
  }

  prepareVisualTransition(
    from: MotionRendererVisualState,
    to: MotionRendererVisualState,
  ): void {
    this.setCommonUniform('fromBillboard', from.billboard)
    this.setCommonUniform('toBillboard', to.billboard)
    this.setCommonUniform('fromHideBackHemisphere', from.hideBackHemisphere)
    this.setCommonUniform('toHideBackHemisphere', to.hideBackHemisphere)
    this.setCommonUniform('fromHemisphereEdgeFade', from.hemisphereEdgeFade)
    this.setCommonUniform('toHemisphereEdgeFade', to.hemisphereEdgeFade)
  }

  setProgress(progress: number): void {
    this.setCommonUniform('progress', progress)
  }

  setVisualState(state: MotionRendererVisualState): void {
    this.setCommonUniform('fromBillboard', state.billboard)
    this.setCommonUniform('toBillboard', state.billboard)
    this.setCommonUniform('fromHideBackHemisphere', state.hideBackHemisphere)
    this.setCommonUniform('toHideBackHemisphere', state.hideBackHemisphere)
    this.setCommonUniform('fromHemisphereEdgeFade', state.hemisphereEdgeFade)
    this.setCommonUniform('toHemisphereEdgeFade', state.hemisphereEdgeFade)
  }

  async enableEffect(data: StreamingEffectGpuData): Promise<boolean> {
    return this.materialRuntime.enableEffect(data, this.itemCount)
  }

  disableEffect(): void {
    this.materialRuntime.disableEffect(this.itemCount)
  }

  setEffectTime(elapsedSeconds: number): void {
    this.materialRuntime.setEffectTime(elapsedSeconds)
  }

  setVisibleRatio(ratio: number): void {
    const value = Math.min(1, Math.max(0.05, ratio))
    this.setCommonUniform('visibleRatio', value)
  }

  setHoverIndex(index: number | null): void {
    this.setCommonUniform('hoverIndex', index ?? -1)
  }

  resize(_viewport: MotionRendererViewport): void {}

  refreshResources(): void {
    if (this.atlas) {
      this.materialRuntime.markResourcesLost()
      this.atlas.initialized = false
      this.prepareAtlasUploads(this.atlas)
      this.setCommonUniform(
        'uLayers',
        this.atlas.mode === 'array' ? this.nextLayer : 1_000_000,
      )
      this.atlas.texture.needsUpdate = true
      this.atlasMetrics!.recordUpload(this.atlas.data.byteLength)
      this.prewarmAtlas(this.atlas)
    }
  }

  async prewarm(request: import('./MotionRenderer.js').MotionRendererPrewarmRequest): Promise<boolean> {
    if (!this.atlas) return false
    if (request.textures) this.prewarmAtlas(this.atlas, true)
    return await this.materialRuntime.prewarm(request.programs ?? []) && !this.disposed
  }

  getStats(): MotionRendererStats {
    const resourceStats = this.resourceScheduler.getStats()
    const textureBytes = this.atlasMetrics?.textureBytes ?? 0
    return {
      instanceCount: this.mesh ? this.itemCount : 0,
      submittedInstanceCount: this.mesh?.geometry.instanceCount ?? 0,
      gpuBytes: textureBytes + geometryByteLength(this.mesh?.geometry),
      metrics: {
        textureBytes,
        ...(this.atlasMetrics?.snapshot() ?? EMPTY_ATLAS_METRICS),
        atlasMode: this.atlas?.mode === 'array' ? 1 : 0,
        atlasLayers: this.atlas?.depth ?? 0,
        atlasCpuBytes: this.atlas?.data.byteLength ?? 0,
        atlasGpuBytes: textureBytes,
        atlasBuildPixelBufferPeakBytes:
          this.atlas?.metrics.pixelBufferPeakBytes ?? this.atlas?.data.byteLength ?? 0,
        mainThreadRasterYields: this.atlas?.metrics.mainThreadRasterYields ?? 0,
        mainThreadRasterYieldMs: this.atlas?.metrics.mainThreadRasterYieldMs ?? 0,
        uploadedLayers: this.atlas?.mode === 'array' ? this.nextLayer : 0,
        pendingLayers: this.atlas?.mode === 'array'
          ? Math.max(0, this.atlas.depth - this.nextLayer)
          : 0,
        layerUploadFrames: this.layerUploadFrames,
        totalLayerUploadFrames: this.totalLayerUploadFrames,
        ...this.arrayUploadPolicy?.snapshot(),
        capacity: this.mesh ? this.instanceCapacity : 0,
        geometryBuilds: this.geometryBuilds,
        attributeReuses: this.attributeReuses,
        ...this.materialRuntime.getStats(),
        resourceTasks: resourceStats.scheduled,
        resourceCommits: resourceStats.committed,
        resourceSuperseded: resourceStats.superseded,
        resourceFailures: resourceStats.failures,
        resourcePrepareMs: resourceStats.prepareMs,
        atlasResolution: this.atlas?.cellSize ?? 0,
        atlasMipmaps: this.atlas?.mipmaps ? 1 : 0,
        ...this.atlasOptions.cardContent?.getMetrics?.(),
      },
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.resourceScheduler.dispose()
    this.atlasBackend.dispose()
    this.disposeCurrent()
    this.materialRuntime.dispose()
  }

  private replaceAtlas(atlas: TextureAtlasResult, itemCount: number): void {
    if (!this.mesh) return
    this.atlas?.texture.dispose()
    this.atlas = atlas
    this.prepareAtlasUploads(atlas)
    this.materialRuntime.replaceAtlas(
      atlas.texture,
      atlas.mode === 'array' ? this.nextLayer : 1_000_000,
    )
    copyAttribute(
      this.mesh.geometry.getAttribute('atlasRect') as InstancedBufferAttribute,
      atlas.rects,
    )
    this.itemCount = itemCount
    this.mesh.geometry.instanceCount = itemCount
  }

  private recordAtlasBuild(atlas: TextureAtlasResult): void {
    this.atlasMetrics!.recordBuild(atlas)
  }

  private prewarmAtlas(atlas: TextureAtlasResult, force = false): void {
    const shouldPrewarm = force || this.atlasOptions.texturePrewarm === true
      || (
        this.atlasOptions.texturePrewarm !== false
        && atlas.data.byteLength <= 16 * 1024 * 1024
      )
    if (!shouldPrewarm || !this.atlasOptions.prepareTexture) {
      this.atlasMetrics!.recordPrewarmSkipped()
      return
    }
    try {
      this.atlasMetrics!.recordPrewarm(this.atlasOptions.prepareTexture(atlas.texture))
    } catch {
      this.atlasMetrics!.recordPrewarmFailure()
    }
  }

  private prepareAtlasUploads(atlas: TextureAtlasResult): void {
    this.nextLayer = 0
    this.skipUploadFrames = 0
    this.layerUploadFrames = 0
    this.atlasBackend.clearPatchQueue(atlas)
    if (atlas.mode !== 'array' || !('layerUpdates' in atlas.texture)) return
    atlas.texture.layerUpdates.clear()
    this.arrayUploadPolicy!.reset()
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

  private advanceAtlasUploads(deltaSeconds: number): void {
    const atlas = this.atlas
    if (
      !atlas
      || atlas.mode !== 'array'
      || !('layerUpdates' in atlas.texture)
      || this.nextLayer >= atlas.depth
    ) return
    const uploadBudget = this.arrayUploadPolicy!.nextBudget(
      deltaSeconds,
      FRAME_ARRAY_UPLOAD_BYTES,
    )
    if (this.skipUploadFrames > 0) {
      this.skipUploadFrames -= 1
      return
    }
    const [end, uploaded] = this.atlasBackend.advanceUploads(
      atlas,
      this.nextLayer,
      this.layersPerUpload(atlas, uploadBudget),
    )
    this.nextLayer = end
    this.setCommonUniform('uLayers', end)
    if (uploaded) {
      this.layerUploadFrames += 1
      this.totalLayerUploadFrames += 1
    }
  }

  private hasPendingAtlasUploads(): boolean {
    return Boolean(
      this.atlas
      && this.atlas.mode === 'array'
      && this.nextLayer < this.atlas.depth,
    )
  }

  private layersPerUpload(atlas: TextureAtlasResult, byteBudget: number): number {
    return Math.max(1, Math.floor(byteBudget / (atlas.width * atlas.height * 4)))
  }

  private disposeCurrent(): void {
    if (!this.mesh) return
    this.root.remove(this.mesh)
    this.mesh.geometry.dispose()
    this.atlas?.texture.dispose()
    this.materialRuntime.disposeCurrent()
    this.mesh = null
    this.instanceCapacity = 0
    this.itemCount = 0
    this.itemFingerprints = []
    this.nextLayer = 0
    this.skipUploadFrames = 0
    this.layerUploadFrames = 0
    this.atlasMetrics!.resetTexture()
    this.atlas = null
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

  private setCommonUniform(name: string, value: unknown): void {
    this.materialRuntime.setCommonUniform(name, value)
  }

  private prepareAtlasBackend(): Promise<void> {
    this.atlasBackendReady ??= Promise.all([
      this.atlasBackend.prepare(),
      import('./cards/CardAtlasMetrics.js'),
    ]).then(([, { ArrayAtlasUploadPolicy, CardAtlasMetrics }]) => {
      this.atlasMetrics ??= new CardAtlasMetrics()
      this.arrayUploadPolicy ??= new ArrayAtlasUploadPolicy()
    }).catch((error) => {
      this.atlasBackendReady = null
      throw error
    })
    return this.atlasBackendReady
  }

  private preparePatchWorkspacePool(): Promise<CardPatchWorkspacePool> {
    return this.patchWorkspacePool ??= import('./cards/CardPatchWorkspacePool.js')
      .then(({ CardPatchWorkspacePool }) => new CardPatchWorkspacePool())
  }

  private writeBufferTransform(
    buffer: TransformBufferView,
    index: number,
    positions: Float32Array,
    quaternions: Float32Array,
    scales: Float32Array,
    opacities: Float32Array,
  ): void {
    const positionOffset = index * 3
    positions[positionOffset] = buffer.positions[positionOffset]
    positions[positionOffset + 1] = buffer.positions[positionOffset + 1]
    positions[positionOffset + 2] = buffer.positions[positionOffset + 2]
    this.euler.set(
      buffer.rotations[positionOffset],
      buffer.rotations[positionOffset + 1],
      buffer.rotations[positionOffset + 2],
      'XYZ',
    )
    this.quaternion.setFromEuler(this.euler)
    const quaternionOffset = index * 4
    quaternions[quaternionOffset] = this.quaternion.x
    quaternions[quaternionOffset + 1] = this.quaternion.y
    quaternions[quaternionOffset + 2] = this.quaternion.z
    quaternions[quaternionOffset + 3] = this.quaternion.w
    scales[index] = buffer.scales[index]
    opacities[index] = buffer.opacities[index]
  }
}

function matchesFingerprintPrefix(
  candidate: readonly string[],
  retained: readonly string[],
): boolean {
  return candidate.length > 0
    && candidate.length <= retained.length
    && candidate.every((value, index) => value === retained[index])
}

function markAttributePair(
  from: InstancedBufferAttribute,
  to: InstancedBufferAttribute,
  count: number,
): void {
  markAttribute(from, count)
  markAttribute(to, count)
}
