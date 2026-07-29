import {
  Euler,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  Object3D,
  Quaternion,
  ShaderMaterial,
} from 'three'
import type { Texture } from 'three'
import type { MotionItem, Transform } from '../core/types.js'
import type { StreamingEffectGpuData } from '../effects/types.js'
import type {
  CardEffectProgram,
  CardMotionProgram,
  CardProgramUploadContext,
} from './cards/programs.js'
import type { CardEffectProgramLoader } from './cards/programs.js'
import {
  copyAttribute,
  createCardGeometry,
  dynamicAttribute,
  geometryByteLength,
  markAttribute,
  resolveBufferCapacity,
} from './cards/CardGeometry.js'
import { CardAtlasMetrics } from './cards/CardAtlasMetrics.js'
import { CardMaterialRuntime } from './cards/CardMaterialRuntime.js'
import {
  type CardAtlasBackend,
  type PreparedCardAtlas,
} from './cards/CardAtlasBackend.js'
import {
  ResourceScheduler,
} from '../runtime/ResourceScheduler.js'
import type {
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
  atlasBackend?: CardAtlasBackend<TMeta>
}

const INITIAL_ARRAY_UPLOAD_BYTES = 3 * 1024 * 1024
const FRAME_ARRAY_UPLOAD_BYTES = 768 * 1024

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
  private fingerprintFullScans = 0
  private fingerprintPatchScans = 0
  private fingerprintItemsScanned = 0
  private nextLayer = 0
  private skipUploadFrames = 0
  private layerUploadFrames = 0
  private atlas: TextureAtlasResult | null = null
  private readonly atlasMetrics = new CardAtlasMetrics()
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
      frame: { update: () => this.advanceAtlasUploads() },
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
    this.fingerprintFullScans += 1
    this.fingerprintItemsScanned += items.length
    if (
      this.mesh
      && equalFingerprints(fingerprints, this.itemFingerprints)
      && !this.resourceScheduler.isPending('cards-content')
    ) return true
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
        this.atlasMetrics.discardBuild()
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
    const indices = normalizeChangedIndices(changedIndices, items.length)
    const fingerprints = indices.map((index) => ({
      index,
      value: createItemFingerprint(items[index], this.atlasOptions),
    }))
    this.fingerprintPatchScans += 1
    this.fingerprintItemsScanned += fingerprints.length
    if (
      fingerprints.every(({ index, value }) => this.itemFingerprints[index] === value)
      && !this.resourceScheduler.isPending('cards-content')
    ) return true
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
        this.atlasMetrics.recordPatch(patch.metrics, applyMs)
        fingerprints.forEach(({ index, value }) => {
          this.itemFingerprints[index] = value
        })
        this.materialRuntime.uploadMotion(items)
        return true
      },
      discard: () => this.atlasMetrics.discardPatch(),
    })
    return result.status === 'committed' && result.value
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
      this.atlasMetrics.recordUpload(this.atlas.data.byteLength)
      this.prewarmAtlas(this.atlas)
    }
  }

  getStats(): MotionRendererStats {
    const resourceStats = this.resourceScheduler.getStats()
    return {
      instanceCount: this.mesh ? this.itemCount : 0,
      submittedInstanceCount: this.mesh?.geometry.instanceCount ?? 0,
      gpuBytes: this.atlasMetrics.textureBytes + geometryByteLength(this.mesh?.geometry),
      metrics: {
        textureBytes: this.atlasMetrics.textureBytes,
        ...this.atlasMetrics.snapshot(),
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
    this.atlasMetrics.recordBuild(atlas)
  }

  private prewarmAtlas(atlas: TextureAtlasResult): void {
    const shouldPrewarm = this.atlasOptions.texturePrewarm === true
      || (
        this.atlasOptions.texturePrewarm !== false
        && atlas.data.byteLength <= 16 * 1024 * 1024
      )
    if (!shouldPrewarm || !this.atlasOptions.prepareTexture) {
      this.atlasMetrics.recordPrewarmSkipped()
      return
    }
    try {
      this.atlasMetrics.recordPrewarm(this.atlasOptions.prepareTexture(atlas.texture))
    } catch {
      this.atlasMetrics.recordPrewarmFailure()
    }
  }

  private prepareAtlasUploads(atlas: TextureAtlasResult): void {
    this.nextLayer = 0
    this.skipUploadFrames = 0
    this.atlasBackend.clearPatchQueue(atlas)
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
      || !('layerUpdates' in atlas.texture)
    ) return
    if (this.skipUploadFrames > 0) {
      this.skipUploadFrames -= 1
      return
    }
    const [end, uploaded] = this.atlasBackend.advanceUploads(
      atlas,
      this.nextLayer,
      this.layersPerUpload(atlas, FRAME_ARRAY_UPLOAD_BYTES),
    )
    this.nextLayer = end
    this.setCommonUniform('uLayers', end)
    if (uploaded) this.layerUploadFrames += 1
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
    this.atlasMetrics.resetTexture()
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
    this.atlasBackendReady ??= this.atlasBackend.prepare().catch((error) => {
      this.atlasBackendReady = null
      throw error
    })
    return this.atlasBackendReady
  }

  private writeTransform(
    transform: Transform,
    index: number,
    positions: Float32Array,
    quaternions: Float32Array,
    scales: Float32Array,
    opacities: Float32Array,
  ): void {
    const positionOffset = index * 3
    positions[positionOffset] = transform.x
    positions[positionOffset + 1] = transform.y
    positions[positionOffset + 2] = transform.z
    this.euler.set(transform.rotationX, transform.rotationY, transform.rotationZ, 'XYZ')
    this.quaternion.setFromEuler(this.euler)
    const quaternionOffset = index * 4
    quaternions[quaternionOffset] = this.quaternion.x
    quaternions[quaternionOffset + 1] = this.quaternion.y
    quaternions[quaternionOffset + 2] = this.quaternion.z
    quaternions[quaternionOffset + 3] = this.quaternion.w
    scales[index] = transform.scale
    opacities[index] = transform.opacity
  }
}

