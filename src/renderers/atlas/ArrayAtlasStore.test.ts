import { DataArrayTexture } from 'three'
import { describe, expect, it, vi } from 'vitest'
import type { TextureAtlasResult } from '../textureAtlas'
import {
  applyArrayAtlasPatch,
  createArrayAtlasData,
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
    const patch = {
      cells: [{ index: 0, canvas }, { index: 4, canvas }],
      metrics: { uploadBytes: 0 } as TextureAtlasResult['metrics'],
    }

    applyArrayAtlasPatch(atlas, patch)

    expect(texture.layerUpdates).toEqual(new Set([0, 1]))
    expect(patch.metrics.uploadRanges).toBe(2)
    expect(patch.metrics.uploadBytes).toBe(8 * 8 * 2 * 4)
    expect(atlas.data[((8 - 1 - 1) * 8 + 1) * 4]).toBe(7)
  })
})
