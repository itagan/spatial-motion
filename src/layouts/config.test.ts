import { describe, expect, it } from 'vitest'
import type { Layout } from '../core/types'
import { box } from './box'
import { cone } from './cone'
import { createLayout, parseLayoutConfig, type LayoutConfig } from './config'
import { cylinder } from './cylinder'
import { grid } from './grid'
import { helix } from './helix'
import { ring } from './ring'
import { scatter } from './scatter'
import { sphere } from './sphere'

const context = { width: 1600, height: 900, viewportWidth: 16, viewportHeight: 9 }

const cases: Array<{ config: LayoutConfig; direct: Layout }> = [
  {
    config: { version: 1, type: 'sphere', options: { radius: 6, distribution: 'latitude', minLatitude: -1, maxLatitude: 1.2, poleMode: 'exclude', rings: 12, stagger: true, density: 0.7, orientation: 'surface' } },
    direct: sphere({ radius: 6, distribution: 'latitude', minLatitude: -1, maxLatitude: 1.2, poleMode: 'exclude', rings: 12, stagger: true, density: 0.7, orientation: 'surface' }),
  },
  {
    config: { version: 1, type: 'box', options: { width: 9, height: 7, depth: 5, density: 0.75, orientation: 'camera', faces: ['front', 'right'], edgePadding: 0.2, faceWeights: { front: 2, right: 1 } } },
    direct: box({ width: 9, height: 7, depth: 5, density: 0.75, orientation: 'camera', faces: ['front', 'right'], edgePadding: 0.2, faceWeights: { front: 2, right: 1 } }),
  },
  {
    config: { version: 1, type: 'cylinder', options: { radius: 4, spacing: 0.7, rows: 8, startAngle: 0.2, arcAngle: 2.5, density: 0.7, orientation: 'camera' } },
    direct: cylinder({ radius: 4, spacing: 0.7, rows: 8, startAngle: 0.2, arcAngle: 2.5, density: 0.7, orientation: 'camera' }),
  },
  {
    config: { version: 1, type: 'grid', options: { columns: 8, gap: 1.1, fit: 'contain' } },
    direct: grid({ columns: 8, gap: 1.1, fit: 'contain' }),
  },
  {
    config: { version: 1, type: 'ring', options: { innerRadius: 1, spacing: 0.5, rings: 6, startAngle: 0.4, orientation: 'tangent', density: 0.75, distribution: 'equal', stagger: false, clockwise: true } },
    direct: ring({ innerRadius: 1, spacing: 0.5, rings: 6, startAngle: 0.4, orientation: 'tangent', density: 0.75, distribution: 'equal', stagger: false, clockwise: true }),
  },
  {
    config: { version: 1, type: 'helix', options: { radius: 4, height: 8, turns: 3, startAngle: 0.2, clockwise: true, orientation: 'camera', density: 0.7 } },
    direct: helix({ radius: 4, height: 8, turns: 3, startAngle: 0.2, clockwise: true, orientation: 'camera', density: 0.7 }),
  },
  {
    config: { version: 1, type: 'cone', options: { radius: 4, topRadius: 1.5, height: 8, rings: 10, startAngle: 0.3, stagger: true, orientation: 'surface', density: 0.72 } },
    direct: cone({ radius: 4, topRadius: 1.5, height: 8, rings: 10, startAngle: 0.3, stagger: true, orientation: 'surface', density: 0.72 }),
  },
  {
    config: { version: 1, type: 'scatter', options: { direction: 'radial', distance: 12, depth: 8, spin: 4, spinMode: 'directional', layers: 5, scale: 0.3, opacity: 0.1, seed: 42 } },
    direct: scatter({ direction: 'radial', distance: 12, depth: 8, spin: 4, spinMode: 'directional', layers: 5, scale: 0.3, opacity: 0.1, seed: 42 }),
  },
]

describe('layout configuration', () => {
  it.each(cases)('creates the same $config.type layout as its direct factory', ({ config, direct }) => {
    const configured = createLayout(config)
    for (const count of [0, 1, 37, 500]) {
      expect(configured.calculate(count, context)).toEqual(direct.calculate(count, context))
    }
  })

  it.each(cases)('round-trips $config.type through JSON without resolving defaults', ({ config }) => {
    expect(parseLayoutConfig(JSON.stringify(config))).toEqual(config)
  })

  it('keeps omitted auto-calculated options omitted', () => {
    expect(parseLayoutConfig({ version: 1, type: 'sphere', options: { rings: undefined } }))
      .toEqual({ version: 1, type: 'sphere', options: {} })
    expect(parseLayoutConfig({ version: 1, type: 'cylinder' }))
      .toEqual({ version: 1, type: 'cylinder' })
  })

  it('preserves deterministic scatter output after serialization', () => {
    const config = parseLayoutConfig('{"version":1,"type":"scatter","options":{"seed":17,"direction":"random"}}')
    expect(createLayout(config).calculate(100, context)).toEqual(createLayout(config).calculate(100, context))
  })

  it.each([
    [{ version: 2, type: 'sphere' }, 'version'],
    [{ version: 1, type: 'unknown' }, 'type'],
    [{ version: 1, type: 'toString' }, 'type'],
    [{ version: 1, type: 'sphere', extra: true }, 'extra'],
    [{ version: 1, type: 'sphere', options: { radius: 0 } }, 'options.radius'],
    [{ version: 1, type: 'sphere', options: { minLatitude: 1, maxLatitude: 0 } }, 'options.minLatitude'],
    [{ version: 1, type: 'sphere', options: { distribution: 'fibonacci', rings: 12 } }, 'options.rings'],
    [{ version: 1, type: 'box', options: { width: -1 } }, 'options.width'],
    [{ version: 1, type: 'box', options: { faces: [] } }, 'options.faces'],
    [{ version: 1, type: 'box', options: { faces: ['front', 'front'] } }, 'options.faces.1'],
    [{ version: 1, type: 'box', options: { faceWeights: { diagonal: 1 } } }, 'options.faceWeights.diagonal'],
    [{ version: 1, type: 'box', options: { faces: ['front'], faceWeights: { front: 0 } } }, 'options.faceWeights'],
    [{ version: 1, type: 'cylinder', options: { columns: 2.5 } }, 'options.columns'],
    [{ version: 1, type: 'cylinder', options: { columns: 8, rows: 4 } }, 'options.rows'],
    [{ version: 1, type: 'cylinder', options: { arcAngle: Math.PI * 2 + 0.1 } }, 'options.arcAngle'],
    [{ version: 1, type: 'grid', options: { fit: 'stretch' } }, 'options.fit'],
    [{ version: 1, type: 'ring', options: { spacing: 0 } }, 'options.spacing'],
    [{ version: 1, type: 'helix', options: { turns: 0 } }, 'options.turns'],
    [{ version: 1, type: 'cone', options: { orientation: 'flat' } }, 'options.orientation'],
    [{ version: 1, type: 'cone', options: { radius: 4, topRadius: 5 } }, 'options.topRadius'],
    [{ version: 1, type: 'scatter', options: { opacity: 1.1 } }, 'options.opacity'],
    [{ version: 1, type: 'scatter', options: { layers: 0 } }, 'options.layers'],
  ] as const)('rejects invalid configuration at its field path', (value, path) => {
    expect(() => parseLayoutConfig(value)).toThrow(path)
  })

  it('rejects malformed JSON with a configuration error', () => {
    expect(() => parseLayoutConfig('{bad json')).toThrow('Invalid LayoutConfig at $')
  })
})
