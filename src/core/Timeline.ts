export type TimelineStep = () => Promise<boolean | void> | boolean | void
export interface TimelineWaitHandle {
  promise: Promise<boolean | void>
  cancel(): void
}
export type TimelineWaiter = (duration: number) => TimelineWaitHandle

export class Timeline {
  private readonly steps: TimelineStep[] = []
  private runToken = 0
  private pendingWait: TimelineWaitHandle | null = null

  constructor(private readonly waiter?: TimelineWaiter) {}

  add(step: TimelineStep): this {
    this.steps.push(step)
    return this
  }

  wait(duration: number): this {
    return this.add(() => {
      const wait = this.waiter?.(duration) ?? timeoutWait(duration)
      this.pendingWait = wait
      return wait.promise.finally(() => {
        if (this.pendingWait === wait) this.pendingWait = null
      })
    })
  }

  async play(): Promise<void> {
    this.cancelPendingWait()
    const token = ++this.runToken
    for (const step of this.steps) {
      if (token !== this.runToken) break
      const result = await step()
      if (token !== this.runToken || result === false) break
    }
  }

  cancel(): void {
    this.runToken += 1
    this.cancelPendingWait()
  }

  private cancelPendingWait(): void {
    if (!this.pendingWait) return
    const wait = this.pendingWait
    this.pendingWait = null
    wait.cancel()
  }
}

function timeoutWait(duration: number): TimelineWaitHandle {
  let resolve!: (result?: boolean) => void
  const timeoutId = setTimeout(() => resolve(), Math.max(0, duration))
  const promise = new Promise<boolean | void>((complete) => { resolve = complete })
  return {
    promise,
    cancel() {
      clearTimeout(timeoutId)
      resolve(false)
    },
  }
}
