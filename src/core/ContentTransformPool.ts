import { TransformBuffer } from './TransformBuffer.js'

export interface ContentTransformPoolStats {
  allocations: number
  reuses: number
  available: number
}

export class ContentTransformPool {
  private readonly available: TransformBuffer[] = []
  private disposed = false
  private allocations = 0
  private reuses = 0

  acquire(count: number): TransformBuffer {
    if (this.disposed) throw new Error('Content transform pool has been disposed')
    const buffer = this.available.pop()
    if (buffer) {
      this.reuses += 1
      return buffer.resize(count)
    }
    this.allocations += 1
    return new TransformBuffer(count)
  }

  release(buffer: TransformBuffer): void {
    if (this.disposed || this.available.includes(buffer)) return
    if (this.available.length < MAX_RETAINED_BUFFERS) this.available.push(buffer)
  }

  getStats(): ContentTransformPoolStats {
    return {
      allocations: this.allocations,
      reuses: this.reuses,
      available: this.available.length,
    }
  }

  dispose(): void {
    this.disposed = true
    this.available.length = 0
  }
}

const MAX_RETAINED_BUFFERS = 4
