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
  CardEffectProgramRuntime,
  CardMotionProgram,
  CardProgramUploadContext,
} from './programs.js'
import { CardProgramLoader } from './CardProgramLoader.js'

interface PreparedEffectProgram {
  readonly program: CardEffectProgram
  readonly material: ShaderMaterial
  readonly timeUniform: { value: unknown } | null
  readonly lifecycle: CardEffectProgramRuntime | null
  restorePending: boolean
}

interface CardMaterialBinding<TMeta> {
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

const commonUniforms = [
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
] as const

/**
 * Unique owner of Cards materials, Program preparation, switching and disposal.
 */
export class CardMaterialRuntime<TMeta = unknown> {
  private readonly loader: CardProgramLoader
  private binding: CardMaterialBinding<TMeta> | null = null
  private baseMaterial: ShaderMaterial | null = null
  private activeProgram: PreparedEffectProgram | null = null
  private readonly programs = new Map<string, PreparedEffectProgram>()
  private configureMaterial: ((material: ShaderMaterial) => void) | undefined
  private programPrepareMs = 0
  private programSwitches = 0
  private programFailures = 0

  constructor(private readonly options: CardMaterialRuntimeOptions<TMeta>) {
    this.loader = new CardProgramLoader(options.effectPrograms)
  }

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
    const binding = this.binding
    if (!binding || !this.baseMaterial) return false
    try {
      const result = await this.options.scheduler.scheduleLatest('cards-effect', {
        prepare: (signal) => this.prepareActivation(binding, data, itemCount, signal),
        commit: (activation) => this.commitActivation(activation),
        discard: (activation) => this.releaseCreated(activation?.createdKind ?? null),
      })
      return result.status === 'committed' && result.value
    } catch (error) {
      this.programFailures += 1
      this.disableEffect(itemCount)
      throw error
    }
  }

  disableEffect(itemCount = this.binding?.mesh.geometry.instanceCount ?? 0): void {
    this.options.scheduler.cancel('cards-effect')
    this.activeProgram?.lifecycle?.deactivate?.()
    this.activeProgram = null
    if (!this.binding || !this.baseMaterial) return
    this.binding.mesh.material = this.baseMaterial
    this.binding.mesh.geometry.instanceCount = itemCount
  }

  setEffectTime(elapsedSeconds: number): void {
    const timeUniform = this.activeProgram?.timeUniform
    if (timeUniform) timeUniform.value = elapsedSeconds
    this.activeProgram?.lifecycle?.update?.(elapsedSeconds)
  }

  markResourcesLost(): void {
    this.programs.forEach((runtime) => {
      runtime.restorePending = true
    })
  }

  setCommonUniform(name: string, value: unknown): void {
    if (!this.baseMaterial) return
    this.baseMaterial.uniforms[name]!.value = value
    const activeMaterial = this.activeProgram?.material
    if (activeMaterial && activeMaterial !== this.baseMaterial) {
      activeMaterial.uniforms[name]!.value = value
    }
  }

  getStats(): CardMaterialRuntimeStats {
    return {
      programLoads: this.loader.getLoadCount(),
      programLoadMs: this.loader.getLoadMs(),
      programPrepareMs: this.programPrepareMs,
      programSwitches: this.programSwitches,
      programFailures: this.programFailures,
      cachedPrograms: this.programs.size,
    }
  }

  disposeCurrent(): void {
    this.options.scheduler.cancel('cards-effect')
    this.activeProgram?.lifecycle?.deactivate?.()
    this.binding = null
    this.activeProgram = null
    this.baseMaterial?.dispose()
    this.programs.forEach(({ material, lifecycle }) => {
      lifecycle?.dispose?.()
      material.dispose()
    })
    this.programs.clear()
    this.baseMaterial = null
    this.configureMaterial = undefined
  }

  dispose(): void {
    this.disposeCurrent()
    this.loader.clear()
  }

  private syncCommonUniforms(target: ShaderMaterial): void {
    if (!this.baseMaterial) return
    for (const name of commonUniforms) {
      target.uniforms[name]!.value = this.baseMaterial.uniforms[name]!.value
    }
  }

