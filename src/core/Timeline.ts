export type TimelineStep = () => Promise<boolean | void> | boolean | void

export class Timeline {
  private readonly steps: TimelineStep[] = []
  private runToken = 0
  private pendingWait: { timeoutId: ReturnType<typeof setTimeout>; resolve: () => void } | null = null

  add(step: TimelineStep): this {
    this.steps.push(step)
    return this
  }

  wait(duration: number): this {
    return this.add(() => new Promise<void>((resolve) => {
      const complete = () => {
        if (this.pendingWait?.resolve === complete) this.pendingWait = null
        resolve()
      }
      const timeoutId = setTimeout(complete, Math.max(0, duration))
      this.pendingWait = { timeoutId, resolve: complete }
    }))
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
    clearTimeout(this.pendingWait.timeoutId)
    const { resolve } = this.pendingWait
    this.pendingWait = null
    resolve()
  }
}
