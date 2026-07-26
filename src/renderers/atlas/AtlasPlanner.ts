export interface AtlasPlan {
  columns: number
  rows: number
  cellSize: number
  cellWidth: number
  cellHeight: number
  padding: number
  stride: number
  strideX: number
  strideY: number
}

export function resolveAtlasMetrics(
  count: number,
  requestedCellSize = 64,
  requestedMaxTextureSize = 16_384,
  requestedAspectRatio = 1,
): AtlasPlan {
  const safeCount = Math.max(1, Math.floor(Number.isFinite(count) ? count : 1))
  const aspectRatio = resolveAspectRatio(requestedAspectRatio)
  const normalizedWidth = aspectRatio >= 1 ? 1 : aspectRatio
  const normalizedHeight = aspectRatio >= 1 ? 1 / aspectRatio : 1
  const columns = Math.max(1, Math.min(
    safeCount,
    Math.ceil(Math.sqrt(safeCount * normalizedHeight / normalizedWidth)),
  ))
  const rows = Math.ceil(safeCount / columns)
  const maxTextureSize = Math.max(1, Math.floor(
    Number.isFinite(requestedMaxTextureSize) ? requestedMaxTextureSize : 16_384,
  ))
  const requested = Math.min(256, Math.max(32, Math.round(
    Number.isFinite(requestedCellSize) ? requestedCellSize : 64,
  )))
  const strideLimitX = Math.max(1, Math.floor(maxTextureSize / columns))
  const strideLimitY = Math.max(1, Math.floor(maxTextureSize / rows))
  const padding = Math.min(
    4,
    Math.max(0, Math.floor((Math.min(strideLimitX, strideLimitY) - 1) / 2)),
  )
  const maximumLongEdge = Math.max(1, Math.floor(Math.min(
    (strideLimitX - padding * 2) / normalizedWidth,
    (strideLimitY - padding * 2) / normalizedHeight,
  )))
  const cellSize = Math.min(requested, maximumLongEdge)
  const { width: cellWidth, height: cellHeight } = resolveCellDimensions(
    cellSize,
    aspectRatio,
  )
  const strideX = cellWidth + padding * 2
  const strideY = cellHeight + padding * 2
  return {
    columns,
    rows,
    cellSize,
    cellWidth,
    cellHeight,
    padding,
    stride: Math.max(strideX, strideY),
    strideX,
    strideY,
  }
}

export function resolveCellDimensions(
  longestEdge: number,
  requestedAspectRatio: number | undefined,
): { width: number; height: number } {
  const aspectRatio = resolveAspectRatio(requestedAspectRatio)
  return aspectRatio >= 1
    ? { width: longestEdge, height: Math.max(1, Math.floor(longestEdge / aspectRatio)) }
    : { width: Math.max(1, Math.floor(longestEdge * aspectRatio)), height: longestEdge }
}

function resolveAspectRatio(value: number | undefined): number {
  return Number.isFinite(value) ? Math.min(4, Math.max(0.25, value as number)) : 1
}
