export interface ResourceTask<TPrepared, TCommitted = void> {
  prepare(signal: AbortSignal): Promise<TPrepared> | TPrepared
  /** Commit must be synchronous so stale work cannot interleave during publication. */
  commit(prepared: TPrepared): TCommitted
  discard?(prepared: TPrepared): void
}

export type ResourceTaskResult<T> =
  | { readonly status: 'committed'; readonly value: T }
  | { readonly status: 'superseded' | 'aborted' }

export interface ResourceSchedulerStats {
  readonly scheduled: number
  readonly committed: number
  readonly superseded: number
  readonly aborted: number
  readonly failures: number
  readonly prepareMs: number
}

interface ResourceJob {
  readonly controller: AbortController
  cancellation: 'superseded' | 'aborted' | null
}

/**
 * Cancellable prepare/commit coordinator. Independent channels run in parallel;
 * only the newest task in a channel can publish.
 */
export class ResourceScheduler {
  private readonly channels = new Map<string, ResourceJob>()
  private disposed = false
  private scheduled = 0
  private committed = 0
  private superseded = 0
  private aborted = 0
  private failures = 0
  private prepareMs = 0

  scheduleLatest<TPrepared, TCommitted>(
    channel: string,
    task: ResourceTask<TPrepared, TCommitted>,
  ): Promise<ResourceTaskResult<TCommitted>> {
    if (this.disposed) return Promise.resolve({ status: 'aborted' })
    if (!channel) throw new TypeError('Resource task channel cannot be empty')
    const current = this.channels.get(channel)
    this.scheduled += 1
    this.cancelJob(current, 'superseded')
    const job: ResourceJob = {
      controller: new AbortController(),
      cancellation: null,
    }
    this.channels.set(channel, job)
    return this.execute(channel, job, task)
  }

  cancel(channel: string): void {
    const job = this.channels.get(channel)
    this.cancelJob(job, 'aborted')
    if (job) this.channels.delete(channel)
  }

  isPending(channel: string): boolean {
    return this.channels.has(channel)
  }

  getStats(): ResourceSchedulerStats {
    return {
      scheduled: this.scheduled,
      committed: this.committed,
      superseded: this.superseded,
      aborted: this.aborted,
      failures: this.failures,
      prepareMs: this.prepareMs,
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const job of this.channels.values()) this.cancelJob(job, 'aborted')
    this.channels.clear()
  }

  private async execute<TPrepared, TCommitted>(
    channel: string,
    job: ResourceJob,
    task: ResourceTask<TPrepared, TCommitted>,
  ): Promise<ResourceTaskResult<TCommitted>> {
    const startedAt = performance.now()
    let prepared: TPrepared
    try {
      prepared = await task.prepare(job.controller.signal)
      this.prepareMs += performance.now() - startedAt
    } catch (error) {
      this.prepareMs += performance.now() - startedAt
      if (job.controller.signal.aborted) return this.finishCancellation(channel, job)
      this.failures += 1
      this.cleanup(channel, job)
      throw error
    }
    if (job.controller.signal.aborted || this.channels.get(channel) !== job) {
      task.discard?.(prepared)
      return this.finishCancellation(channel, job)
    }
    try {
      const value = task.commit(prepared)
      this.committed += 1
      this.cleanup(channel, job)
      return { status: 'committed', value }
    } catch (error) {
      task.discard?.(prepared)
      this.failures += 1
      this.cleanup(channel, job)
      throw error
    }
  }

  private cancelJob(
    job: ResourceJob | undefined,
    reason: 'superseded' | 'aborted',
  ): void {
    if (!job || job.controller.signal.aborted) return
    job.cancellation = reason
    job.controller.abort()
  }

  private finishCancellation(
    channel: string,
    job: ResourceJob,
  ): { status: 'superseded' | 'aborted' } {
    const status = job.cancellation ?? 'aborted'
    if (status === 'superseded') this.superseded += 1
    else this.aborted += 1
    this.cleanup(channel, job)
    return { status }
  }

  private cleanup(channel: string, job: ResourceJob): void {
    if (this.channels.get(channel) === job) this.channels.delete(channel)
  }
}
