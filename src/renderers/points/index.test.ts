import { BufferAttribute, BufferGeometry, Group, Points, ShaderMaterial } from 'three'
import { describe, expect, it, vi } from 'vitest'
import type { MotionItem, Transform } from '../../core/types'
import { pointsRenderer } from './index'

function items(count: number): MotionItem[] {
  return Array.from({ length: count }, (_value, index) => ({
    id: `item-${index}`,
    meta: { color: index % 2 ? '#22d3ee' : '#f43f5e' },
  }))
}

function transform(overrides: Partial<Transform> = {}): Transform {
  return {
    x: 0,
    y: 0,
    z: 0,
    scale: 1,
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,
    opacity: 1,
    ...overrides,
  }
}

function createRenderer(options = {}) {
  const root = new Group()
  const controller = new AbortController()
  const renderer = pointsRenderer(options)({
    root,
    maxTextureSize: 4096,
    maxAnisotropy: 4,
    signal: controller.signal,
  })
  const points = root.children[0] as Points<BufferGeometry, ShaderMaterial>
  return { controller, points, renderer, root }
}

describe('pointsRenderer', () => {
  it.each([500, 1000, 2000])('keeps one Points object and material for %i items', async (count) => {
    const { points, renderer, root } = createRenderer()
    const material = points.material
    await expect(renderer.setItems(items(count))).resolves.toBe(true)
    expect(root.children).toEqual([points])
    expect(points.material).toBe(material)
    expect(points.geometry.drawRange.count).toBe(count)
    expect(renderer.getStats()).toMatchObject({
      instanceCount: count,
      submittedInstanceCount: count,
    })
    expect(renderer.getStats().gpuBytes).toBeGreaterThan(0)
  })

  it('replaces and disposes only the active geometry when capacity changes', async () => {
    const { points, renderer, root } = createRenderer()
    await renderer.setItems(items(500))
    const previous = points.geometry
    const dispose = vi.spyOn(previous, 'dispose')
    await renderer.setItems(items(1000))
    expect(dispose).toHaveBeenCalledOnce()
    expect(points.geometry).not.toBe(previous)
    expect(root.children).toHaveLength(1)
  })

  it('reuses geometry and transition attributes inside the same capacity bucket', async () => {
    const { points, renderer } = createRenderer()
    await renderer.setItems(items(3))
    const geometry = points.geometry
    const material = points.material
    const fromPosition = geometry.getAttribute('fromPosition')
    renderer.prepareTransition(
      Array.from({ length: 3 }, () => transform()),
      Array.from({ length: 3 }, () => transform({ x: 1 })),
    )
    await renderer.setItems(items(4))
    renderer.prepareTransition(
      Array.from({ length: 4 }, () => transform()),
      Array.from({ length: 4 }, () => transform({ y: 1 })),
    )
    expect(points.geometry).toBe(geometry)
    expect(points.material).toBe(material)
    expect(geometry.getAttribute('fromPosition')).toBe(fromPosition)
    expect(renderer.getStats().metrics).toMatchObject({
      capacity: 4,
      geometryBuilds: 1,
    })
  })

  it('patches only colors without replacing geometry', async () => {
    const { points, renderer } = createRenderer({
      resolveColor: (item: MotionItem) => (item.meta as { color: string }).color,
    })
    const initial = items(3)
    await renderer.setItems(initial)
    const geometry = points.geometry
    const colors = geometry.getAttribute('itemColor') as BufferAttribute
    const before = Array.from(colors.array)
    const next = initial.map((item) => ({ ...item, meta: { ...item.meta as object } }))
    next[1].meta = { color: '#ffffff' }
    await renderer.capabilities.patch?.updateItems(next, [1])
    expect(points.geometry).toBe(geometry)
    expect(Array.from(colors.array).slice(0, 3)).toEqual(before.slice(0, 3))
    expect(Array.from(colors.array).slice(6)).toEqual(before.slice(6))
    expect(Array.from(colors.array).slice(3, 6)).not.toEqual(before.slice(3, 6))
  })

  it('uses stable id colors and updates transition, viewport, visibility, and hover uniforms', async () => {
    const { points, renderer } = createRenderer({ size: 0.8 })
    const data = items(2)
    await renderer.setItems(data)
    const firstColors = Array.from((points.geometry.getAttribute('itemColor') as BufferAttribute).array)
    await renderer.setItems(data)
    expect(Array.from((points.geometry.getAttribute('itemColor') as BufferAttribute).array)).toEqual(firstColors)

    renderer.prepareTransition(
      [transform(), transform()],
      [transform({ x: 1 }), transform({ y: 1 })],
    )
    renderer.capabilities.visual?.prepareVisualTransition(
      { billboard: 0, hideBackHemisphere: 0, hemisphereEdgeFade: 0 },
      { billboard: 1, hideBackHemisphere: 1, hemisphereEdgeFade: 0.1 },
    )
    renderer.setProgress(0.5)
    renderer.setVisibleRatio(0.4)
    renderer.capabilities.highlight?.setHighlightIndex(1)
    renderer.capabilities.viewport?.resize({ width: 800, height: 600, pixelRatio: 2 })

    expect(renderer.descriptor.itemBounds).toEqual({
      kind: 'disc',
      diameter: 0.8,
      facing: 'camera',
    })
    expect(renderer.capabilities.streamingEffects).toBeUndefined()
    expect(points.material.uniforms).toMatchObject({
      progress: { value: 0.5 },
      visibleRatio: { value: 0.4 },
      hoverIndex: { value: 1 },
      viewportHeight: { value: 1200 },
      toHideBackHemisphere: { value: 1 },
      toHemisphereEdgeFade: { value: 0.1 },
    })
  })

  it('disposes on abort and ignores subsequent async-style work', async () => {
    const { controller, points, renderer, root } = createRenderer()
    await renderer.setItems(items(3))
    const disposeGeometry = vi.spyOn(points.geometry, 'dispose')
    const disposeMaterial = vi.spyOn(points.material, 'dispose')
    controller.abort()
    expect(root.children).toHaveLength(0)
    expect(disposeGeometry).toHaveBeenCalledOnce()
    expect(disposeMaterial).toHaveBeenCalledOnce()
    await expect(renderer.setItems(items(4))).resolves.toBe(false)
    expect(renderer.getStats()).toMatchObject({
      instanceCount: 0,
      submittedInstanceCount: 0,
      gpuBytes: 0,
    })
  })
})
