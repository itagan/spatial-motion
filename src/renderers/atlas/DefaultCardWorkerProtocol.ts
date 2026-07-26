import type { CardStyle } from '../../core/types.js'

export interface DefaultCardWorkerItem {
  id: string
  title?: string
  style: CardStyle
  imageIndex?: number
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
  images: ImageBitmap[]
  arrayMaxTextureLayers?: number
}

export interface DefaultCardWorkerResponse {
  data?: ArrayBuffer
  rects?: ArrayBuffer
  arrayWidth?: number
  arrayHeight?: number
  arrayDepth?: number
  arrayPageColumns?: number
  arrayPageRows?: number
  arrayPackMs?: number
  cellRenderMs: number
  readbackMs: number
  error?: string
}
