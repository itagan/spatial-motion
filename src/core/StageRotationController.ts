import type { Group } from 'three'

export class StageRotationController {
  private x = 0
  private y = 0
  private speedX = 0
  private speedY = 0

  constructor(private readonly root: Group) {}

  get rotationX(): number {
    return this.x
  }

  get rotationY(): number {
    return this.y
  }

  autoRotate(options: { x?: number; y?: number }, reducedMotion: boolean): void {
    if (reducedMotion) {
      this.stop()
      return
    }
    this.speedX = options.x ?? 0
    this.speedY = options.y ?? 0.25
  }

  stop(): void {
    this.speedX = 0
    this.speedY = 0
  }

  set(x: number, y: number): void {
    this.x = x
    this.y = y
    this.apply()
  }

  advance(deltaSeconds: number): void {
    this.x += this.speedX * deltaSeconds
    this.y += this.speedY * deltaSeconds
    this.apply()
  }

  private apply(): void {
    this.root.rotation.set(this.x, this.y, 0)
  }
}
