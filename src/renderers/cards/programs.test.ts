import { describe, expect, it, vi } from 'vitest'
import {
  defineCardEffectProgram,
  defineCardMotionProgram,
} from './programs'

describe('Cards programs', () => {
  it('defines constrained motion and effect programs', () => {
    const motion = defineCardMotionProgram({
      kind: 'float',
      prefix: 'program_float_',
      uniforms: [{ name: 'program_float_amount', type: 'float', initialValue: 0.5 }],
      vertexBody: 'center.y += program_float_amount;',
    })
    const upload = vi.fn()
    const effect = defineCardEffectProgram({
      kind: 'custom-wave',
      prefix: 'program_wave_',
      attributes: [{ name: 'program_wave_phase', itemSize: 1 }],
      uniforms: [{ name: 'program_wave_time', type: 'float' }],
      clockUniform: 'program_wave_time',
      vertexBody: 'center.x += program_wave_phase;',
      upload,
    })

    expect(motion.type).toBe('motion')
    expect(effect.type).toBe('effect')
    expect(effect.clockUniform).toBe('program_wave_time')
    expect(Object.isFrozen(effect)).toBe(true)
  })

  it.each([
    () => defineCardMotionProgram({
      kind: 'bad kind',
      prefix: 'program_bad_',
      vertexBody: 'center.x += 1.0;',
    }),
    () => defineCardMotionProgram({
      kind: 'bad-prefix',
      prefix: 'program_bad',
      vertexBody: 'center.x += 1.0;',
    }),
    () => defineCardMotionProgram({
      kind: 'reserved',
      prefix: 'program_reserved_',
      attributes: [{ name: 'position', itemSize: 3 }],
      vertexBody: 'center.x += 1.0;',
    }),
    () => defineCardMotionProgram({
      kind: 'duplicate',
      prefix: 'program_duplicate_',
      attributes: [{ name: 'program_duplicate_value', itemSize: 1 }],
      uniforms: [{ name: 'program_duplicate_value', type: 'float' }],
      vertexBody: 'center.x += 1.0;',
    }),
    () => defineCardMotionProgram({
      kind: 'empty',
      prefix: 'program_empty_',
      vertexBody: ' ',
    }),
  ])('rejects an invalid contract', (define) => {
    expect(define).toThrow(TypeError)
  })

  it.each([
    {
      clockUniform: 'program_clock_missing',
      uniforms: [{ name: 'program_clock_time', type: 'float' as const }],
    },
    {
      clockUniform: 'program_clock_value',
      uniforms: [{ name: 'program_clock_value', type: 'vec2' as const }],
    },
  ])('rejects an invalid effect clock binding', ({ clockUniform, uniforms }) => {
    expect(() => defineCardEffectProgram({
      kind: 'clock',
      prefix: 'program_clock_',
      uniforms,
      clockUniform,
      vertexBody: 'center.x += 1.0;',
      upload() {},
    })).toThrow(TypeError)
  })
})
