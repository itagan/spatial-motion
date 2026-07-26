import { DataArrayTexture } from 'three'
import { describe, expect, it, vi } from 'vitest'
import type { TextureAtlasPatch, TextureAtlasResult } from '../textureAtlas'
import {
  applyArrayAtlasPatch,
  createArrayAtlasData,
  createArrayAtlasLayout,
  createArrayAtlasPatcher,
  resolveArrayAtlasPageSize,
} from './ArrayAtlasStore'

describe('ArrayAtlasStore', () => {
  it('chooses the smallest balanced page that fits the device layer limit', () => {
    expect(resolveArrayAtlasPageSize(2000, {
      sourceWidth: 48 * 45,
      sourceHeight: 48 * 45,
      sourceColumns: 45,
      sourceStrideX: 48,
      sourceStrideY: 48,
      maxTextureLayers: 256,
    })).toEqual({ columns: 2, rows: 4 })
    expect(resolveArrayAtlasPageSize(2000, {
      sourceWidth: 64 * 45,
      sourceHeight: 36 * 45,
      sourceColumns: 45,
      sourceStrideX: 64,
      sourceStrideY: 36,
      maxTextureLayers: 256,
    })).toEqual({ columns: 2, rows: 4 })
    expect(resolveArrayAtlasPageSize(2000, {
      sourceWidth: 36 * 45,
      sourceHeight: 64 * 45,
      sourceColumns: 45,
      sourceStrideX: 36,
      sourceStrideY: 64,
      maxTextureLayers: 256,
    })).toEqual({ columns: 4, rows: 2 })
  })

  it('repacks fixed-size pages, flips rows, and assigns stable layers', () => {
    const sourceWidth = 12
    const sourceHeight = 8
    const source = new Uint8Array(sourceWidth * sourceHeight * 4)
    for (let index = 0; index < 5; index += 1) {
      const sourceX = (index % 3) * 4
      const sourceY = Math.floor(index / 3) * 4
      source[((sourceY + 1) * sourceWidth + sourceX + 1) * 4] = index + 1
    }

    const result = createArrayAtlasData(source, 5, {
      sourceWidth,
      sourceColumns: 3,
      sourceStrideX: 4,
      sourceStrideY: 4,
      cellWidth: 2,
      cellHeight: 2,
      padding: 1,
      pageColumns: 2,
      pageRows: 2,
      maxTextureLayers: 2,
    })

    expect(result).not.toBeNull()
    expect(result).toMatchObject({
      width: 8,
      height: 8,
      depth: 2,
      pageColumns: 2,
      pageRows: 2,
    })
    expect(Array.from(result!.rects.filter((_value, index) => index % 4 === 0).map(Math.floor)))
      .toEqual([0, 0, 0, 0, 1])
    expect(Array.from(result!.rects.slice(0, 4))).toEqual([0.125, 0.625, 0.25, 0.25])
    expect(result!.rects[16]).toBe(1.125)
    const firstContentOffset = ((8 - 1 - 1) * 8 + 1) * 4
    const fifthContentOffset = 8 * 8 * 4 + ((8 - 1 - 1) * 8 + 1) * 4
    expect(result!.data[firstContentOffset]).toBe(1)
    expect(result!.data[fifthContentOffset]).toBe(5)
  })

  it('shares stable page dimensions and rects with direct page rasterization', () => {
    const layout = createArrayAtlasLayout(17, {
      sourceWidth: 20,
      sourceHeight: 16,
      sourceColumns: 5,
      sourceStrideX: 4,
      sourceStrideY: 4,
      cellWidth: 2,
      cellHeight: 2,
      padding: 1,
      maxTextureLayers: 2,
    })

    expect(layout).toMatchObject({
      width: 12,
      height: 12,
      depth: 2,
      pageColumns: 3,
      pageRows: 3,
      pageCapacity: 9,
      layerByteLength: 12 * 12 * 4,
    })
    expect(Array.from(layout!.rects.filter((_value, index) => index % 4 === 0).map(Math.floor)))
      .toEqual([
        0, 0, 0, 0, 0, 0, 0, 0, 0,
        1, 1, 1, 1, 1, 1, 1, 1,
      ])
  })

  it('honors an explicit page size that exceeds the device layer limit', () => {
    expect(createArrayAtlasData(new Uint8Array(4 * 4 * 4), 5, {
      sourceWidth: 4,
      sourceColumns: 1,
      sourceStrideX: 4,
      sourceStrideY: 4,
      cellWidth: 2,
      cellHeight: 2,
      padding: 1,
      pageColumns: 2,
      pageRows: 2,
      maxTextureLayers: 1,
    })).toBeNull()
  })

  it('updates only affected array layers', () => {
    const texture = new DataArrayTexture(new Uint8Array(8 * 8 * 2 * 4), 8, 8, 2)
    const atlas = {
      texture,
      mode: 'array',
      rects: new Float32Array(20),
      width: 8,
      height: 8,
      depth: 2,
      data: texture.image.data as Uint8Array,
      columns: 2,
      rows: 2,
      cellSize: 2,
      cellWidth: 2,
      cellHeight: 2,
      padding: 1,
      stride: 4,
      strideX: 4,
      strideY: 4,
      mipmaps: false,
      initialized: true,
      metrics: {} as TextureAtlasResult['metrics'],
    } satisfies TextureAtlasResult
    const pixels = new Uint8ClampedArray(2 * 2 * 4)
    pixels.fill(7)
    const canvas = {
      getContext: vi.fn(() => ({
        getImageData: vi.fn(() => ({ data: pixels })),
      })),
    } as unknown as HTMLCanvasElement
    const patch: TextureAtlasPatch = {
      cells: [{ index: 0, canvas }, { index: 4, canvas }],
      metrics: { uploadBytes: 0 } as TextureAtlasResult['metrics'],
    }

    applyArrayAtlasPatch(atlas, patch)

    expect(texture.layerUpdates).toEqual(new Set([0, 1]))
    expect(patch.metrics.uploadRanges).toBe(2)
    expect(patch.metrics.uploadBytes).toBe(8 * 8 * 2 * 4)
    expect(atlas.data[((8 - 1 - 1) * 8 + 1) * 4]).toBe(7)
  })

  it('can defer GPU layer updates while retaining patched CPU data', () => {
    const texture = new DataArrayTexture(new Uint8Array(8 * 8 * 2 * 4), 8, 8, 2)
    const atlas = {
      texture,
      mode: 'array',
      rects: new Float32Array(8),
      width: 8,
      height: 8,
      depth: 2,
      data: texture.image.data as Uint8Array,
      columns: 2,
      rows: 2,
      cellSize: 2,
      cellWidth: 2,
      cellHeight: 2,
      padding: 1,
      stride: 4,
      strideX: 4,
      strideY: 4,
      mipmaps: false,
      initialized: true,
      metrics: {} as TextureAtlasResult['metrics'],
    } satisfies TextureAtlasResult
    const pixels = new Uint8ClampedArray(2 * 2 * 4)
    pixels.fill(9)
    const canvas = {
      getContext: vi.fn(() => ({
        getImageData: vi.fn(() => ({ data: pixels })),
      })),
    } as unknown as HTMLCanvasElement
    const patch: TextureAtlasPatch = {
      cells: [{ index: 4, canvas }],
      metrics: { uploadBytes: 0 } as TextureAtlasResult['metrics'],
    }

    applyArrayAtlasPatch(atlas, patch, true)

    expect(texture.layerUpdates).toEqual(new Set())
    expect(texture.version).toBe(0)
    expect(atlas.data[(8 * 8 * 4) + ((8 - 1 - 1) * 8 + 1) * 4]).toBe(9)
  })

  it('deduplicates visible patches and leaves hidden layers for sequential upload', () => {
    const texture = new DataArrayTexture(new Uint8Array(8 * 8 * 2 * 4), 8, 8, 2)
    const atlas = {
      texture,
      mode: 'array',
      rects: new Float32Array(8),
      width: 8,
      height: 8,
      depth: 2,
      data: texture.image.data as Uint8Array,
      columns: 2,
      rows: 2,
      cellSize: 2,
      cellWidth: 2,
      cellHeight: 2,
      padding: 1,
      stride: 4,
      strideX: 4,
      strideY: 4,
      mipmaps: false,
      initialized: true,
      metrics: {} as TextureAtlasResult['metrics'],
    } satisfies TextureAtlasResult
    const pixels = new Uint8ClampedArray(2 * 2 * 4)
    const canvas = {
      getContext: vi.fn(() => ({
        getImageData: vi.fn(() => ({ data: pixels })),
      })),
    } as unknown as HTMLCanvasElement
    const patch = (): TextureAtlasPatch => ({
      cells: [{ index: 0, canvas }, { index: 0, canvas }, { index: 4, canvas }],
      metrics: { uploadBytes: 0 } as TextureAtlasResult['metrics'],
    })
    const patcher = createArrayAtlasPatcher()
    const first = patch()
    const repeated = patch()

    patcher.apply(atlas, first, 1)
    patcher.apply(atlas, repeated, 1)

    expect(first.metrics).toMatchObject({ uploadRanges: 1, uploadBytes: 8 * 8 * 4 })
    expect(repeated.metrics).toMatchObject({ uploadRanges: 0, uploadBytes: 0 })
    expect(texture.layerUpdates).toEqual(new Set())
    expect(patcher.advance(atlas, 1, 1)).toEqual([1, true])
    expect(texture.layerUpdates).toEqual(new Set([0]))
    texture.layerUpdates.clear()
    expect(patcher.advance(atlas, 1, 1)).toEqual([2, true])
    expect(texture.layerUpdates).toEqual(new Set([1]))
  })
})
