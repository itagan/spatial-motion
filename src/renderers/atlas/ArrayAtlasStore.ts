import type {
  TextureAtlasPatch,
  TextureAtlasResult,
} from '../textureAtlas.js'

interface ArrayAtlasPlanOptions {
  sourceWidth: number
  sourceColumns: number
  sourceStrideX: number
  sourceStrideY: number
  cellWidth: number
  cellHeight: number
  padding: number
  pageColumns?: number
  pageRows?: number
  maxTextureLayers?: number
}

export interface ArrayAtlasLayout {
  rects: Float32Array
  width: number
  height: number
  depth: number
  pageColumns: number
  pageRows: number
  pageCapacity: number
  layerByteLength: number
}

export interface ArrayAtlasData {
  data: Uint8Array<ArrayBuffer>
  rects: Float32Array
  width: number
  height: number
  depth: number
  pageColumns: number
  pageRows: number
}

export function resolveArrayAtlasPageSize(
  itemCount: number,
  options: Pick<
    ArrayAtlasPlanOptions,
    'sourceWidth' | 'sourceColumns' | 'sourceStrideX' | 'sourceStrideY' | 'maxTextureLayers'
  > & { sourceHeight: number },
): { columns: number; rows: number } {
  const maxLayers = finiteInteger(options.maxTextureLayers, 256)
  const minimumCapacity = Math.max(1, Math.ceil(Math.max(1, itemCount) / maxLayers))
  const maxColumns = Math.max(1, Math.floor(options.sourceWidth / options.sourceStrideX))
  const maxRows = Math.max(1, Math.floor(options.sourceHeight / options.sourceStrideY))
  let fallback: PageCandidate | undefined
  let balanced: PageCandidate | undefined
  for (let columns = 1; columns <= Math.min(minimumCapacity, maxColumns); columns += 1) {
    const rows = Math.ceil(minimumCapacity / columns)
    if (rows > maxRows) continue
    const candidate = pageCandidate(columns, rows, options.sourceStrideX, options.sourceStrideY)
    if (!fallback || comparePageCandidates(candidate, fallback) < 0) fallback = candidate
    if (
      candidate.aspect >= 0.5
      && candidate.aspect <= 2
      && (!balanced || comparePageCandidates(candidate, balanced) < 0)
    ) balanced = candidate
  }
  const selected = balanced ?? fallback
  if (!selected) return { columns: options.sourceColumns, rows: maxRows }
  return { columns: selected.columns, rows: selected.rows }
}

export function createArrayAtlasData(
  source: Uint8Array | Uint8ClampedArray,
  itemCount: number,
  options: ArrayAtlasPlanOptions,
): ArrayAtlasData | null {
  const sourceHeight = source.byteLength / 4 / options.sourceWidth
  const layout = createArrayAtlasLayout(itemCount, {
    ...options,
    sourceHeight,
  })
  if (!layout) return null
  const data = new Uint8Array(layout.layerByteLength * layout.depth)

  for (let index = 0; index < itemCount; index += 1) {
    const sourceX = (index % options.sourceColumns) * options.sourceStrideX
    const sourceY = Math.floor(index / options.sourceColumns) * options.sourceStrideY
    const pageIndex = Math.floor(index / layout.pageCapacity)
    const pageSlot = index % layout.pageCapacity
    const targetX = (pageSlot % layout.pageColumns) * options.sourceStrideX
    const targetY = Math.floor(pageSlot / layout.pageColumns) * options.sourceStrideY
    for (let row = 0; row < options.sourceStrideY; row += 1) {
      const sourceOffset = ((sourceY + row) * options.sourceWidth + sourceX) * 4
      const targetRow = layout.height - 1 - (targetY + row)
      const targetOffset = pageIndex * layout.layerByteLength
        + (targetRow * layout.width + targetX) * 4
      data.set(
        source.subarray(sourceOffset, sourceOffset + options.sourceStrideX * 4),
        targetOffset,
      )
    }
  }

  return {
    data,
    rects: layout.rects,
    width: layout.width,
    height: layout.height,
    depth: layout.depth,
    pageColumns: layout.pageColumns,
    pageRows: layout.pageRows,
  }
}

