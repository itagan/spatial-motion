import type { CardStyle } from '../../core/types.js'

export interface DefaultCardWorkerItem {
  id: string
  title?: string
  style: CardStyle
}

export interface DefaultCardWorkerRequest {
  width: number
  height: number
  columns: number
  cellWidth: number
  cellHeight: number
  padding: number
  strideX: number
  strideY: number
  items: DefaultCardWorkerItem[]
}

export interface DefaultCardWorkerResponse {
  data?: ArrayBuffer
  cellRenderMs: number
  readbackMs: number
  error?: string
}
