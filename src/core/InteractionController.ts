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
  private readonly itemEuler = new Euler()
  private readonly center = new Vector3()
  private readonly viewCenter = new Vector3()
  private readonly groupOrigin = new Vector3()
  private readonly cameraRight = new Vector3()
  private readonly cameraUp = new Vector3()
  private readonly edgeA = new Vector3()
  private readonly edgeB = new Vector3()
  private readonly normal = new Vector3()
  private readonly cameraDirection = new Vector3()
  private readonly corners = [
    new Vector3(),
    new Vector3(),
    new Vector3(),
    new Vector3(),
  ] as const
  private readonly centerScreen = new Float64Array(2)
  private readonly edgeScreen = new Float64Array(2)
  private readonly screenCorners = new Float64Array(8)
  private indexedItems: readonly MotionItem<TMeta>[] | null = null
  private readonly itemIndexById = new Map<string, number>()
  private hoveredIndex: number | null = null
  private focusedItemId: string | null = null
  private pendingPointerMove = false
  private pendingClientX = 0
  private pendingClientY = 0
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
    this.ensureItemIndex(state.items)
    const index = this.itemIndexById.get(id)
    if (index === undefined || visibilityRank(index) > state.visibleRatio) return false
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
    this.rebuildItemIndex(state.items)
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
    if (!this.pendingPointerMove) return
    this.pendingPointerMove = false
    const result = this.pick(this.pendingClientX, this.pendingClientY)
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
    this.pendingPointerMove = false
    element.removeEventListener('pointerup', this.handlePointerUp)
    element.removeEventListener('pointermove', this.handlePointerMove)
    element.removeEventListener('pointerleave', this.handlePointerLeave)
    element.removeEventListener('keydown', this.handleKeyDown)
    element.removeEventListener('focus', this.handleCanvasFocus)
    element.removeEventListener('blur', this.handleCanvasBlur)
    this.indexedItems = null
    this.itemIndexById.clear()
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
    this.cameraRight.set(1, 0, 0).applyQuaternion(camera.quaternion)
    this.cameraUp.set(0, 1, 0).applyQuaternion(camera.quaternion)
    const legacyRadius = typeof options === 'number' ? Math.max(0, options) : null
    const pickOptions = typeof options === 'number' ? {} : options
    const padding = Math.max(0, pickOptions.padding ?? 0)
    const billboard = itemBounds.facing === 'camera'
      || state.orientation === 'camera'
      || state.effectActive
    const includeOccluded = pickOptions.includeOccluded === true
    const groupOriginViewZ = this.groupOrigin
      .set(0, 0, 0)
      .applyMatrix4(camera.matrixWorldInverse)
      .z
    const itemWidth = itemBounds.kind === 'disc' ? itemBounds.diameter : itemBounds.width
    const itemHeight = itemBounds.kind === 'disc' ? itemBounds.diameter : itemBounds.height
    const projectionScale = rect.height * camera.zoom / (
      2 * Math.tan(camera.fov * Math.PI / 360)
    )
    let bestItem: MotionItem<TMeta> | null = null
    let bestIndex = -1
    let bestDistance = Number.POSITIVE_INFINITY
    let bestDepth = Number.POSITIVE_INFINITY

    for (let index = 0; index < transforms.length; index += 1) {
      const transform = transforms[index]
      const item = state.items[index]
      if (!item || transform.opacity < 0.05 || visibilityRank(index) > state.visibleRatio) continue
      const center = this.center
        .set(transform.x, transform.y, transform.z)
        .applyEuler(this.groupEuler)
      const centerViewZ = this.viewCenter
        .copy(center)
        .applyMatrix4(camera.matrixWorldInverse)
        .z
      if (state.hideBackHemisphere && centerViewZ < groupOriginViewZ) continue
      if (!this.projectViewToScreen(this.viewCenter, rect, this.centerScreen)) continue
      const distance = Math.hypot(
        clientX - this.centerScreen[0],
        clientY - this.centerScreen[1],
      )
      const depth = Math.sqrt(center.distanceToSquared(camera.position))
      let hit = false
      if (legacyRadius !== null) {
        hit = distance <= legacyRadius
      } else {
        const halfWidth = Math.max(0, transform.scale) * itemWidth / 2
        const halfHeight = Math.max(0, transform.scale) * itemHeight / 2
        if (itemBounds.kind === 'disc') {
          this.edgeA.copy(center).addScaledVector(this.cameraRight, halfWidth)
          if (!this.projectToScreen(this.edgeA, rect, this.edgeScreen)) continue
          const radius = Math.hypot(
            this.edgeScreen[0] - this.centerScreen[0],
            this.edgeScreen[1] - this.centerScreen[1],
          )
          hit = distance <= radius + padding
        } else {
          const halfDiagonal = Math.hypot(halfWidth, halfHeight)
          const nearestDepth = -centerViewZ - halfDiagonal
          if (
            nearestDepth > 0
            && distance > projectionScale * halfDiagonal / nearestDepth + padding
          ) continue

          if (billboard) {
            this.setBillboardCorners(center, halfWidth, halfHeight)
          } else {
            this.setSurfaceCorners(center, halfWidth, halfHeight, transform)
            if (!this.isFrontFacing(center, camera.position)) continue
          }
          let projected = true
          for (let cornerIndex = 0; cornerIndex < 4; cornerIndex += 1) {
            if (!this.projectToScreen(
              this.corners[cornerIndex],
              rect,
              this.screenCorners,
              cornerIndex * 2,
            )) {
              projected = false
              break
            }
          }
          if (!projected) continue
          hit = pointHitsQuad(clientX, clientY, this.screenCorners, padding)
        }
      }
      if (!hit) continue
      const better = includeOccluded
        ? distance < bestDistance || (distance === bestDistance && depth < bestDepth)
        : depth < bestDepth || (depth === bestDepth && distance < bestDistance)
      if (!better) continue
      bestItem = item
      bestIndex = index
      bestDistance = distance
      bestDepth = depth
    }

    return bestItem
      ? { item: bestItem, index: bestIndex, distance: bestDistance }
      : null
  }

  private readonly handlePointerUp = (event: PointerEvent) => {
    if (this.options.isDestroyed()) return
    const result = this.pick(event.clientX, event.clientY)
    if (result) this.options.onItemClick?.(result.item, result.index)
  }

  private readonly handlePointerMove = (event: PointerEvent) => {
    this.pendingClientX = event.clientX
    this.pendingClientY = event.clientY
    this.pendingPointerMove = true
    if (!this.options.hasScheduledFrame()) this.flushPendingPointerMove()
  }

  private readonly handlePointerLeave = () => {
    this.pendingPointerMove = false
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
    this.ensureItemIndex(items)
    return this.itemIndexById.get(this.focusedItemId) ?? null
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

  private projectToScreen(
    point: Vector3,
    rect: DOMRect,
    output: Float64Array,
    offset = 0,
  ): boolean {
    this.projectionVector.copy(point).project(this.options.camera)
    if (this.projectionVector.z < -1 || this.projectionVector.z > 1) return false
    output[offset] = rect.left + (this.projectionVector.x + 1) * rect.width / 2
    output[offset + 1] = rect.top + (1 - this.projectionVector.y) * rect.height / 2
    return true
  }

  private projectViewToScreen(
    point: Vector3,
    rect: DOMRect,
    output: Float64Array,
  ): boolean {
    this.projectionVector.copy(point).applyMatrix4(this.options.camera.projectionMatrix)
    if (this.projectionVector.z < -1 || this.projectionVector.z > 1) return false
    output[0] = rect.left + (this.projectionVector.x + 1) * rect.width / 2
    output[1] = rect.top + (1 - this.projectionVector.y) * rect.height / 2
    return true
  }

  private setBillboardCorners(center: Vector3, halfWidth: number, halfHeight: number): void {
    this.corners[0].copy(center)
      .addScaledVector(this.cameraRight, -halfWidth)
      .addScaledVector(this.cameraUp, -halfHeight)
    this.corners[1].copy(center)
      .addScaledVector(this.cameraRight, halfWidth)
      .addScaledVector(this.cameraUp, -halfHeight)
    this.corners[2].copy(center)
      .addScaledVector(this.cameraRight, halfWidth)
      .addScaledVector(this.cameraUp, halfHeight)
    this.corners[3].copy(center)
      .addScaledVector(this.cameraRight, -halfWidth)
      .addScaledVector(this.cameraUp, halfHeight)
  }

  private setSurfaceCorners(
    center: Vector3,
    halfWidth: number,
    halfHeight: number,
    transform: Transform,
  ): void {
    this.itemEuler.set(
      transform.rotationX,
      transform.rotationY,
      transform.rotationZ,
      'XYZ',
    )
    this.corners[0].set(-halfWidth, -halfHeight, 0)
    this.corners[1].set(halfWidth, -halfHeight, 0)
    this.corners[2].set(halfWidth, halfHeight, 0)
    this.corners[3].set(-halfWidth, halfHeight, 0)
    for (const corner of this.corners) {
      corner.applyEuler(this.itemEuler).applyEuler(this.groupEuler).add(center)
    }
  }

  private isFrontFacing(center: Vector3, cameraPosition: Vector3): boolean {
    this.edgeA.copy(this.corners[1]).sub(this.corners[0])
    this.edgeB.copy(this.corners[3]).sub(this.corners[0])
    this.normal.crossVectors(this.edgeA, this.edgeB)
    this.cameraDirection.copy(cameraPosition).sub(center)
    return this.normal.dot(this.cameraDirection) > 0
  }

  private ensureItemIndex(items: readonly MotionItem<TMeta>[]): void {
    if (items !== this.indexedItems) this.rebuildItemIndex(items)
  }

  private rebuildItemIndex(items: readonly MotionItem<TMeta>[]): void {
    this.indexedItems = items
    this.itemIndexById.clear()
    for (let index = 0; index < items.length; index += 1) {
      this.itemIndexById.set(items[index].id, index)
    }
  }
}

