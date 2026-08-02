interface StageClockWait {
  remainingMs: number
  complete: (result?: boolean) => void
}

export class StageClock {
  private readonly waits = new Set<StageClockWait>()

  wait(duration: number): {
    promise: Promise<boolean | void>
    cancel: () => void
  } {
    let settled = false
    let resolvePromise!: (result?: boolean) => void
    const wait: StageClockWait = {
      remainingMs: Math.max(0, Number.isFinite(duration) ? duration : 0),
      complete: (result) => {
        if (settled) return
        settled = true
        this.waits.delete(wait)
        resolvePromise(result)
      },
    }
    const promise = new Promise<boolean | void>((resolve) => { resolvePromise = resolve })
    if (wait.remainingMs === 0) wait.complete()
    else this.waits.add(wait)
    return { promise, cancel: () => wait.complete(false) }
  }

  advance(deltaMs: number): void {
    if (deltaMs <= 0) return
    for (const wait of this.waits) {
      wait.remainingMs -= deltaMs
      if (wait.remainingMs <= 0) wait.complete()
    }
  }

  hasPendingWaits(): boolean {
    return this.waits.size > 0
  }

  dispose(): void {
    for (const wait of this.waits) wait.complete(false)
    this.waits.clear()
  }
}
