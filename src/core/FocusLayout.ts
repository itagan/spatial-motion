import {
  TransformBuffer,
  type TransformBufferView,
} from './TransformBuffer.js'
import type { FocusItemsOptions } from './MotionStage.js'
import type { StageMotionCoordinator } from './StageMotionCoordinator.js'
import type { StageContentState } from './StageContentState.js'
import type { Layout, MotionItem } from './types.js'

export function focusItems<TMeta>(
  items: readonly MotionItem<TMeta>[],
  state: StageContentState<TMeta>,
  ids: string[],
  options: FocusItemsOptions,
  isDestroyed: () => boolean,
  motion: StageMotionCoordinator<TMeta>,
): Promise<boolean> {
  const selected = new Set(ids)
  if (!items.some((item) => selected.has(item.id))) return Promise.resolve(false)
  if (isDestroyed() || items !== state.items) return Promise.resolve(false)
  const current = new TransformBuffer().copyFromBuffer(
    motion.resolveTransformBuffer(performance.now()),
  )
  return motion.transition(createFocusLayout(items, ids, current, options), options)
}

export function createFocusLayout<TMeta>(
  items: readonly MotionItem<TMeta>[],
  ids: readonly string[],
  current: TransformBufferView,
  options: FocusItemsOptions,
): Layout<TMeta> {
  const selected = new Set(ids)
  const selectedOrder = new Map<number, number>()
  items.forEach((item, index) => {
    if (selected.has(item.id)) selectedOrder.set(index, selectedOrder.size)
  })
  const columns = Math.max(1, options.columns ?? Math.ceil(Math.sqrt(selectedOrder.size)))
  const rows = Math.ceil(selectedOrder.size / columns)
  const gap = options.gap ?? 1.7
  const focusScale = options.scale ?? 1.45
  const z = options.z ?? 8
  const dimOpacity = options.dimOpacity ?? 0.08

  return {
    name: 'focus',
    orientation: 'camera',
    calculate: () => [],
    calculateInto(count, _context, target) {
      target.resize(count)
      for (let index = 0; index < count; index += 1) {
        const offset = index * 3
        const order = selectedOrder.get(index)
        if (order === undefined) {
          target.setFromBuffer(index, current, index)
          target.scales[index] = Math.min(current.scales[index], 0.35)
          target.opacities[index] = dimOpacity
          continue
        }
        target.positions[offset] = (order % columns - (columns - 1) / 2) * gap
        target.positions[offset + 1] =
          ((rows - 1) / 2 - Math.floor(order / columns)) * gap
        target.positions[offset + 2] = z
        target.scales[index] = focusScale
        target.rotations[offset] = 0
        target.rotations[offset + 1] = 0
        target.rotations[offset + 2] = 0
        target.opacities[index] = 1
      }
    },
  }
}
