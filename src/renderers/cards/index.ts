import type {
  CardContentRenderer,
  CardStyle,
  DrawCard,
  ResolveCardStyle,
} from '../../core/types.js'
import type { MotionRendererFactory } from '../MotionRenderer.js'
import type {
  CardEffectProgramLoader,
  CardMotionProgram,
} from './programs.js'
import type { CardAtlasBackend } from './CardAtlasBackend.js'
import {
  InstancedCardRenderer,
  type CardRendererOptions as InternalCardRendererOptions,
} from '../InstancedCardRenderer.js'

export interface CardsRendererOptions<TMeta = unknown> {
  style?: CardStyle
  resolveStyle?: ResolveCardStyle<TMeta>
  draw?: DrawCard<TMeta>
  content?: CardContentRenderer<TMeta>
  aspectRatio?: number
  resolution?: number | 'auto'
  mipmaps?: boolean
  imageTimeout?: number
  imageConcurrency?: number
  imageCacheSize?: number
  texturePrewarm?: boolean
  atlasMode?: 'single' | 'array' | 'auto'
  motionProgram?: CardMotionProgram<TMeta>
  effectPrograms?: Readonly<Record<string, CardEffectProgramLoader>>
  /** Stable content revision used to skip default meta/style serialization during updates. */
  resolveContentKey?: (item: import('../../core/types.js').MotionItem<TMeta>) => string | number
  /** Advanced raster/storage/upload backend; the default remains lazy and worker-aware. */
  atlasBackend?: CardAtlasBackend<TMeta>
}

export function cardsRenderer<TMeta = unknown>(
  options: CardsRendererOptions<TMeta> = {},
): MotionRendererFactory<TMeta> {
  if (options.content && options.draw) {
    throw new TypeError('Cards renderer content and draw cannot be used together')
  }
  validateEffectPrograms(options.effectPrograms)
  const atlasOptions: InternalCardRendererOptions<TMeta> = {
    cardStyle: options.style,
    resolveCardStyle: options.resolveStyle,
    drawCard: options.draw,
    cardContent: options.content,
    aspectRatio: resolveAspectRatio(options.aspectRatio),
    cellSize: options.resolution,
    mipmaps: options.mipmaps,
    imageTimeout: options.imageTimeout,
    imageConcurrency: options.imageConcurrency,
    imageCacheSize: options.imageCacheSize,
    texturePrewarm: options.texturePrewarm,
    atlasMode: options.atlasMode,
    motionProgram: options.motionProgram,
    effectPrograms: options.effectPrograms,
    resolveContentKey: options.resolveContentKey,
    atlasBackend: options.atlasBackend,
  }
  return ({
    root,
    maxTextureSize,
    maxTextureLayers,
    maxAnisotropy,
    prepareTexture,
    prepareProgram,
    signal,
  }) => new InstancedCardRenderer(root, {
    ...atlasOptions,
    maxTextureSize,
    maxTextureLayers: Math.min(256, maxTextureLayers),
    anisotropy: Math.min(4, maxAnisotropy),
    prepareTexture,
    prepareProgram,
    signal,
  })
}

function validateEffectPrograms(
  programs: Readonly<Record<string, CardEffectProgramLoader>> | undefined,
): void {
  for (const [kind, loader] of Object.entries(programs ?? {})) {
    if (typeof loader !== 'function' && loader.kind !== kind) {
      throw new TypeError(`Cards effect program "${kind}" has mismatched kind "${loader.kind}"`)
    }
  }
}

function resolveAspectRatio(value: number | undefined): number {
  return Number.isFinite(value) ? Math.min(4, Math.max(0.25, value as number)) : 1
}

export type {
  CardContentDrawContext,
  CardContentRenderer,
  CardDrawBounds,
  CardStyle,
  CardTitleStyle,
  DrawCard,
  PreparedCardContent,
  ResolveCardStyle,
} from '../../core/types.js'
export {
  defineCardEffectProgram,
  defineCardMotionProgram,
} from './programs.js'
export type {
  CardAtlasBackend,
  PreparedCardAtlas,
} from './CardAtlasBackend.js'
export type {
  CardEffectProgram,
  CardEffectProgramLoader,
  CardEffectProgramRuntime,
  CardEffectProgramRuntimeContext,
  CardMotionProgram,
  CardProgramAttribute,
  CardProgramUniform,
  CardProgramUniformType,
  CardProgramUploadContext,
} from './programs.js'
