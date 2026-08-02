import type { PerspectiveCamera } from 'three'
import type { MotionItem } from './types.js'
import type { TransformBufferView } from './TransformBuffer.js'
import type { MotionRendererPickShape } from '../renderers/MotionRenderer.js'
import type {
  ProjectedItemPicker,
  ProjectedPickOptions,
  ProjectedPickResult,
  ProjectedPickState,
} from './ProjectedItemPicker.js'
import { visibilityRank } from './Visibility.js'

export type InteractionPickOptions = ProjectedPickOptions
export type InteractionPickResult<TMeta> = ProjectedPickResult<TMeta>

interface InteractionControllerOptions<TMeta> {
  element: HTMLCanvasElement
  camera: PerspectiveCamera
  itemBounds: MotionRendererPickShape | null
  hoverEnabled: boolean
  hoverEffect: 'none' | 'highlight'
  keyboardNavigation: boolean
  ariaLabel: string
  getState: () => ProjectedPickState<TMeta>
  getItemIndex: (id: string) => number | undefined
  resolveTransformBuffer: (now: number) => TransformBufferView
  hasScheduledFrame: () => boolean
  isDestroyed: () => boolean
  setHighlightIndex: (index: number | null) => void
  requestFrame: () => void
  onItemClick?: (item: MotionItem<TMeta>, index: number) => void
  onItemHover?: (item: MotionItem<TMeta> | null, index: number | null) => void
  onItemFocus?: (item: MotionItem<TMeta> | null, index: number | null) => void
}

export class InteractionController<TMeta> {
  private picker: ProjectedItemPicker<TMeta> | null = null
  private pickerPromise: Promise<ProjectedItemPicker<TMeta>> | null = null
  private hoveredIndex: number | null = null
  private focusedItemId: string | null = null
  private pendingPointerMove = false
  private pendingClientX = 0
  private pendingClientY = 0
  private pointerGeneration = 0
  private disposed = false
  private pickingMs = 0
  private pickOperations = 0

  constructor(private readonly options: InteractionControllerOptions<TMeta>) {
    const { element } = options
    element.addEventListener('pointerup', this.handlePointerUp)
    if (options.keyboardNavigation) {
      element.tabIndex = 0
      element.setAttribute('role', 'region')
      element.setAttribute('aria-label', options.ariaLabel)
      element.addEventListener('keydown', this.handleKeyDown)
      element.addEventListener('focus', this.handleCanvasFocus)
      element.addEventListener('blur', this.handleCanvasBlur)
    }
    if (options.hoverEnabled) {
      element.addEventListener('pointermove', this.handlePointerMove)
      element.addEventListener('pointerleave', this.handlePointerLeave)
    }
  }

  pick(
    clientX: number,
    clientY: number,
    options: number | InteractionPickOptions = {},
  ): Promise<InteractionPickResult<TMeta> | null> {
    if (this.picker) {
      try {
        return Promise.resolve(this.pickPrepared(clientX, clientY, options))
      } catch (error) {
        return Promise.reject(error)
      }
    }
    const startedAt = performance.now()
    return this.preparePicker()
      .then((picker) => {
        if (!picker || this.disposed || this.options.isDestroyed()) return null
        return picker.pick(clientX, clientY, options)
      })
      .finally(() => {
        this.pickingMs += performance.now() - startedAt
        this.pickOperations += 1
      })
  }

  focusItem(id: string): boolean {
    const state = this.options.getState()
    const index = this.options.getItemIndex(id)
    if (index === undefined || visibilityRank(index) > state.visibleRatio) return false
    this.setFocusedIndex(index)
    this.options.element.focus()
    return true
  }

  getFocusedItem(): MotionItem<TMeta> | null {
    const state = this.options.getState()
    const index = this.focusedIndex()
    return index === null ? null : state.items[index] ?? null
  }

