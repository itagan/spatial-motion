import type { Texture } from 'three'
import type { MotionItem } from '../../core/types.js'
import type { MotionRendererFactoryContext } from '../MotionRenderer.js'
import type { TextureAtlasOptions } from '../textureAtlas.js'
import type { CardAtlasBackend } from './CardAtlasBackend.js'
import type { CardEffectProgramLoader, CardMotionProgram } from './programs.js'

export interface CardRendererOptions<TMeta = unknown> extends TextureAtlasOptions<TMeta> {
  cellSize?: number | 'auto'
  prepareTexture?: (texture: Texture) => number
  texturePrewarm?: boolean
  prepareProgram?: MotionRendererFactoryContext['prepareProgram']
  motionProgram?: CardMotionProgram<TMeta>
  effectPrograms?: Readonly<Record<string, CardEffectProgramLoader>>
  atlasBackend?: CardAtlasBackend<TMeta>
  resolveContentKey?: (item: MotionItem<TMeta>) => string | number
}

export function resolveAtlasResolution(
  value: number | 'auto' | undefined,
  itemCount: number,
  customContent: boolean,
): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 64
  if (value === undefined && customContent) return 64
  return itemCount > 1024 ? 48 : 64
}

export function createItemFingerprints<TMeta>(
  items: readonly MotionItem<TMeta>[],
  options: CardRendererOptions<TMeta>,
): string[] {
  return items.map((item) => createItemFingerprint(item, options))
}

export function createItemFingerprint<TMeta>(
  item: MotionItem<TMeta>,
  options: CardRendererOptions<TMeta>,
): string {
  if (options.resolveContentKey) {
    const key = options.resolveContentKey(item)
    return `${item.id.length}:${item.id}|${key}`
  }
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

export function equalFingerprints(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index])
}

export function resolveAspectRatio(value: number | undefined): number {
  return Number.isFinite(value) ? Math.min(4, Math.max(0.25, value as number)) : 1
}
