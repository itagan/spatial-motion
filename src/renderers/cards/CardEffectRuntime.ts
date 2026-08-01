import {
  type InstancedBufferGeometry,
  ShaderMaterial,
  type Texture,
} from 'three'
import type { StreamingEffectGpuData } from '../../effects/types.js'
import type { ResourceScheduler } from '../../runtime/ResourceScheduler.js'
import { createCardProgramMaterial } from '../CardProgramMaterial.js'
import type { CardMaterialBinding, CardMaterialRuntimeStats } from './CardMaterialRuntime.js'
import { CardProgramLoader } from './CardProgramLoader.js'
import type {
  CardEffectProgram,
  CardEffectProgramLoader,
  CardEffectProgramRuntime,
} from './programs.js'

interface PreparedEffectProgram {
  readonly program: CardEffectProgram
  readonly material: ShaderMaterial
  readonly timeUniform: { value: unknown } | null
  readonly lifecycle: CardEffectProgramRuntime | null
  restorePending: boolean
}

interface PreparedEffectProgramResult {
  readonly runtime: PreparedEffectProgram
  readonly created: boolean
}

interface CardEffectMaterialBinding<TMeta> extends CardMaterialBinding<TMeta> {
  baseMaterial: ShaderMaterial
  configureMaterial?: (material: ShaderMaterial) => void
}

interface CardEffectRuntimeOptions {
  scheduler: ResourceScheduler
  effectPrograms?: Readonly<Record<string, CardEffectProgramLoader>>
  prepareProgram?: (
    material: ShaderMaterial,
    geometry: InstancedBufferGeometry,
  ) => Promise<number>
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

/** Optional Cards Effect Program lifecycle, loaded on the first effect or Program prewarm. */
export class CardEffectRuntime<TMeta = unknown> {
  private readonly loader: CardProgramLoader
  private binding: CardEffectMaterialBinding<TMeta> | null = null
  private activeProgram: PreparedEffectProgram | null = null
  private readonly programs = new Map<string, PreparedEffectProgram>()
  private programPrepareMs = 0
  private programSwitches = 0
  private programFailures = 0

  constructor(private readonly options: CardEffectRuntimeOptions) {
    this.loader = new CardProgramLoader(options.effectPrograms)
  }

  bind(binding: CardEffectMaterialBinding<TMeta>): void {
    this.binding = binding
  }

  async enableEffect(data: StreamingEffectGpuData, itemCount: number): Promise<boolean> {
    const binding = this.binding
    if (!binding) return false
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

  async prewarm(kinds: readonly string[]): Promise<boolean> {
    const binding = this.binding
    if (!binding) return false
    for (const kind of kinds) {
      const program = await this.loader.load(kind)
      if (!program || this.binding !== binding) return false
      if (!await this.ensurePreparedProgram(binding, program)) return false
    }
    return true
  }

  disableEffect(itemCount = this.binding?.mesh.geometry.instanceCount ?? 0): void {
    this.options.scheduler.cancel('cards-effect')
    this.activeProgram?.lifecycle?.deactivate?.()
    this.activeProgram = null
    if (!this.binding) return
    this.binding.mesh.material = this.binding.baseMaterial
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
    const material = this.activeProgram?.material
    if (material) material.uniforms[name]!.value = value
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
    this.programs.forEach(({ material, lifecycle }) => {
      lifecycle?.dispose?.()
      material.dispose()
    })
    this.programs.clear()
  }

  dispose(): void {
    this.disposeCurrent()
    this.loader.clear()
  }

  private syncCommonUniforms(target: ShaderMaterial, baseMaterial: ShaderMaterial): void {
    for (const name of commonUniforms) {
      target.uniforms[name]!.value = baseMaterial.uniforms[name]!.value
    }
  }

  private async prepareActivation(
    binding: CardEffectMaterialBinding<TMeta>,
    data: StreamingEffectGpuData,
    itemCount: number,
    signal: AbortSignal,
  ): Promise<{
    binding: CardEffectMaterialBinding<TMeta>
    runtime: PreparedEffectProgram | null
    createdKind: string | null
    itemCount: number
    activeCount: number
  } | null> {
    const program = await this.loader.load(data.kind)
    if (!program || signal.aborted || this.binding !== binding) return null
    const prepared = await this.ensurePreparedProgram(binding, program, signal)
    if (!prepared) return null
    const { runtime } = prepared
    const createdKind = prepared.created ? program.kind : null
    try {
      this.syncCommonUniforms(runtime.material, binding.baseMaterial)
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
    activation: Awaited<ReturnType<CardEffectRuntime<TMeta>['prepareActivation']>>,
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

  private async ensurePreparedProgram(
    binding: CardEffectMaterialBinding<TMeta>,
    program: CardEffectProgram,
    signal?: AbortSignal,
  ): Promise<PreparedEffectProgramResult | null> {
    const cached = this.programs.get(program.kind)
    if (cached) return { runtime: cached, created: false }
    const preparedAt = performance.now()
    binding.ensureAttributes(program)
    const material = createCardProgramMaterial(
      binding.baseMaterial.uniforms.atlas!.value as Texture,
      binding.baseMaterial.uniforms.uLayers!.value as number,
      program,
    )
    binding.configureMaterial?.(material)
    let runtime: PreparedEffectProgram | null = null
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
    if (signal?.aborted || this.binding !== binding) {
      runtime.lifecycle?.dispose?.()
      material.dispose()
      return null
    }
    const concurrent = this.programs.get(program.kind)
    if (concurrent) {
      runtime.lifecycle?.dispose?.()
      material.dispose()
      return { runtime: concurrent, created: false }
    }
    this.programs.set(program.kind, runtime)
    this.programPrepareMs += performance.now() - preparedAt
    return { runtime, created: true }
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
    throw new TypeError(
      `spatial-motion-card-effect-runtime: program "${program.kind}" returned an invalid runtime`,
    )
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
