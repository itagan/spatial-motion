import { describe, expect, it, vi } from 'vitest'
import type { StreamingEffect } from '../effects/types'
import { EffectController } from './EffectController'

function effect(kind: string): StreamingEffect {
  return {
    name: kind,
    kind,
    prepare: vi.fn(),
    calculateTransforms: () => [],
    getGpuData: () => ({
      kind,
      activeCount: 0,
      payload: null,
    }),
  }
}

describe('EffectController', () => {
  it('negotiates renderer-defined effect keys and falls back without activation', async () => {
    const enable = vi.fn()
    const renderer = {
      enable: vi.fn((data: { kind: string }) => {
        enable(data)
        return data.kind === 'custom-gpu'
      }),
      disable: vi.fn(),
      setTime: vi.fn(),
    }
    const controller = new EffectController(renderer)

    expect(await controller.activate(effect('unsupported'), 0)).toBe(false)
    expect(controller.hasActive()).toBe(false)
    expect(enable).toHaveBeenCalledOnce()

    expect(await controller.activate(effect('custom-gpu'), 0)).toBe(true)
    expect(controller.getName()).toBe('custom-gpu')
    expect(enable).toHaveBeenCalledTimes(2)
  })

  it('ignores a slow activation after a newer effect wins', async () => {
    let resolveSlow!: (value: boolean) => void
    const slow = new Promise<boolean>((resolve) => { resolveSlow = resolve })
    const renderer = {
      enable: vi.fn(({ kind }: { kind: string }) => kind === 'slow' ? slow : true),
      disable: vi.fn(),
      setTime: vi.fn(),
    }
    const controller = new EffectController(renderer)
    const first = controller.activate(effect('slow'), 0)
    await expect(controller.activate(effect('fast'), 1)).resolves.toBe(true)
    resolveSlow(true)

    await expect(first).resolves.toBe(false)
    expect(controller.getName()).toBe('fast')
  })

  it('reports activation failures and keeps a static fallback state', async () => {
    const onError = vi.fn()
    const controller = new EffectController({
      enable: async () => { throw new Error('compile failed') },
      disable: vi.fn(),
      setTime: vi.fn(),
    }, onError)

    await expect(controller.activate(effect('broken'), 0)).resolves.toBe(false)
    expect(controller.hasActive()).toBe(false)
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      effect: 'broken',
      phase: 'activate',
    }))
  })

  it('invalidates a pending activation when quality is reconfigured', async () => {
    let resolve!: (value: boolean) => void
    const pending = new Promise<boolean>((complete) => { resolve = complete })
    const renderer = {
      enable: vi.fn(() => pending),
      disable: vi.fn(),
      setTime: vi.fn(),
    }
    const controller = new EffectController(renderer)
    const activating = controller.activate(effect('slow'), 0)

    await expect(controller.reconfigure(100, 20, 1, false)).resolves.toBe(false)
    resolve(true)
    await expect(activating).resolves.toBe(false)
    expect(renderer.disable).toHaveBeenCalledOnce()
  })
})
