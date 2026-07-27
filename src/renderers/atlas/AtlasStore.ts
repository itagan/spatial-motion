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
  let uploadRanges = 0
  let runY = -1
  let runStart = 0
  let runEnd = 0
  const cells = patch.cells.length < 2
    ? patch.cells
    : patch.cells.slice().sort((left, right) => left.index - right.index)
  const rowLength = atlas.cellWidth * 4
  texture.clearUpdateRanges()
  for (const { index, canvas } of cells) {
    const x = (index % atlas.columns) * atlas.strideX + atlas.padding
    const y = Math.floor(index / atlas.columns) * atlas.strideY + atlas.padding
    const imageData = canvas.getContext('2d')
      ?.getImageData(0, 0, atlas.cellWidth, atlas.cellHeight)
    if (!imageData) throw new Error('Canvas 2D image data is unavailable')
    for (let row = 0; row < atlas.cellHeight; row += 1) {
      const sourceOffset = row * rowLength
      const targetOffset = ((y + row) * atlas.width + x) * 4
      atlas.data.set(
        imageData.data.subarray(sourceOffset, sourceOffset + rowLength),
        targetOffset,
      )
    }
    if (atlas.initialized) {
      if (y === runY && x <= runEnd + atlas.padding * 2) {
        runEnd = x + atlas.cellWidth
      } else {
        if (runY >= 0) {
          uploadBytes += addUploadRun(texture, atlas, runY, runStart, runEnd)
          uploadRanges += atlas.cellHeight
        }
        runY = y
        runStart = x
        runEnd = x + atlas.cellWidth
      }
    }
  }
  if (!atlas.initialized) {
    uploadBytes = atlas.data.byteLength
    patch.metrics.uploadRanges = 1
  } else {
    if (runY >= 0) {
      uploadBytes += addUploadRun(texture, atlas, runY, runStart, runEnd)
      uploadRanges += atlas.cellHeight
    }
    patch.metrics.uploadRanges = uploadRanges
  }
  patch.metrics.uploadBytes = uploadBytes
  texture.needsUpdate = true
  return now() - startedAt
}

function addUploadRun(
  texture: DataTexture,
  atlas: TextureAtlasResult,
  y: number,
  start: number,
  end: number,
): number {
  const count = (end - start) * 4
  for (let row = 0; row < atlas.cellHeight; row += 1) {
    texture.addUpdateRange(((y + row) * atlas.width + start) * 4, count)
  }
  return count * atlas.cellHeight
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
