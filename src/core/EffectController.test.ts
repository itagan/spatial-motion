import { describe, expect, it, vi } from 'vitest'
import type { StreamingEffect } from '../effects/types'
import { EffectController } from './EffectController'

function effect(kind: string): StreamingEffect {
  return {
    name: kind,
    kind,
    prepare: vi.fn(),
    calculateInto: vi.fn(),
    getGpuData: () => ({
      kind,
      activeCount: 0,
      payload: null,
    }),
  }
}

describe('EffectController', () => {
  it('reuses one SoA transform buffer for entry, active sampling, and reduced motion', async () => {
    const renderer = {
      enable: vi.fn(() => true),
      disable: vi.fn(),
      setTime: vi.fn(),
    }
    const controller = new EffectController(renderer)
    const bufferEffect: StreamingEffect = {
      name: 'buffer',
      kind: 'buffer',
      prepare: vi.fn(),
      calculateInto(count, elapsedSeconds, target) {
        target.resize(count)
        for (let index = 0; index < count; index += 1) {
          target.setValues(index, elapsedSeconds + index, 0, 0, 1, 0, 0, 0, 1)
        }
      },
      getGpuData: () => ({ kind: 'buffer', activeCount: 2, payload: null }),
    }

    const entry = controller.prepare(bufferEffect, 2, 2)
    const positions = entry.positions
    expect(Array.from(entry.positions.slice(0, 6))).toEqual([0, 0, 0, 1, 0, 0])
    await expect(controller.activate(bufferEffect, 0)).resolves.toBe(true)
    const active = controller.resolveBuffer(2, 500, false)
    expect(active).toBe(entry)
    expect(active?.positions).toBe(positions)
    expect(active?.positions[0]).toBe(0.5)
    expect(controller.settleReducedMotion(2)).toBe(entry)
    expect(entry.positions[0]).toBe(0)
  })

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
