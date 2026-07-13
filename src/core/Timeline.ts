export type TimelineStep = () => Promise<boolean | void> | boolean | void

export class Timeline {
  private readonly steps: TimelineStep[] = []
  private cancelled = false

  add(step: TimelineStep): this {
    this.steps.push(step)
    return this
  }

  wait(duration: number): this {
    return this.add(() => new Promise((resolve) => window.setTimeout(resolve, duration)))
  }

  async play(): Promise<void> {
    this.cancelled = false
    for (const step of this.steps) {
      if (this.cancelled) break
      const result = await step()
      if (result === false) break
    }
  }

  cancel(): void {
    this.cancelled = true
  }
}
