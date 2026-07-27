export type StageEventListener<T> = (event: Readonly<T>) => void

export class StageEventHub<TEvents extends object> {
  private readonly listeners = new Map<keyof TEvents, Set<StageEventListener<never>>>()

  on<TKey extends keyof TEvents>(
    type: TKey,
    listener: StageEventListener<TEvents[TKey]>,
  ): () => void {
    let listeners = this.listeners.get(type)
    if (!listeners) {
      listeners = new Set()
      this.listeners.set(type, listeners)
    }
    listeners.add(listener as StageEventListener<never>)
    return () => this.off(type, listener)
  }

  off<TKey extends keyof TEvents>(
    type: TKey,
    listener: StageEventListener<TEvents[TKey]>,
  ): void {
    const listeners = this.listeners.get(type)
    listeners?.delete(listener as StageEventListener<never>)
    if (listeners?.size === 0) this.listeners.delete(type)
  }

  emit<TKey extends keyof TEvents>(type: TKey, event: TEvents[TKey]): void {
    const listeners = this.listeners.get(type)
    if (!listeners) return
    for (const listener of [...listeners]) {
      try {
        listener(Object.freeze({ ...event }) as never)
      } catch (error) {
        queueMicrotask(() => { throw error })
      }
    }
  }

  clear(): void {
    this.listeners.clear()
  }
}
