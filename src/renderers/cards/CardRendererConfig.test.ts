import { describe, expect, it, vi } from 'vitest'
import {
  createItemFingerprint,
  createItemFingerprints,
  equalFingerprints,
  resolveAspectRatio,
  resolveAtlasResolution,
} from './CardRendererConfig'

describe('CardRendererConfig', () => {
  it('resolves explicit, custom-content, and automatic Atlas sizes', () => {
    expect(resolveAtlasResolution(72, 2_000, false)).toBe(72)
    expect(resolveAtlasResolution(Number.NaN, 2_000, false)).toBe(64)
    expect(resolveAtlasResolution(undefined, 2_000, true)).toBe(64)
    expect(resolveAtlasResolution('auto', 1_024, false)).toBe(64)
    expect(resolveAtlasResolution('auto', 1_025, false)).toBe(48)
  })

  it('normalizes card aspect ratios into the supported range', () => {
    expect(resolveAspectRatio(undefined)).toBe(1)
    expect(resolveAspectRatio(Number.NaN)).toBe(1)
    expect(resolveAspectRatio(0.1)).toBe(0.25)
    expect(resolveAspectRatio(2)).toBe(2)
    expect(resolveAspectRatio(8)).toBe(4)
  })

  it('fingerprints every visual input without delimiter collisions', () => {
    const base = createItemFingerprint(
      { id: '1|2', image: '3', title: '4', meta: { active: true } },
      { resolveCardStyle: () => ({ borderColor: '#fff' }) },
    )
    const changed = createItemFingerprint(
      { id: '1', image: '2|3', title: '4', meta: { active: true } },
      { resolveCardStyle: () => ({ borderColor: '#fff' }) },
    )

    expect(base).not.toBe(changed)
  })

  it('uses a supplied content revision without serializing meta or style', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    const resolveCardStyle = vi.fn(() => {
      throw new Error('style should not be read')
    })
    const options = {
      resolveContentKey: () => 7,
      resolveCardStyle,
    }

    expect(createItemFingerprint({ id: 'card', meta: circular }, options)).toBe('4:card|7')
    expect(resolveCardStyle).not.toHaveBeenCalled()
  })

  it('creates and compares ordered fingerprint sets', () => {
    const items = [{ id: 'a' }, { id: 'b', title: 'B' }]
    const fingerprints = createItemFingerprints(items, {})

    expect(equalFingerprints(fingerprints, [...fingerprints])).toBe(true)
    expect(equalFingerprints(fingerprints, [...fingerprints].reverse())).toBe(false)
    expect(equalFingerprints(fingerprints, fingerprints.slice(0, 1))).toBe(false)
  })
})