export function createArrayAtlasLayout(
  itemCount: number,
  options: ArrayAtlasPlanOptions & { sourceHeight: number },
): ArrayAtlasLayout | null {
  const resolvedPage = resolveArrayAtlasPageSize(itemCount, options)
  const pageColumns = finiteInteger(options.pageColumns, resolvedPage.columns)
  const pageRows = finiteInteger(options.pageRows, resolvedPage.rows)
  const pageCapacity = pageColumns * pageRows
  const depth = Math.max(1, Math.ceil(Math.max(1, itemCount) / pageCapacity))
  const maxTextureLayers = finiteInteger(options.maxTextureLayers, 256)
  if (depth > maxTextureLayers) return null

  const width = pageColumns * options.sourceStrideX
  const height = pageRows * options.sourceStrideY
  const layerByteLength = width * height * 4
  const rects = new Float32Array(itemCount * 4)
  for (let index = 0; index < itemCount; index += 1) {
    const pageIndex = Math.floor(index / pageCapacity)
    const pageSlot = index % pageCapacity
    const targetX = (pageSlot % pageColumns) * options.sourceStrideX
    const targetY = Math.floor(pageSlot / pageColumns) * options.sourceStrideY
    rects.set([
      pageIndex + (targetX + options.padding) / width,
      1 - (targetY + options.padding + options.cellHeight) / height,
      options.cellWidth / width,
      options.cellHeight / height,
    ], index * 4)
  }

  return {
    rects,
    width,
    height,
    depth,
    pageColumns,
    pageRows,
    pageCapacity,
    layerByteLength,
  }
}

export function applyArrayAtlasPatch(
  atlas: TextureAtlasResult,
  patch: TextureAtlasPatch,
): number {
  const startedAt = now()
  const texture = atlas.texture
  if (!('isDataArrayTexture' in texture) || !texture.isDataArrayTexture) {
    throw new TypeError('Array Atlas requires a DataArrayTexture')
  }
  const pageCapacity = atlas.columns * atlas.rows
  const layerByteLength = atlas.width * atlas.height * 4
  const updatedLayers = new Set<number>()
  patch.cells.forEach(({ index, canvas }) => {
    const pageIndex = Math.floor(index / pageCapacity)
    const pageSlot = index % pageCapacity
    const x = (pageSlot % atlas.columns) * atlas.strideX + atlas.padding
    const y = Math.floor(pageSlot / atlas.columns) * atlas.strideY + atlas.padding
    const imageData = canvas.getContext('2d')
      ?.getImageData(0, 0, atlas.cellWidth, atlas.cellHeight)
    if (!imageData) throw new Error('Canvas 2D image data is unavailable')
    for (let row = 0; row < atlas.cellHeight; row += 1) {
      const sourceOffset = row * atlas.cellWidth * 4
      const targetRow = atlas.height - 1 - (y + row)
      const targetOffset = pageIndex * layerByteLength
        + (targetRow * atlas.width + x) * 4
      atlas.data.set(
        imageData.data.subarray(sourceOffset, sourceOffset + atlas.cellWidth * 4),
        targetOffset,
      )
    }
    updatedLayers.add(pageIndex)
  })
  updatedLayers.forEach((layer) => texture.addLayerUpdate(layer))
  texture.needsUpdate = updatedLayers.size > 0
  patch.metrics.uploadRanges = updatedLayers.size
  patch.metrics.uploadBytes = updatedLayers.size * layerByteLength
  return now() - startedAt
}

interface PageCandidate {
  columns: number
  rows: number
  capacity: number
  aspect: number
  aspectError: number
}

function pageCandidate(
  columns: number,
  rows: number,
  strideX: number,
  strideY: number,
): PageCandidate {
  const aspect = columns * strideX / (rows * strideY)
  return {
    columns,
    rows,
    capacity: columns * rows,
    aspect,
    aspectError: Math.abs(Math.log(aspect)),
  }
}

function comparePageCandidates(left: PageCandidate, right: PageCandidate): number {
  return left.capacity - right.capacity || left.aspectError - right.aspectError
}

function finiteInteger(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value as number)) : fallback
}

function now(): number {
  return globalThis.performance?.now() ?? Date.now()
}
