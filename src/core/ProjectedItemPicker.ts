import {
  Euler,
  Vector3,
  type PerspectiveCamera,
} from 'three'
import type { MotionRendererPickShape } from '../renderers/MotionRenderer.js'
import type { MotionItem } from './types.js'
import type { TransformBufferView } from './TransformBuffer.js'
import { visibilityRank } from './Visibility.js'

export interface ProjectedPickState<TMeta> {
  items: readonly MotionItem<TMeta>[]
  visibleRatio: number
  rotationX: number
  rotationY: number
  orientation: 'surface' | 'camera'
  hideBackHemisphere: boolean
  effectActive: boolean
}

export interface ProjectedPickOptions {
  padding?: number
  includeOccluded?: boolean
}

export interface ProjectedPickResult<TMeta> {
  item: MotionItem<TMeta>
  index: number
  distance: number
}

export interface ProjectedItemPickerOptions<TMeta> {
  element: HTMLCanvasElement
  camera: PerspectiveCamera
  itemBounds: MotionRendererPickShape
  getState: () => ProjectedPickState<TMeta>
  resolveTransformBuffer: (now: number) => TransformBufferView
}

export class ProjectedItemPicker<TMeta> {
  static readonly chunkKind = 'spatial-motion-projected-picker'
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

  constructor(private readonly options: ProjectedItemPickerOptions<TMeta>) {}

  pick(
    clientX: number,
    clientY: number,
    options: number | ProjectedPickOptions,
  ): ProjectedPickResult<TMeta> | null {
    const { itemBounds, element, camera } = this.options
    const rect = element.getBoundingClientRect()
    if (!rect.width || !rect.height) return null
    const state = this.options.getState()
    const transforms = this.options.resolveTransformBuffer(performance.now())
    const {
      positions,
      scales,
      rotations,
      opacities,
      count,
    } = transforms
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

    for (let index = 0; index < count; index += 1) {
      const offset = index * 3
      const opacity = opacities[index]
      const item = state.items[index]
      if (!item || opacity < 0.05 || visibilityRank(index) > state.visibleRatio) continue
      const center = this.center
        .set(
          positions[offset],
          positions[offset + 1],
          positions[offset + 2],
        )
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
        const scale = Math.max(0, scales[index])
        const halfWidth = scale * itemWidth / 2
        const halfHeight = scale * itemHeight / 2
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
            this.setSurfaceCorners(
              center,
              halfWidth,
              halfHeight,
              rotations[offset],
              rotations[offset + 1],
              rotations[offset + 2],
            )
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
    rotationX: number,
    rotationY: number,
    rotationZ: number,
  ): void {
    this.itemEuler.set(
      rotationX,
      rotationY,
      rotationZ,
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
