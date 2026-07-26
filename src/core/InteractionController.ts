import {
  Euler,
  PerspectiveCamera,
  Vector3,
} from 'three'
import type { MotionItem, Transform } from './types.js'
import type { MotionRendererPickShape } from '../renderers/MotionRenderer.js'

export interface InteractionPickOptions {
  padding?: number
  includeOccluded?: boolean
}

export interface InteractionPickResult<TMeta> {
  item: MotionItem<TMeta>
  index: number
  distance: number
}

interface InteractionState<TMeta> {
  items: readonly MotionItem<TMeta>[]
  visibleRatio: number
  rotationX: number
  rotationY: number
  orientation: 'surface' | 'camera'
  hideBackHemisphere: boolean
  effectActive: boolean
}

interface InteractionControllerOptions<TMeta> {
  element: HTMLCanvasElement
  camera: PerspectiveCamera
  itemBounds: MotionRendererPickShape | null
  hoverEnabled: boolean
  hoverEffect: 'none' | 'highlight'
  keyboardNavigation: boolean
  ariaLabel: string
  getState: () => InteractionState<TMeta>
  resolveTransforms: (now: number) => readonly Transform[]
  hasScheduledFrame: () => boolean
  isDestroyed: () => boolean
  setHighlightIndex: (index: number | null) => void
  onItemClick?: (item: MotionItem<TMeta>, index: number) => void
  onItemHover?: (item: MotionItem<TMeta> | null, index: number | null) => void
  onItemFocus?: (item: MotionItem<TMeta> | null, index: number | null) => void
}