  syncItems(): void {
    const state = this.options.getState()
    const index = this.focusedIndex()
    if (
      this.focusedItemId !== null
      && (index === null || visibilityRank(index) > state.visibleRatio)
    ) {
      this.setFocusedIndex(null)
    }
    else if (index !== null) {
      this.updateHighlight()
      this.updateAriaLabel(state.items[index], index, state.items.length)
    }
  }

  refreshHighlight(): void {
    this.updateHighlight()
  }

  flushPendingPointerMove(): void {
    if (!this.pendingPointerMove) return
    this.pendingPointerMove = false
    const generation = ++this.pointerGeneration
    if (this.picker) {
      const result = this.pickPrepared(
        this.pendingClientX,
        this.pendingClientY,
        {},
      )
      this.commitPointerResult(result, generation)
      return
    }
    void this.resolvePointerMove(
      this.pendingClientX,
      this.pendingClientY,
      generation,
    )
  }

  getStats(): Readonly<{ pickingMs: number; pickOperations: number }> {
    return {
      pickingMs: this.pickingMs,
      pickOperations: this.pickOperations,
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.pointerGeneration += 1
    const { element } = this.options
    this.pendingPointerMove = false
    element.removeEventListener('pointerup', this.handlePointerUp)
    element.removeEventListener('pointermove', this.handlePointerMove)
    element.removeEventListener('pointerleave', this.handlePointerLeave)
    element.removeEventListener('keydown', this.handleKeyDown)
    element.removeEventListener('focus', this.handleCanvasFocus)
    element.removeEventListener('blur', this.handleCanvasBlur)
    this.picker = null
    this.pickerPromise = null
  }

  private preparePicker(): Promise<ProjectedItemPicker<TMeta> | null> {
    if (!this.options.itemBounds || this.disposed) return Promise.resolve(null)
    if (this.picker) return Promise.resolve(this.picker)
    if (this.pickerPromise) return this.pickerPromise
    this.pickerPromise = import('./ProjectedItemPicker.js')
      .then(({ ProjectedItemPicker }) => {
        const picker = new ProjectedItemPicker({
          element: this.options.element,
          camera: this.options.camera,
          itemBounds: this.options.itemBounds!,
          getState: this.options.getState,
          resolveTransformBuffer: this.options.resolveTransformBuffer,
        })
        if (this.disposed) return picker
        this.picker = picker
        return picker
      })
      .finally(() => {
        this.pickerPromise = null
      })
    return this.pickerPromise
  }

  private readonly handlePointerUp = (event: PointerEvent) => {
    if (this.options.isDestroyed()) return
    if (this.picker) {
      const result = this.pickPrepared(event.clientX, event.clientY, {})
      if (result) this.options.onItemClick?.(result.item, result.index)
      return
    }
    void this.resolvePointerUp(event.clientX, event.clientY)
  }

  private async resolvePointerUp(
    clientX: number,
    clientY: number,
  ): Promise<void> {
    try {
      const result = await this.pick(clientX, clientY)
      if (!result || this.disposed || this.options.isDestroyed()) return
      this.options.onItemClick?.(result.item, result.index)
    } catch {
      // Public pick() exposes loading failures; DOM events fail closed.
    }
  }

  private readonly handlePointerMove = (event: PointerEvent) => {
    this.pendingClientX = event.clientX
    this.pendingClientY = event.clientY
    this.pendingPointerMove = true
    if (!this.options.hasScheduledFrame()) this.flushPendingPointerMove()
  }

  private async resolvePointerMove(
    clientX: number,
    clientY: number,
    generation: number,
  ): Promise<void> {
    try {
      const result = await this.pick(clientX, clientY)
      this.commitPointerResult(result, generation)
    } catch {
      // Keep the last stable hover state when the optional picker chunk fails.
    }
  }

  private pickPrepared(
    clientX: number,
    clientY: number,
    options: number | InteractionPickOptions,
  ): InteractionPickResult<TMeta> | null {
    const startedAt = performance.now()
    try {
      if (this.disposed || this.options.isDestroyed()) return null
      return this.picker?.pick(clientX, clientY, options) ?? null
    } finally {
      this.pickingMs += performance.now() - startedAt
      this.pickOperations += 1
    }
  }

  private commitPointerResult(
    result: InteractionPickResult<TMeta> | null,
    generation: number,
  ): void {
    if (
      generation !== this.pointerGeneration
      || this.disposed
      || this.options.isDestroyed()
    ) return
    const index = result?.index ?? null
    if (index === this.hoveredIndex) return
    this.hoveredIndex = index
    this.updateHighlight()
    this.options.onItemHover?.(result?.item ?? null, index)
  }

  private readonly handlePointerLeave = () => {
    this.pendingPointerMove = false
    this.pointerGeneration += 1
    if (this.hoveredIndex === null) return
    this.hoveredIndex = null
    this.updateHighlight()
    this.options.onItemHover?.(null, null)
  }

  private readonly handleCanvasFocus = () => {
    if (this.options.isDestroyed()) return
    const state = this.options.getState()
    if (this.focusedIndex() !== null) return
    const first = this.findVisibleItem(state.items.length, state.visibleRatio, 0, 1)
    if (first !== null) this.setFocusedIndex(first)
  }

  private readonly handleCanvasBlur = () => {
    if (!this.options.isDestroyed()) this.setFocusedIndex(null)
  }

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (this.options.isDestroyed()) return
    const state = this.options.getState()
    const count = state.items.length
    if (!count) return
    const current = this.focusedIndex()
    let next: number | null = null
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = this.findVisibleItem(count, state.visibleRatio, (current ?? -1) + 1, 1)
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        next = this.findVisibleItem(count, state.visibleRatio, (current ?? 0) - 1, -1)
        break
      case 'Home':
        next = this.findVisibleItem(count, state.visibleRatio, 0, 1)
        break
      case 'End':
        next = this.findVisibleItem(count, state.visibleRatio, count - 1, -1)
        break
      case 'Enter':
      case ' ':
        if (current !== null) {
          event.preventDefault()
          this.options.onItemClick?.(state.items[current], current)
        }
        return
      default:
        return
    }
    if (next === null) return
    event.preventDefault()
    this.setFocusedIndex(next)
  }

  private findVisibleItem(
    count: number,
    visibleRatio: number,
    start: number,
    direction: 1 | -1,
  ): number | null {
    for (let offset = 0; offset < count; offset += 1) {
      const index = (start + direction * offset + count) % count
      if (visibilityRank(index) <= visibleRatio) return index
    }
    return null
  }

  private focusedIndex(): number | null {
    if (this.focusedItemId === null) return null
    return this.options.getItemIndex(this.focusedItemId) ?? null
  }

  private setFocusedIndex(index: number | null): void {
    const state = this.options.getState()
    const previousId = this.focusedItemId
    const item = index === null ? null : state.items[index] ?? null
    this.focusedItemId = item?.id ?? null
    this.updateHighlight()
    this.updateAriaLabel(item, index, state.items.length)
    if (previousId !== this.focusedItemId) {
      this.options.onItemFocus?.(item, item ? index : null)
    }
  }

  private updateHighlight(): void {
    const focusedIndex = this.focusedIndex()
    const index = (this.options.hoverEffect === 'highlight' ? this.hoveredIndex : null)
      ?? focusedIndex
    this.options.setHighlightIndex(index)
    this.options.requestFrame()
  }

  private updateAriaLabel(
    item: MotionItem<TMeta> | null,
    index: number | null,
    count: number,
  ): void {
    if (!this.options.keyboardNavigation) return
    const detail = item && index !== null
      ? `: ${item.title?.trim() || item.id} (${index + 1} of ${count})`
      : ''
    this.options.element.setAttribute('aria-label', `${this.options.ariaLabel}${detail}`)
  }

}
