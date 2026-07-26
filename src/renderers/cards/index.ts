import type {
  CardContentRenderer,
  CardStyle,
  DrawCard,
  ResolveCardStyle,
} from '../../core/types.js'
import type { MotionRendererFactory } from '../MotionRenderer.js'
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
  resolution?: number
  imageTimeout?: number
  imageConcurrency?: number
  imageCacheSize?: number
}

export function cardsRenderer<TMeta = unknown>(
  options: CardsRendererOptions<TMeta> = {},
): MotionRendererFactory<TMeta> {
  if (options.content && options.draw) {
    throw new TypeError('Cards renderer content and draw cannot be used together')
  }
  const atlasOptions: InternalCardRendererOptions<TMeta> = {
    cardStyle: options.style,
    resolveCardStyle: options.resolveStyle,
    drawCard: options.draw,
    cardContent: options.content,
    aspectRatio: resolveAspectRatio(options.aspectRatio),
    cellSize: options.resolution,
    imageTimeout: options.imageTimeout,
    imageConcurrency: options.imageConcurrency,
    imageCacheSize: options.imageCacheSize,
  }
  return ({ root, maxTextureSize, maxAnisotropy }) => new InstancedCardRenderer(root, {
    ...atlasOptions,
    maxTextureSize,
    anisotropy: Math.min(4, maxAnisotropy),
  })
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
