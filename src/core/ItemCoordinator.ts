import type { MotionItem } from './types.js'

type ItemPatch<TMeta> = Partial<Omit<MotionItem<TMeta>, 'id'>>

export interface CoordinatedItemUpdate<TMeta> {
  id: string
  patch: ItemPatch<TMeta>
}

interface PreparedItems<TMeta> {
  sourceItems: MotionItem<TMeta>[]
  visibleItems: MotionItem<TMeta>[]
}

interface PreparedPatch<TMeta> extends PreparedItems<TMeta> {
  changedIndices: number[]
}

interface PendingPatchBatch<TMeta> {
  updates: CoordinatedItemUpdate<TMeta>[]
  resolve: Array<(applied: boolean) => void>
  reject: Array<(reason: unknown) => void>
}

interface ItemCoordinatorOptions<TMeta> {
  applyPatches: (updates: CoordinatedItemUpdate<TMeta>[]) => Promise<boolean>
  isDestroyed: () => boolean
}

export class ItemCoordinator<TMeta> {
  private revision = 0
  private pendingBatch: PendingPatchBatch<TMeta> | null = null
  private updateChain: Promise<unknown> = Promise.resolve()

  constructor(private readonly options: ItemCoordinatorOptions<TMeta>) {}

  validateItems(items: readonly MotionItem<TMeta>[]): void {
    validateMotionItems(items)
  }

  validateUpdates(updates: readonly CoordinatedItemUpdate<TMeta>[]): void {
    const ids = new Set<string>()
    updates.forEach(({ id }, index) => {
      if (!id.trim()) {
        throw new Error(`MotionItem update at index ${index} must have a non-empty id`)
      }
      if (ids.has(id)) throw new Error(`Duplicate MotionItem update id: ${id}`)
      ids.add(id)
    })
  }

  prepareItems(
    items: readonly MotionItem<TMeta>[],
    maxVisibleItems: number,
  ): PreparedItems<TMeta> {
    const sourceItems = items.map((item) => ({ ...item }))
    return {
      sourceItems,
      visibleItems: sourceItems.slice(0, maxVisibleItems),
    }
  }

  preparePatch(
    sourceItems: readonly MotionItem<TMeta>[],
    updates: readonly CoordinatedItemUpdate<TMeta>[],
    maxVisibleItems: number,
  ): PreparedPatch<TMeta> {
    const updatesById = new Map(updates.map((update) => [update.id, update.patch]))
    const knownIds = new Set(sourceItems.map((item) => item.id))
    updates.forEach(({ id }) => {
      if (!knownIds.has(id)) throw new Error(`Unknown MotionItem id: ${id}`)
    })
    const nextSource = sourceItems.map((item) => {
      const patch = updatesById.get(item.id)
      return patch ? { ...item, ...patch, id: item.id } : item
    })
    const visibleItems = nextSource.slice(0, maxVisibleItems)
    return {
      sourceItems: nextSource,
      visibleItems,
      changedIndices: visibleItems
        .map((item, index) => updatesById.has(item.id) ? index : -1)
        .filter((index) => index >= 0),
    }
  }

  beginOperation(): number {
    return ++this.revision
  }

  isCurrent(revision: number): boolean {
    return revision === this.revision && !this.options.isDestroyed()
  }

  invalidate(): void {
    this.revision += 1
  }

  queuePatches(updates: readonly CoordinatedItemUpdate<TMeta>[]): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      if (!this.pendingBatch) {
        this.pendingBatch = { updates: [], resolve: [], reject: [] }
        queueMicrotask(() => { void this.flushPatches() })
      }
      this.pendingBatch.updates.push(...updates)
      this.pendingBatch.resolve.push(resolve)
      this.pendingBatch.reject.push(reject)
    })
  }

  flushPatches(): Promise<unknown> {
    const batch = this.pendingBatch
    if (!batch) return this.updateChain
    this.pendingBatch = null
    const mergedPatches = new Map<string, ItemPatch<TMeta>>()
    batch.updates.forEach(({ id, patch }) => {
      mergedPatches.set(id, { ...mergedPatches.get(id), ...patch })
    })
    const updates = [...mergedPatches].map(([id, patch]) => ({ id, patch }))
    const operation = this.updateChain.then(() => this.options.isDestroyed()
      ? false
      : this.options.applyPatches(updates))
    this.updateChain = operation.then(
      (applied) => {
        batch.resolve.forEach((resolve) => resolve(applied))
      },
      (error) => {
        batch.reject.forEach((reject) => reject(error))
      },
    )
    return operation
  }
}

export function validateMotionItems<TMeta>(items: readonly MotionItem<TMeta>[]): void {
  const ids = new Set<string>()
  items.forEach((item, index) => {
    if (!item.id.trim()) {
      throw new Error(`MotionItem at index ${index} must have a non-empty id`)
    }
    if (ids.has(item.id)) throw new Error(`Duplicate MotionItem id: ${item.id}`)
    ids.add(item.id)
  })
}
