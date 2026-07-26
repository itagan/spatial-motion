// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import type { CardContentDrawContext } from '../core/types'
import { html, resolveTemplate } from './compiler'
import { defineCardTemplate } from './renderer'
import { CardTemplateError } from './types'

function context() {
  const gradient = { addColorStop: vi.fn() }
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    rect: vi.fn(),
    roundRect: vi.fn(),
    fill: vi.fn(),
    clip: vi.fn(),
    stroke: vi.fn(),
    drawImage: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: text.length * 6 })),
    createLinearGradient: vi.fn(() => gradient),
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    gradient,
  }
}

function drawContext(
  canvasContext: ReturnType<typeof context>,
  images: ReadonlyMap<string, HTMLImageElement | null> = new Map(),
): CardContentDrawContext {
  return {
    context: canvasContext as unknown as CanvasRenderingContext2D,
    bounds: { x: 0, y: 0, width: 160, height: 100 },
    resolvedStyle: {},
    images,
  }
}

describe('card template', () => {
  it('caches static template structure and safely binds dynamic text', () => {
    const render = (title: string) => html`<div><span>${title}</span></div>`
    const first = render('One')
    const second = render('<img src="injected">')
    const symbol = Object.getOwnPropertySymbols(first)[0]
    const firstInternal = first as unknown as Record<PropertyKey, { blueprint: unknown }>
    const secondInternal = second as unknown as Record<PropertyKey, { blueprint: unknown }>
    expect(firstInternal[symbol].blueprint).toBe(secondInternal[symbol].blueprint)

    const renderer = defineCardTemplate((item) => render(item.title ?? ''))
    const prepared = renderer.prepare({ id: 'one', title: '<script>alert(1)</script>' }, {})
    const canvasContext = context()
    prepared.draw(drawContext(canvasContext))
    expect(canvasContext.fillText).toHaveBeenCalledWith('<script>alert(1)</script>', 0, 0)
  })

  it('reuses bounded text measurements while isolating width and font keys', () => {
    const renderer = defineCardTemplate((item) => html`
      <span style="font-size:12px;line-clamp:1">${item.title}</span>
    `)
    const prepared = renderer.prepare({ id: 'one', title: 'Repeated measurement' }, {})
    const canvasContext = context()
    const first = drawContext(canvasContext)
    prepared.draw(first)
    const callsAfterFirstDraw = canvasContext.measureText.mock.calls.length
    prepared.draw(first)
    expect(canvasContext.measureText.mock.calls.length).toBe(callsAfterFirstDraw)
    prepared.draw({ ...first, bounds: { ...first.bounds, width: 80 } })
    expect(canvasContext.measureText.mock.calls.length).toBeGreaterThan(callsAfterFirstDraw)
    expect(renderer.getMetrics?.()).toMatchObject({
      templateMeasurementCacheHits: expect.any(Number),
      templateMeasurementCacheMisses: expect.any(Number),
    })
    expect(renderer.getMetrics?.().templateMeasurementCacheEntries).toBeLessThanOrEqual(2048)
  })

  it('binds unquoted dynamic image attributes without treating them as markup', () => {
    expect(resolveTemplate(html`<img src=${'https://example.test/image.png'} />`)).toEqual([
      expect.objectContaining({
        tag: 'img',
        attributes: { src: 'https://example.test/image.png' },
      }),
    ])
  })

  it('supports nested conditions, arrays, helpers, scoped classes, and dynamic styles', () => {
    const renderer = defineCardTemplate<{ tags: string[]; featured: boolean }>(
      (item, { each, when, classNames }) => html`
        <div class=${classNames('root', item.meta?.featured && 'featured')}>
          ${when(item.image, () => html`
            <img src=${item.image} style=${{ height: '60%', objectFit: 'contain' }} />
          `)}
          ${each(item.meta?.tags, (tag) => html`<span class="tag">${tag}</span>`)}
        </div>
      `,
      {
        styles: {
          root: { display: 'flex', flexDirection: 'column', gap: 4 },
          featured: { border: '2px solid #ffd700' },
          tag: { fontSize: 12, lineClamp: 1 },
        },
      },
    )
    const prepared = renderer.prepare({
      id: 'one',
      image: 'https://example.test/image.png',
      meta: { tags: ['A', 'B'], featured: true },
    }, {})
    expect(prepared.imageSources).toEqual(['https://example.test/image.png'])
    const image = { naturalWidth: 200, naturalHeight: 100 } as HTMLImageElement
    const canvasContext = context()
    prepared.draw(drawContext(canvasContext, new Map([['https://example.test/image.png', image]])))
    expect(canvasContext.drawImage).toHaveBeenCalled()
    expect(canvasContext.fillText).toHaveBeenCalledWith('A', expect.any(Number), expect.any(Number))
    expect(canvasContext.fillText).toHaveBeenCalledWith('B', expect.any(Number), expect.any(Number))
    expect(canvasContext.stroke).toHaveBeenCalled()
  })

  it('draws absolute overlays, gradients, clipping, and ellipsized text', () => {
    const renderer = defineCardTemplate((item) => html`
      <div style="background:linear-gradient(90deg, rgba(17,24,39,.8), #4f46e5);overflow:hidden;border-radius:12px">
        <span style="position:absolute;left:8px;right:8px;bottom:6px;height:18px;font-size:14px;line-clamp:1">
          ${item.title}
        </span>
      </div>
    `)
    const prepared = renderer.prepare({ id: 'one', title: 'A very long title for a narrow card' }, {})
    const canvasContext = context()
    prepared.draw(drawContext(canvasContext))
    expect(canvasContext.createLinearGradient).toHaveBeenCalled()
    expect(canvasContext.gradient.addColorStop).toHaveBeenCalledTimes(2)
    expect(canvasContext.clip).toHaveBeenCalled()
    expect(canvasContext.fillText.mock.calls.at(-1)?.[0]).toMatch(/…$/)
  })

  it('reports unsupported markup and inline styles and lets the caller fall back', () => {
    const onError = vi.fn()
    const invalidTag = defineCardTemplate(() => html`<button>Click</button>`, { onError })
    expect(() => invalidTag.prepare({ id: 'one' }, {})).toThrowError(CardTemplateError)
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'UNSUPPORTED_TAG' }),
      { id: 'one' },
    )

    const invalidStyle = defineCardTemplate(() => html`<div style="transform:scale(2)"></div>`, { onError })
    const prepared = invalidStyle.prepare({ id: 'two' }, {})
    expect(() => prepared.draw(drawContext(context()))).toThrowError(
      expect.objectContaining({ code: 'UNSUPPORTED_STYLE' }),
    )

    const invalidAttribute = defineCardTemplate(() => html`<img src=${{ color: 'red' }} />`, { onError })
    expect(() => invalidAttribute.prepare({ id: 'three' }, {})).toThrowError(
      expect.objectContaining({ code: 'INVALID_VALUE' }),
    )
  })

  it('formats helper values without exposing executable HTML', () => {
    const renderer = defineCardTemplate<{ score: number; date: string }>((item, helpers) => html`
      <div>
        <span>${helpers.formatNumber(item.meta?.score ?? 0)}</span>
        <span>${helpers.formatDate(item.meta?.date ?? 0, { year: 'numeric' }, 'en-US')}</span>
        <span>${helpers.truncate('abcdef', 4)}</span>
      </div>
    `)
    const prepared = renderer.prepare({
      id: 'one',
      meta: { score: 1234, date: '2020-01-01T00:00:00Z' },
    }, {})
    const canvasContext = context()
    prepared.draw(drawContext(canvasContext))
    expect(canvasContext.fillText.mock.calls.map((call) => call[0])).toEqual(
      expect.arrayContaining(['1,234', '2020', 'abc…']),
    )
  })
})
