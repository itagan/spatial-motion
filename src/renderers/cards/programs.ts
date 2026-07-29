import type { MotionItem } from '../../core/types.js'

export type CardProgramUniformType = 'float' | 'vec2' | 'vec3' | 'vec4'

export interface CardProgramAttribute {
  name: string
  itemSize: 1 | 2 | 3 | 4
  initialValue?: number
}

export interface CardProgramUniform {
  name: string
  type: CardProgramUniformType
  initialValue?: number | readonly number[]
}

export interface CardProgramUploadContext {
  readonly capacity: number
  readonly itemCount: number
  setAttribute(name: string, values: Float32Array): void
  setUniform(name: string, value: number | readonly number[] | Float32Array): void
}

export interface CardEffectProgramRuntimeContext {
  readonly signal: AbortSignal
  readonly upload: CardProgramUploadContext
}

export interface CardEffectProgramRuntime<TPayload = unknown> {
  prepare?(
    context: CardEffectProgramRuntimeContext,
    payload: TPayload,
  ): void | Promise<void>
  restore?(
    context: CardEffectProgramRuntimeContext,
    payload: TPayload,
  ): void | Promise<void>
  activate?(): void
  update?(elapsedSeconds: number): void
  deactivate?(): void
  dispose?(): void
}

interface CardProgramDefinition {
  kind: string
  prefix: string
  attributes?: readonly CardProgramAttribute[]
  uniforms?: readonly CardProgramUniform[]
  /** Extra GLSL declarations and helper functions inserted before main(). */
  vertexDeclarations?: string
  /**
   * GLSL statements inserted after common transform interpolation. Available
   * variables: center, itemScale, opacity, itemQuaternion and programVisible.
   */
  vertexBody: string
}

export interface CardMotionProgram<TMeta = unknown> extends Readonly<CardProgramDefinition> {
  readonly type: 'motion'
  upload?(
    context: CardProgramUploadContext,
    items: readonly MotionItem<TMeta>[],
  ): void
}

export interface CardEffectProgram<TPayload = unknown> extends Readonly<CardProgramDefinition> {
  readonly type: 'effect'
  /** Optional float Uniform driven by the Stage effect clock. */
  readonly clockUniform?: string
  createRuntime?(): CardEffectProgramRuntime<TPayload>
  upload(context: CardProgramUploadContext, payload: TPayload): void
}

export type CardEffectProgramLoader =
  | CardEffectProgram
  | (() => CardEffectProgram | Promise<CardEffectProgram>)

export function defineCardMotionProgram<TMeta = unknown>(
  definition: CardProgramDefinition & {
    upload?(
      context: CardProgramUploadContext,
      items: readonly MotionItem<TMeta>[],
    ): void
  },
): CardMotionProgram<TMeta> {
  validateProgram(definition)
  return Object.freeze({ ...definition, type: 'motion' as const })
}

export function defineCardEffectProgram<TPayload>(
  definition: CardProgramDefinition & {
    clockUniform?: string
    createRuntime?(): CardEffectProgramRuntime<TPayload>
    upload(context: CardProgramUploadContext, payload: TPayload): void
  },
): CardEffectProgram<TPayload> {
  validateProgram(definition)
  validateClockUniform(definition)
  if (typeof definition.upload !== 'function') {
    throw new TypeError('Card effect program upload must be a function')
  }
  if (definition.createRuntime !== undefined && typeof definition.createRuntime !== 'function') {
    throw new TypeError('Card effect program createRuntime must be a function')
  }
  return Object.freeze({ ...definition, type: 'effect' as const })
}

function validateClockUniform(
  definition: CardProgramDefinition & { clockUniform?: string },
): void {
  if (definition.clockUniform === undefined) return
  const uniform = definition.uniforms?.find(({ name }) => name === definition.clockUniform)
  if (!uniform) {
    throw new TypeError(
      `Card effect clockUniform "${definition.clockUniform}" must reference a declared uniform`,
    )
  }
  if (uniform.type !== 'float') {
    throw new TypeError(`Card effect clockUniform "${definition.clockUniform}" must be a float`)
  }
}

const reservedFields = new Set([
  'position',
  'uv',
  'atlasRect',
  'visibilityRank',
  'itemIndex',
  'fromPosition',
  'toPosition',
  'fromQuaternion',
  'toQuaternion',
  'fromScale',
  'toScale',
  'fromOpacity',
  'toOpacity',
  'atlas',
  'progress',
  'visibleRatio',
  'hoverIndex',
  'uLayers',
])

function validateProgram(definition: CardProgramDefinition): void {
  if (!/^[a-z][a-z0-9-]*$/.test(definition.kind)) {
    throw new TypeError('Card program kind must use lowercase letters, numbers and hyphens')
  }
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*_$/.test(definition.prefix)) {
    throw new TypeError('Card program prefix must be a valid GLSL identifier ending in "_"')
  }
  if (!definition.vertexBody.trim()) {
    throw new TypeError('Card program vertexBody cannot be empty')
  }
  const names = new Set<string>()
  for (const attribute of definition.attributes ?? []) {
    validateField(attribute.name, definition.prefix, names)
    if (![1, 2, 3, 4].includes(attribute.itemSize)) {
      throw new TypeError(`Invalid itemSize for ${attribute.name}`)
    }
    if (attribute.initialValue !== undefined && !Number.isFinite(attribute.initialValue)) {
      throw new TypeError(`Invalid initialValue for ${attribute.name}`)
    }
  }
  for (const uniform of definition.uniforms ?? []) {
    validateField(uniform.name, definition.prefix, names)
    const size = uniform.type === 'float' ? 1 : Number(uniform.type.at(-1))
    const values = typeof uniform.initialValue === 'number'
      ? [uniform.initialValue]
      : [...(uniform.initialValue ?? [])]
    if (values.length && values.length !== size) {
      throw new TypeError(`Invalid initialValue for ${uniform.name}`)
    }
    if (values.some((value) => !Number.isFinite(value))) {
      throw new TypeError(`Invalid initialValue for ${uniform.name}`)
    }
  }
}

function validateField(name: string, prefix: string, names: Set<string>): void {
  if (!name.startsWith(prefix)) {
    throw new TypeError(`Card program field "${name}" must start with "${prefix}"`)
  }
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name) || reservedFields.has(name)) {
    throw new TypeError(`Invalid or reserved Card program field "${name}"`)
  }
  if (names.has(name)) throw new TypeError(`Duplicate Card program field "${name}"`)
  names.add(name)
}