export class InteractionController<TMeta> {
  private readonly projectionVector = new Vector3()
  private readonly groupEuler = new Euler()
  private hoveredIndex: number | null = null
  private focusedItemId: string | null = null
  private pendingPointerMove: { clientX: number; clientY: number } | null = null
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
  ): InteractionPickResult<TMeta> | null {
    const startedAt = performance.now()
    try {
      return this.pickInternal(clientX, clientY, options)
    } finally {
      this.pickingMs += performance.now() - startedAt
      this.pickOperations += 1
    }
  }

  focusItem(id: string): boolean {
    const state = this.options.getState()
    const index = state.items.findIndex((item) => item.id === id)
    if (index < 0 || visibilityRank(index) > state.visibleRatio) return false
    this.setFocusedIndex(index)
    this.options.element.focus()
    return true
  }

  getFocusedItem(): MotionItem<TMeta> | null {
    const state = this.options.getState()
    const index = this.focusedIndex(state.items)
    return index === null ? null : state.items[index] ?? null
  }

  syncItems(): void {
    const state = this.options.getState()
    const index = this.focusedIndex(state.items)
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
    const pointer = this.pendingPointerMove
    if (!pointer) return
    this.pendingPointerMove = null
    const result = this.pick(pointer.clientX, pointer.clientY)
    const index = result?.index ?? null
    if (index === this.hoveredIndex) return
    this.hoveredIndex = index
    this.updateHighlight()
    this.options.onItemHover?.(result?.item ?? null, index)
  }

  getStats(): Readonly<{ pickingMs: number; pickOperations: number }> {
    return {
      pickingMs: this.pickingMs,
      pickOperations: this.pickOperations,
    }
  }

  dispose(): void {
    const { element } = this.options
    this.pendingPointerMove = null
    element.removeEventListener('pointerup', this.handlePointerUp)
    element.removeEventListener('pointermove', this.handlePointerMove)
    element.removeEventListener('pointerleave', this.handlePointerLeave)
    element.removeEventListener('keydown', this.handleKeyDown)
    element.removeEventListener('focus', this.handleCanvasFocus)
    element.removeEventListener('blur', this.handleCanvasBlur)
  }

  private pickInternal(
    clientX: number,
    clientY: number,
    options: number | InteractionPickOptions,
  ): InteractionPickResult<TMeta> | null {
    const { itemBounds, element, camera } = this.options
    if (!itemBounds) return null
    const rect = element.getBoundingClientRect()
    if (!rect.width || !rect.height) return null
    const state = this.options.getState()
    const transforms = this.options.resolveTransforms(performance.now())
    camera.updateMatrixWorld()
    this.groupEuler.set(state.rotationX, state.rotationY, 0, 'XYZ')
    const legacyRadius = typeof options === 'number' ? Math.max(0, options) : null
    const pickOptions = typeof options === 'number' ? {} : options
    const padding = Math.max(0, pickOptions.padding ?? 0)
    const billboard = itemBounds.facing === 'camera'
      || state.orientation === 'camera'
      || state.effectActive
    const candidates: Array<InteractionPickResult<TMeta> & { depth: number }> = []
    const groupOriginViewZ = new Vector3()
      .applyMatrix4(camera.matrixWorldInverse)
      .z
    const itemWidth = itemBounds.kind === 'disc' ? itemBounds.diameter : itemBounds.width
    const itemHeight = itemBounds.kind === 'disc' ? itemBounds.diameter : itemBounds.height

    transforms.forEach((transform, index) => {
      const item = state.items[index]
      if (!item || transform.opacity < 0.05 || visibilityRank(index) > state.visibleRatio) return
      const center = new Vector3(transform.x, transform.y, transform.z).applyEuler(this.groupEuler)
      const centerViewZ = center.clone().applyMatrix4(camera.matrixWorldInverse).z
      if (state.hideBackHemisphere && centerViewZ < groupOriginViewZ) return
      const projectedCenter = this.projectToScreen(center, rect)
      if (!projectedCenter) return
      const distance = Math.hypot(clientX - projectedCenter.x, clientY - projectedCenter.y)
      const depth = center.distanceTo(camera.position)
      if (legacyRadius !== null) {
        if (distance <= legacyRadius) candidates.push({ item, index, distance, depth })
        return
      }

      const halfWidth = Math.max(0, transform.scale) * itemWidth / 2
      const halfHeight = Math.max(0, transform.scale) * itemHeight / 2
      if (itemBounds.kind === 'disc') {
        const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion)
        const edge = this.projectToScreen(center.clone().addScaledVector(right, halfWidth), rect)
        if (!edge) return
        const radius = Math.hypot(edge.x - projectedCenter.x, edge.y - projectedCenter.y)
        if (distance <= radius + padding) candidates.push({ item, index, distance, depth })
        return
      }

      const corners = billboard
        ? this.billboardCorners(center, halfWidth, halfHeight)
        : this.surfaceCorners(center, halfWidth, halfHeight, transform)
      if (!billboard && !isFrontFacing(corners, center, camera.position)) return
      const screenCorners = corners.map((corner) => this.projectToScreen(corner, rect))
      if (screenCorners.some((corner) => !corner)) return
      if (!pointHitsQuad(clientX, clientY, screenCorners as ScreenPoint[], padding)) return
      candidates.push({ item, index, distance, depth })
    })

    if (!candidates.length) return null
    candidates.sort((left, right) => pickOptions.includeOccluded
      ? left.distance - right.distance || left.depth - right.depth
      : left.depth - right.depth || left.distance - right.distance)
    const { depth: _depth, ...result } = candidates[0]
    return result
  }

  private readonly handlePointerUp = (event: PointerEvent) => {
    if (this.options.isDestroyed()) return
    const result = this.pick(event.clientX, event.clientY)
    if (result) this.options.onItemClick?.(result.item, result.index)
  }

  private readonly handlePointerMove = (event: PointerEvent) => {
    this.pendingPointerMove = { clientX: event.clientX, clientY: event.clientY }
    if (!this.options.hasScheduledFrame()) this.flushPendingPointerMove()
  }

  private readonly handlePointerLeave = () => {
    this.pendingPointerMove = null
    if (this.hoveredIndex === null) return
    this.hoveredIndex = null
    this.updateHighlight()
    this.options.onItemHover?.(null, null)
  }

  private readonly handleCanvasFocus = () => {
    if (this.options.isDestroyed()) return
    const state = this.options.getState()
    if (this.focusedIndex(state.items) !== null) return
    const first = this.visibleItemIndices(state.items.length, state.visibleRatio)[0]
    if (first !== undefined) this.setFocusedIndex(first)
  }

  private readonly handleCanvasBlur = () => {
    if (!this.options.isDestroyed()) this.setFocusedIndex(null)
  }

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (this.options.isDestroyed()) return
    const state = this.options.getState()
    const visible = this.visibleItemIndices(state.items.length, state.visibleRatio)
    if (!visible.length) return
    const current = this.focusedIndex(state.items)
    const position = current === null ? -1 : visible.indexOf(current)
    let next: number | undefined
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = visible[(position + 1 + visible.length) % visible.length]
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        next = visible[(position - 1 + visible.length) % visible.length]
        break
      case 'Home':
        next = visible[0]
        break
      case 'End':
        next = visible.at(-1)
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
    event.preventDefault()
    if (next !== undefined) this.setFocusedIndex(next)
  }

  private focusedIndex(items: readonly MotionItem<TMeta>[]): number | null {
    if (this.focusedItemId === null) return null
    const index = items.findIndex((item) => item.id === this.focusedItemId)
    return index >= 0 ? index : null
  }

  private visibleItemIndices(count: number, visibleRatio: number): number[] {
    return Array.from({ length: count }, (_value, index) =>
      visibilityRank(index) <= visibleRatio ? index : -1,
    ).filter((index) => index >= 0)
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
    const state = this.options.getState()
    const focusedIndex = this.focusedIndex(state.items)
    const index = (this.options.hoverEffect === 'highlight' ? this.hoveredIndex : null)
      ?? focusedIndex
    this.options.setHighlightIndex(index)
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

  private projectToScreen(point: Vector3, rect: DOMRect): ScreenPoint | null {
    this.projectionVector.copy(point).project(this.options.camera)
    if (this.projectionVector.z < -1 || this.projectionVector.z > 1) return null
    return {
      x: rect.left + (this.projectionVector.x + 1) * rect.width / 2,
      y: rect.top + (1 - this.projectionVector.y) * rect.height / 2,
    }
  }

  private billboardCorners(center: Vector3, halfWidth: number, halfHeight: number): Vector3[] {
    const right = new Vector3(1, 0, 0).applyQuaternion(this.options.camera.quaternion)
    const up = new Vector3(0, 1, 0).applyQuaternion(this.options.camera.quaternion)
    return [
      center.clone().addScaledVector(right, -halfWidth).addScaledVector(up, -halfHeight),
      center.clone().addScaledVector(right, halfWidth).addScaledVector(up, -halfHeight),
      center.clone().addScaledVector(right, halfWidth).addScaledVector(up, halfHeight),
      center.clone().addScaledVector(right, -halfWidth).addScaledVector(up, halfHeight),
    ]
  }

  private surfaceCorners(
    center: Vector3,
    halfWidth: number,
    halfHeight: number,
    transform: Transform,
  ): Vector3[] {
    const itemEuler = new Euler(transform.rotationX, transform.rotationY, transform.rotationZ, 'XYZ')
    return [
      [-halfWidth, -halfHeight],
      [halfWidth, -halfHeight],
      [halfWidth, halfHeight],
      [-halfWidth, halfHeight],
    ].map(([x, y]) => new Vector3(x, y, 0)
      .applyEuler(itemEuler)
      .applyEuler(this.groupEuler)
      .add(center))
  }
}

