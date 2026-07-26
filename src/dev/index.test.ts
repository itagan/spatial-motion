import {
  BufferGeometry,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
} from 'three'
import { describe, expect, it, vi } from 'vitest'
import { identityTransform } from '../core/math'
import { defineMotionRenderer } from '../renderers/MotionRenderer'
import { pointsRenderer } from '../renderers/points'
import { defineLayout } from '../layouts/defineLayout'
import {
  createLayoutDebugVisualization,
  validateLayout,
  validateMotionRenderer,
} from './index'

describe('development diagnostics', () => {
  it('validates layouts across defaults and reports overlaps without correcting output', () => {
    const layout = defineLayout({
      name: 'overlap',
      calculate: (count) => Array.from({ length: count }, () => identityTransform()),
    })
    const report = validateLayout(layout, {
      counts: [2],
      contexts: [{ width: 100, height: 100 }],
    })

    expect(report.valid).toBe(true)
    expect(report.samples.calculations).toBe(1)
    expect(report.samples.duplicatePositions).toBe(1)
    expect(report.warnings.map(({ code }) => code)).toContain('DUPLICATE_POSITION')
    expect(report.warnings.map(({ code }) => code)).toContain('POSSIBLE_OVERLAP')
  })

  it('turns layout exceptions and non-finite transforms into bounded errors', () => {
    const layout = {
      name: 'invalid',
      calculate: () => [{ ...identityTransform(), x: Number.NaN }],
    }
    const report = validateLayout(layout, {
      counts: [1],
      contexts: [{ width: 1, height: 1 }],
    })
    expect(report.valid).toBe(false)
    expect(report.errors[0]?.code).toBe('NON_FINITE_TRANSFORM')
  })

  it('exercises a built-in renderer and verifies disposal', async () => {
    const report = await validateMotionRenderer(pointsRenderer(), {
      items: [{ id: 'a' }, { id: 'b' }],
      cycles: 2,
    })
    expect(report.valid).toBe(true)
    expect(report.samples.cycles).toBe(2)
    expect(report.samples.peakObjects).toBe(2)
    expect(report.samples.finalInstanceCount).toBe(2)
  })

  it('reports invalid protocols and roots that remain after disposal', async () => {
    const factory = (
      () => ({ descriptor: { itemBounds: null }, capabilities: {} })
    ) as unknown as Parameters<typeof validateMotionRenderer>[0]
    const invalid = await validateMotionRenderer(factory)
    expect(invalid.valid).toBe(false)
    expect(invalid.errors[0]?.code).toBe('RENDERER_VALIDATION_FAILED')

    const leaking = defineMotionRenderer(({ root }) => {
      const geometry = new BufferGeometry()
      geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0], 3))
      root.add(new LineSegments(geometry, new LineBasicMaterial()))
      return {
        descriptor: { itemBounds: null },
        capabilities: {},
        async setItems() { return true },
        setTransforms() {},
        prepareTransition() {},
        setProgress() {},
        setVisibleRatio() {},
        getStats() { return { instanceCount: 1, submittedInstanceCount: 1 } },
        dispose() {},
      }
    })
    const report = await validateMotionRenderer(leaking)
    expect(report.valid).toBe(false)
    expect(report.errors.map(({ code }) => code)).toContain('OBJECTS_REMAIN_AFTER_DISPOSE')
  })

  it('creates one batched line visualization and disposes it idempotently', () => {
    const layout = defineLayout({
      name: 'debug',
      calculate: (count) => Array.from({ length: count }, (_value, index) => ({
        ...identityTransform(),
        x: index * 2,
      })),
    })
    const visualization = createLayoutDebugVisualization(layout, {
      count: 3,
      context: { width: 100, height: 100 },
    })
    const line = visualization.group.children[0] as LineSegments
    const disposeGeometry = vi.spyOn(line.geometry, 'dispose')
    const disposeMaterial = vi.spyOn(line.material as LineBasicMaterial, 'dispose')

    expect(visualization.group.children).toHaveLength(1)
    expect(visualization.report.valid).toBe(true)
    visualization.dispose()
    visualization.dispose()
    expect(disposeGeometry).toHaveBeenCalledOnce()
    expect(disposeMaterial).toHaveBeenCalledOnce()
    expect(visualization.group.children).toHaveLength(0)
  })
})