function pointHitsQuad(x: number, y: number, corners: Float64Array, padding: number): boolean {
  let hasPositive = false
  let hasNegative = false
  for (let index = 0; index < 4; index += 1) {
    const start = index * 2
    const end = ((index + 1) % 4) * 2
    const cross = (corners[end] - corners[start]) * (y - corners[start + 1])
      - (corners[end + 1] - corners[start + 1]) * (x - corners[start])
    hasPositive ||= cross > 0
    hasNegative ||= cross < 0
  }
  if (!(hasPositive && hasNegative)) return true
  if (!padding) return false
  for (let index = 0; index < 4; index += 1) {
    const start = index * 2
    const end = ((index + 1) % 4) * 2
    if (distanceToSegment(
      x,
      y,
      corners[start],
      corners[start + 1],
      corners[end],
      corners[end + 1],
    ) <= padding) return true
  }
  return false
}

function distanceToSegment(
  x: number,
  y: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): number {
  const dx = endX - startX
  const dy = endY - startY
  const lengthSquared = dx * dx + dy * dy
  if (!lengthSquared) return Math.hypot(x - startX, y - startY)
  const amount = Math.min(
    1,
    Math.max(0, ((x - startX) * dx + (y - startY) * dy) / lengthSquared),
  )
  return Math.hypot(x - (startX + amount * dx), y - (startY + amount * dy))
}

export function visibilityRank(index: number): number {
  return (index * 0.618033988749895) % 1
}
