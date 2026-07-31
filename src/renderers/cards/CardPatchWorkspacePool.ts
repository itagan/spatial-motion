export interface CardPatchWorkspace {
  readonly indices: number[]
  readonly fingerprints: string[]
}

export interface CardPatchWorkspacePoolStats {
  allocations: number
  reuses: number
  available: number
}

const MAX_RETAINED_WORKSPACES = 4

export class CardPatchWorkspacePool {
  private readonly available: CardPatchWorkspace[] = []
  private allocations = 0
  private reuses = 0
  private disposed = false

  acquire(indices: readonly number[] = [], itemCount = 0): CardPatchWorkspace {
    if (this.disposed) throw new Error('Card patch workspace pool is disposed')
    const workspace = this.available.pop()
    if (workspace) {
      this.reuses += 1
      workspace.indices.length = 0
      workspace.fingerprints.length = 0
      normalizeIndices(indices, itemCount, workspace.indices)
      return workspace
    }
    this.allocations += 1
    const created = { indices: [], fingerprints: [] }
    normalizeIndices(indices, itemCount, created.indices)
    return created
  }

  release(workspace: CardPatchWorkspace): void {
    if (
      this.disposed
      || this.available.includes(workspace)
      || this.available.length >= MAX_RETAINED_WORKSPACES
    ) return
    this.available.push(workspace)
  }

  getStats(): CardPatchWorkspacePoolStats {
    return {
      allocations: this.allocations,
      reuses: this.reuses,
      available: this.available.length,
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.available.length = 0
  }
}

function normalizeIndices(indices: readonly number[], itemCount: number, target: number[]): void {
  for (const index of indices) {
    if (Number.isInteger(index) && index >= 0 && index < itemCount) target.push(index)
  }
  target.sort((left, right) => left - right)
  let write = 0
  for (let read = 0; read < target.length; read += 1) {
    if (read > 0 && target[read] === target[read - 1]) continue
    target[write] = target[read]
    write += 1
  }
  target.length = write
}