interface ScreenPoint {
  x: number
  y: number
}

function isFrontFacing(corners: Vector3[], center: Vector3, cameraPosition: Vector3): boolean {
  const edgeA = corners[1].clone().sub(corners[0])
  const edgeB = corners[3].clone().sub(corners[0])
  const normal = edgeA.cross(edgeB)
  return normal.dot(cameraPosition.clone().sub(center)) > 0
}

function pointHitsQuad(x: number, y: number, corners: ScreenPoint[], padding: number): boolean {
  let hasPositive = false
  let hasNegative = false
  for (let index = 0; index < corners.length; index += 1) {
    const start = corners[index]
    const end = corners[(index + 1) % corners.length]
    const cross = (end.x - start.x) * (y - start.y) - (end.y - start.y) * (x - start.x)
    hasPositive ||= cross > 0
    hasNegative ||= cross < 0
  }
  if (!(hasPositive && hasNegative)) return true
  if (!padding) return false
  return corners.some((start, index) =>
    distanceToSegment(x, y, start, corners[(index + 1) % corners.length]) <= padding,
  )
}

function distanceToSegment(x: number, y: number, start: ScreenPoint, end: ScreenPoint): number {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy
  if (!lengthSquared) return Math.hypot(x - start.x, y - start.y)
  const amount = Math.min(1, Math.max(0, ((x - start.x) * dx + (y - start.y) * dy) / lengthSquared))
  return Math.hypot(x - (start.x + amount * dx), y - (start.y + amount * dy))
}

export function visibilityRank(index: number): number {
  return (index * 0.618033988749895) % 1
}