class LazyDefaultCardAtlasBackend<TMeta> implements CardAtlasBackend<TMeta> {
  private backend: CardAtlasBackend<TMeta> | null = null
  private pending: Promise<CardAtlasBackend<TMeta>> | null = null
  private disposed = false

  constructor(private readonly options: TextureAtlasOptions<TMeta>) {}

  async prepare(): Promise<void> {
    const backend = await this.load()
    await backend.prepare()
  }

  async build(
    items: readonly MotionItem<TMeta>[],
    resolution: number,
    signal: AbortSignal,
  ): Promise<PreparedCardAtlas> {
    const backend = this.backend ?? await this.load()
    return backend.build(items, resolution, signal)
  }

  async patch(
    items: readonly MotionItem<TMeta>[],
    changedIndices: readonly number[],
    atlas: TextureAtlasResult,
    signal: AbortSignal,
  ): Promise<TextureAtlasPatch> {
    const backend = this.backend ?? await this.load()
    return backend.patch(items, changedIndices, atlas, signal)
  }

  applyPatch(
    atlas: TextureAtlasResult,
    patch: TextureAtlasPatch,
    visibleLayers?: number,
  ): number {
    return this.backend!.applyPatch(atlas, patch, visibleLayers)
  }

  advanceUploads(
    atlas: TextureAtlasResult,
    nextLayer: number,
    layerBudget: number,
  ): readonly [nextLayer: number, uploaded: boolean] {
    return this.backend?.advanceUploads(atlas, nextLayer, layerBudget)
      ?? [nextLayer, false]
  }

  clearPatchQueue(atlas: TextureAtlasResult): void {
    this.backend?.clearPatchQueue(atlas)
  }

  dispose(): void {
    this.disposed = true
    this.backend?.dispose()
  }

  private async load(): Promise<CardAtlasBackend<TMeta>> {
    if (this.backend) return this.backend
    this.pending ??= import('./cards/DefaultCardAtlasBackend.js')
      .then(({ DefaultCardAtlasBackend }) =>
        new DefaultCardAtlasBackend(this.options))
      .catch((error) => {
        this.pending = null
        throw error
      })
    const backend = await this.pending
    if (this.disposed) backend.dispose()
    else this.backend = backend
    return backend
  }
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

function markAttributePair(
  from: InstancedBufferAttribute,
  to: InstancedBufferAttribute,
  count: number,
): void {
  markAttribute(from, count)
  markAttribute(to, count)
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