  private async prepareActivation(
    binding: CardMaterialBinding<TMeta>,
    data: StreamingEffectGpuData,
    itemCount: number,
    signal: AbortSignal,
  ): Promise<{
    binding: CardMaterialBinding<TMeta>
    runtime: PreparedEffectProgram | null
    createdKind: string | null
    itemCount: number
    activeCount: number
  } | null> {
    const program = await this.loader.load(data.kind)
    if (!program || signal.aborted || this.binding !== binding) return null
    let runtime = this.programs.get(program.kind)
    let createdKind: string | null = null
    if (!runtime) {
      const preparedAt = performance.now()
      binding.ensureAttributes(program)
      const material = createCardProgramMaterial(
        this.baseMaterial!.uniforms.atlas!.value as Texture,
        this.baseMaterial!.uniforms.uLayers!.value as number,
        program,
      )
      this.configureMaterial?.(material)
      try {
        runtime = {
          program,
          material,
          timeUniform: resolveProgramTimeUniform(program, material),
          lifecycle: createProgramLifecycle(program),
          restorePending: false,
        }
        await this.options.prepareProgram?.(material, binding.mesh.geometry)
      } catch (error) {
        runtime?.lifecycle?.dispose?.()
        material.dispose()
        throw error
      }
      if (signal.aborted || this.binding !== binding) {
        runtime.lifecycle?.dispose?.()
        material.dispose()
        return null
      }
      this.programs.set(program.kind, runtime)
      createdKind = program.kind
      this.programPrepareMs += performance.now() - preparedAt
    }
    try {
      this.syncCommonUniforms(runtime.material)
      const upload = binding.createUploadContext(program, runtime.material)
      const runtimeContext = { signal, upload }
      if (runtime.restorePending && runtime.lifecycle?.restore) {
        await runtime.lifecycle.restore(runtimeContext, data.payload)
      } else {
        await runtime.lifecycle?.prepare?.(runtimeContext, data.payload)
      }
      if (signal.aborted || this.binding !== binding) {
        this.releaseCreated(createdKind)
        return null
      }
      program.upload(upload, data.payload)
      return {
        binding,
        runtime,
        createdKind,
        itemCount,
        activeCount: data.activeCount,
      }
    } catch (error) {
      this.releaseCreated(createdKind)
      throw error
    }
  }

  private commitActivation(
    activation: Awaited<ReturnType<CardMaterialRuntime<TMeta>['prepareActivation']>>,
  ): boolean {
    if (!activation?.runtime || this.binding !== activation.binding) return false
    const { binding, runtime } = activation
    if (this.activeProgram !== runtime) this.activeProgram?.lifecycle?.deactivate?.()
    this.activeProgram = runtime
    runtime.restorePending = false
    runtime.lifecycle?.activate?.()
    binding.mesh.material = runtime.material
    binding.mesh.geometry.instanceCount = Math.min(
      activation.itemCount,
      activation.activeCount,
    )
    this.programSwitches += 1
    return true
  }

  private releaseCreated(kind: string | null): void {
    if (!kind) return
    const runtime = this.programs.get(kind)
    runtime?.lifecycle?.dispose?.()
    runtime?.material.dispose()
    this.programs.delete(kind)
  }
}

function resolveProgramTimeUniform(
  program: CardEffectProgram,
  material: ShaderMaterial,
): { value: unknown } | null {
  return program.clockUniform
    ? material.uniforms[program.clockUniform] ?? null
    : null
}

function createProgramLifecycle(program: CardEffectProgram): CardEffectProgramRuntime | null {
  const lifecycle = program.createRuntime?.()
  if (lifecycle === undefined) return null
  if (!lifecycle || typeof lifecycle !== 'object') {
    throw new TypeError(`Cards effect program "${program.kind}" returned an invalid runtime`)
  }
  for (const method of [
    'prepare', 'restore', 'activate', 'update', 'deactivate', 'dispose',
  ] as const) {
    if (lifecycle[method] !== undefined && typeof lifecycle[method] !== 'function') {
      throw new TypeError(
        `Cards effect program "${program.kind}" runtime has invalid ${method} hook`,
      )
    }
  }
  return lifecycle
}
