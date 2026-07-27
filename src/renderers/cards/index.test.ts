import { Group } from 'three'
import { describe, expect, it } from 'vitest'
import { cardsRenderer } from './index'
import { defineCardEffectProgram } from './programs'

describe('cardsRenderer', () => {
  it('rejects ambiguous content renderers before allocating resources', () => {
    expect(() => cardsRenderer({
      content: { prepare: () => ({ draw: () => {} }) },
      draw: () => {},
    })).toThrow(TypeError)
  })

  it('normalizes the shared aspect ratio in the renderer descriptor', () => {
    const controller = new AbortController()
    const renderer = cardsRenderer({ aspectRatio: 10 })({
      root: new Group(),
      maxTextureSize: 4096,
      maxTextureLayers: 256,
      maxAnisotropy: 8,
      signal: controller.signal,
      prepareTexture: () => 0,
    })
    expect(renderer.descriptor.itemBounds).toMatchObject({
      kind: 'quad',
      width: 1,
      height: 0.25,
    })
    renderer.dispose()
  })

  it('rejects a synchronously registered Program under a different kind', () => {
    const program = defineCardEffectProgram({
      kind: 'actual',
      prefix: 'program_actual_',
      vertexBody: 'center.x += 0.0;',
      upload() {},
    })
    expect(() => cardsRenderer({
      effectPrograms: { alias: program },
    })).toThrow(/mismatched kind/)
  })
})
