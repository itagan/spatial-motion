import type { Layout } from '../core/types.js'
import { defineLayout } from './defineLayout.js'

export interface CylinderOptions {
  radius?: number
  spacing?: number
  columns?: number
  rows?: number
  startAngle?: number
  arcAngle?: number
  density?: number
  orientation?: 'camera' | 'surface'
}

export function cylinder(options: CylinderOptions = {}): Layout {
  const radius = positive(options.radius, 5)
  const startAngle = finite(options.startAngle, 0)
  const arcAngle = clamp(positive(options.arcAngle, Math.PI * 2), Number.EPSILON, Math.PI * 2)
  const fullCircle = Math.abs(arcAngle - Math.PI * 2) < 1e-8
  const density = Math.max(0, finite(options.density, 0.78))
  const orientation = options.orientation ?? 'surface'
  return defineLayout({
    name: 'cylinder',
    orientation,
    calculateInto(count, _context, target): void {
      if (count <= 0) return
      // A cylinder with height close to its diameter needs roughly π times
      // as many columns as rows to keep cards visually square and evenly dense.
      const requestedRows = positiveInteger(options.rows)
      const columns = Math.max(1, positiveInteger(options.columns) ?? Math.ceil(Math.sqrt(count * Math.PI)))
      const rowDistribution = requestedRows
        ? distributeRows(count, Math.min(count, requestedRows))
        : Array.from({ length: Math.ceil(count / columns) }, (_, row) =>
          Math.min(columns, count - row * columns))
      const rows = rowDistribution.length
      const widestRow = Math.max(...rowDistribution)
      const horizontalUnits = requestedRows ? widestRow : columns
      const horizontalSpacing = fullCircle
        ? (Math.PI * 2 * radius) / horizontalUnits
        : horizontalUnits > 1 ? (arcAngle * radius) / (horizontalUnits - 1) : arcAngle * radius
      const spacing = positive(options.spacing, horizontalSpacing)
      const itemScale = Math.min(1, horizontalSpacing, spacing) * density
      let targetIndex = 0

      rowDistribution.forEach((rowItems, row) => {
        for (let column = 0; column < rowItems; column += 1) {
          const progress = fullCircle
            ? (column + (row % 2 === 1 ? 0.5 : 0)) / rowItems
            : rowItems === 1 ? 0.5 : column / (rowItems - 1)
          const angle = startAngle + progress * arcAngle
          target.setValues(
            targetIndex,
            Math.sin(angle) * radius,
            (rows / 2 - row - 0.5) * spacing,
            Math.cos(angle) * radius,
            itemScale,
            0,
            orientation === 'surface' ? angle : 0,
            0,
            1,
          )
          targetIndex += 1
        }
      })
    },
  })
}

function distributeRows(count: number, rows: number): number[] {
  const base = Math.floor(count / rows)
  const remainder = count % rows
  return Array.from({ length: rows }, (_, index) => base + (index < remainder ? 1 : 0))
}

function positiveInteger(value: number | undefined): number | undefined {
  return Number.isInteger(value) && (value ?? 0) > 0 ? value : undefined
}

function positive(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && (value ?? 0) > 0 ? value as number : fallback
}

function finite(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? value as number : fallback
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}
