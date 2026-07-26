import { Group } from 'three'
import { describe, expect, it } from 'vitest'
import { cardsRenderer } from './index'

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
})
