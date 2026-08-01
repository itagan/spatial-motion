import {
  type InstancedBufferGeometry,
  type Mesh,
  ShaderMaterial,
  type Texture,
} from 'three'
import type { MotionItem } from '../../core/types.js'
import type { StreamingEffectGpuData } from '../../effects/types.js'
import type { ResourceScheduler } from '../../runtime/ResourceScheduler.js'
import { createCardProgramMaterial } from '../CardProgramMaterial.js'
import type {
  CardEffectProgram,
  CardEffectProgramLoader,
  CardMotionProgram,
  CardProgramUploadContext,
} from './programs.js'

export interface CardMaterialBinding<TMeta> {
  mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>
  ensureAttributes(program: CardEffectProgram | CardMotionProgram<TMeta>): void
  createUploadContext(
    program: CardEffectProgram | CardMotionProgram<TMeta>,
    material: ShaderMaterial,
  ): CardProgramUploadContext
}

interface CardMaterialRuntimeOptions<TMeta> {
  scheduler: ResourceScheduler
  motionProgram?: CardMotionProgram<TMeta>
  effectPrograms?: Readonly<Record<string, CardEffectProgramLoader>>
  prepareProgram?: (
    material: ShaderMaterial,
    geometry: InstancedBufferGeometry,
  ) => Promise<number>
}

export interface CardMaterialRuntimeStats {
  readonly programLoads: number
  readonly programLoadMs: number
  readonly programPrepareMs: number
  readonly programSwitches: number
  readonly programFailures: number
  readonly cachedPrograms: number
}

const emptyEffectStats: CardMaterialRuntimeStats = Object.freeze({
  programLoads: 0,
  programLoadMs: 0,
  programPrepareMs: 0,
  programSwitches: 0,
  programFailures: 0,
  cachedPrograms: 0,
})

/**
 * Owns the always-present base material and loads the optional Effect runtime on demand.
 */
export class CardMaterialRuntime<TMeta = unknown> {
  private binding: CardMaterialBinding<TMeta> | null = null
  private baseMaterial: ShaderMaterial | null = null
  private configureMaterial: ((material: ShaderMaterial) => void) | undefined
  private effectRuntime: import('./CardEffectRuntime.js').CardEffectRuntime<TMeta> | null = null
  private effectRuntimePromise:
    Promise<import('./CardEffectRuntime.js').CardEffectRuntime<TMeta> | null> | null = null
  private effectGeneration = 0
  private disposed = false

  constructor(private readonly options: CardMaterialRuntimeOptions<TMeta>) {}

  createBaseMaterial(
    texture: Texture,
    layers: number,
    configureMaterial?: (material: ShaderMaterial) => void,
  ): ShaderMaterial {
    this.disposeCurrent()
    this.configureMaterial = configureMaterial
    this.baseMaterial = createCardProgramMaterial(
      texture,
      layers,
      this.options.motionProgram,
    )
    configureMaterial?.(this.baseMaterial)
    return this.baseMaterial
  }

  bind(binding: CardMaterialBinding<TMeta>): void {
    if (!this.baseMaterial) throw new Error('Cards base material must be created before binding')
    this.binding = binding
    this.bindEffectRuntime()
  }

  replaceAtlas(texture: Texture, layers: number): void {
    this.setCommonUniform('atlas', texture)
    this.setCommonUniform('uLayers', layers)
  }

  uploadMotion(items: readonly MotionItem<TMeta>[]): void {
    const program = this.options.motionProgram
    if (!program?.upload || !this.binding || !this.baseMaterial) return
    program.upload(this.binding.createUploadContext(program, this.baseMaterial), items)
  }

  async enableEffect(data: StreamingEffectGpuData, itemCount: number): Promise<boolean> {
    const generation = ++this.effectGeneration
    const runtime = await this.prepareEffectRuntime()
    if (!runtime || generation !== this.effectGeneration || this.disposed) return false
    return await runtime.enableEffect(data, itemCount)
  }

  async prewarm(kinds: readonly string[]): Promise<boolean> {
    if (!kinds.length) return Boolean(this.binding && this.baseMaterial && !this.disposed)
    const runtime = await this.prepareEffectRuntime()
    return runtime ? await runtime.prewarm(kinds) : false
  }

  disableEffect(itemCount = this.binding?.mesh.geometry.instanceCount ?? 0): void {
    this.effectGeneration += 1
    this.options.scheduler.cancel('cards-effect')
    this.effectRuntime?.disableEffect(itemCount)
    if (!this.effectRuntime && this.binding && this.baseMaterial) {
      this.binding.mesh.material = this.baseMaterial
      this.binding.mesh.geometry.instanceCount = itemCount
    }
  }

  setEffectTime(elapsedSeconds: number): void {
    this.effectRuntime?.setEffectTime(elapsedSeconds)
  }

  markResourcesLost(): void {
    this.effectRuntime?.markResourcesLost()
  }

  setCommonUniform(name: string, value: unknown): void {
    if (!this.baseMaterial) return
    this.baseMaterial.uniforms[name]!.value = value
    this.effectRuntime?.setCommonUniform(name, value)
  }

  getStats(): CardMaterialRuntimeStats {
    return this.effectRuntime?.getStats() ?? emptyEffectStats
  }

  disposeCurrent(): void {
    this.effectGeneration += 1
    this.options.scheduler.cancel('cards-effect')
    this.effectRuntime?.disposeCurrent()
    this.binding = null
    this.baseMaterial?.dispose()
    this.baseMaterial = null
    this.configureMaterial = undefined
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.effectGeneration += 1
    this.disposeCurrent()
    this.effectRuntime?.dispose()
    this.effectRuntime = null
  }

  private async prepareEffectRuntime(): Promise<
    import('./CardEffectRuntime.js').CardEffectRuntime<TMeta> | null
  > {
    if (this.disposed || !this.binding || !this.baseMaterial) return null
    if (this.effectRuntime) return this.effectRuntime
    if (!this.effectRuntimePromise) {
      const loading = import('./CardEffectRuntime.js').then(({ CardEffectRuntime }) => {
        if (this.disposed) return null
        const runtime = new CardEffectRuntime<TMeta>({
          scheduler: this.options.scheduler,
          effectPrograms: this.options.effectPrograms,
          prepareProgram: this.options.prepareProgram,
        })
        this.effectRuntime = runtime
        this.bindEffectRuntime()
        return runtime
      }).finally(() => {
        if (this.effectRuntimePromise === loading) this.effectRuntimePromise = null
      })
      this.effectRuntimePromise = loading
    }
    return await this.effectRuntimePromise
  }

  private bindEffectRuntime(): void {
    if (!this.effectRuntime || !this.binding || !this.baseMaterial) return
    this.effectRuntime.bind({
      ...this.binding,
      baseMaterial: this.baseMaterial,
      configureMaterial: this.configureMaterial,
    })
  }
}
