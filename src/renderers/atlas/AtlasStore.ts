import type {
  TextureAtlasPatch,
  TextureAtlasResult,
} from '../textureAtlas.js'
import { DataTexture } from 'three'

export function applyAtlasPatch(
  atlas: TextureAtlasResult,
  patch: TextureAtlasPatch,
): number {
  const startedAt = now()
  const texture = atlas.texture as DataTexture
  let uploadBytes = 0
  const rangesByRow = new Map<number, Array<{ start: number; end: number }>>()
  patch.cells
    .slice()
    .sort((left, right) => left.index - right.index)
    .forEach(({ index, canvas }) => {
      const x = (index % atlas.columns) * atlas.strideX + atlas.padding
      const y = Math.floor(index / atlas.columns) * atlas.strideY + atlas.padding
      const context = canvas.getContext('2d')
      const imageData = context?.getImageData(0, 0, atlas.cellWidth, atlas.cellHeight)
      if (!imageData) throw new Error('Canvas 2D image data is unavailable')
      for (let row = 0; row < atlas.cellHeight; row += 1) {
        const sourceOffset = row * atlas.cellWidth * 4
        const targetOffset = ((y + row) * atlas.width + x) * 4
        const rowLength = atlas.cellWidth * 4
        atlas.data.set(
          imageData.data.subarray(sourceOffset, sourceOffset + rowLength),
          targetOffset,
        )
        if (atlas.initialized) {
          const atlasRow = y + row
          const ranges = rangesByRow.get(atlasRow) ?? []
          ranges.push({ start: targetOffset, end: targetOffset + rowLength })
          rangesByRow.set(atlasRow, ranges)
        }
      }
    })
  if (!atlas.initialized) {
    texture.clearUpdateRanges()
    uploadBytes = atlas.data.byteLength
    patch.metrics.uploadRanges = 1
  } else {
    texture.clearUpdateRanges()
    let uploadRanges = 0
    rangesByRow.forEach((ranges) => {
      let current = ranges[0]
      ranges.slice(1).forEach((range) => {
        if (range.start <= current.end + atlas.padding * 8) {
          current.end = Math.max(current.end, range.end)
          return
        }
        texture.addUpdateRange(current.start, current.end - current.start)
        uploadBytes += current.end - current.start
        uploadRanges += 1
        current = range
      })
      texture.addUpdateRange(current.start, current.end - current.start)
      uploadBytes += current.end - current.start
      uploadRanges += 1
    })
    patch.metrics.uploadRanges = uploadRanges
  }
  patch.metrics.uploadBytes = uploadBytes
  texture.needsUpdate = true
  return now() - startedAt
}

export function drawPatchToCanvas(
  context: CanvasRenderingContext2D,
  columns: number,
  cellWidth: number,
  cellHeight: number,
  padding: number,
  strideX: number,
  strideY: number,
  patch: TextureAtlasPatch,
): void {
  patch.cells.forEach(({ index, canvas: cellCanvas }) => {
    const x = (index % columns) * strideX + padding
    const y = Math.floor(index / columns) * strideY + padding
    context.clearRect(x, y, cellWidth, cellHeight)
    context.drawImage(cellCanvas, x, y)
  })
}

function now(): number {
  return globalThis.performance?.now() ?? Date.now()
}
