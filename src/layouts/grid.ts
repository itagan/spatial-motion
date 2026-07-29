import type { Layout } from '../core/types.js'
import type { TransformBuffer } from '../core/TransformBuffer.js'
import { defineLayout } from './defineLayout.js'

export interface GridOptions {
  columns?: number
  gap?: number
  fit?: 'fixed' | 'contain' | 'cover'
}

export function grid(options: GridOptions = {}): Layout {
  const gap = options.gap ?? 1.3
  const fit = options.fit ?? 'fixed'
  return defineLayout({
    name: 'grid',
    calculateInto(count, context, target): void {
      if (count <= 0) return
      if (fit !== 'fixed') {
        fittedGridInto(target, count, context, options.columns, fit)
        return
      }
      const columns = Math.max(1, options.columns ?? Math.ceil(Math.sqrt(count)))
      const rows = Math.ceil(count / columns)
      const scale = Math.min(1, gap * 0.82)
      for (let index = 0; index < count; index += 1) {
        target.setValues(
          index,
          centeredColumn(index, count, columns) * gap,
          ((rows - 1) / 2 - Math.floor(index / columns)) * gap,
          0,
          scale,
          0,
          0,
          0,
          1,
        )
      }
    },
  })
}

function fittedGridInto(
  target: TransformBuffer,
  count: number,
  context: { width: number; height: number; viewportWidth?: number; viewportHeight?: number },
  explicitColumns: number | undefined,
  fit: 'contain' | 'cover',
): void {
  const viewportHeight = positive(context.viewportHeight, 10)
  const viewportWidth = positive(
    context.viewportWidth,
    viewportHeight * positive(context.width, 1) / positive(context.height, 1),
  )
  const columns = explicitColumns
    ? Math.max(1, Math.floor(explicitColumns))
    : bestColumns(count, viewportWidth, viewportHeight, fit)
  const rows = Math.ceil(count / columns)
  const cellWidth = viewportWidth / columns
  const cellHeight = viewportHeight / rows
  const cellSize = fit === 'cover'
    ? Math.max(viewportWidth / Math.max(0.82, columns - 0.18), viewportHeight / Math.max(0.82, rows - 0.18))
    : Math.min(cellWidth, cellHeight)
  const itemScale = cellSize * 0.82

  for (let index = 0; index < count; index += 1) {
    target.setValues(
      index,
      centeredColumn(index, count, columns) * cellSize,
      ((rows - 1) / 2 - Math.floor(index / columns)) * cellSize,
      0,
      itemScale,
      0,
      0,
      0,
      1,
    )
  }
}

function centeredColumn(index: number, count: number, columns: number): number {
  const row = Math.floor(index / columns)
  const itemsInRow = Math.min(columns, count - row * columns)
  return index % columns - (itemsInRow - 1) / 2
}

function bestColumns(count: number, width: number, height: number, fit: 'contain' | 'cover'): number {
  let best = 1
  let bestScore = fit === 'contain' ? -Infinity : Infinity
  for (let columns = 1; columns <= count; columns += 1) {
    const rows = Math.ceil(count / columns)
    const cellWidth = width / columns
    const cellHeight = height / rows
    const score = fit === 'contain'
      ? Math.min(cellWidth, cellHeight)
      : Math.abs(Math.log(cellWidth / cellHeight))
    if ((fit === 'contain' && score > bestScore) || (fit === 'cover' && score < bestScore)) {
      best = columns
      bestScore = score
    }
  }
  return best
}

function positive(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && (value ?? 0) > 0 ? value as number : fallback
}
