import { PerspectiveCamera, Scene, WebGLRenderer } from 'three'
import type { Layout, MotionItem, QualityLevel, Transform, TransitionOptions } from './types'
import { easing, identityTransform, interpolateTransform } from './math'
import { InstancedCardRenderer } from '../renderers/InstancedCardRenderer'
import { detectQuality, qualityProfiles } from '../performance/quality'
import { Timeline } from './Timeline'

export interface MotionStageOptions {
  container: HTMLElement
  items?: MotionItem[]
  quality?: QualityLevel | 'auto'
  cameraZ?: number
}

export class MotionStage {
  private readonly scene = new Scene()
  private readonly camera: PerspectiveCamera
  private readonly renderer: WebGLRenderer
  private readonly cards: InstancedCardRenderer
  private readonly resizeObserver: ResizeObserver
  private items: MotionItem[] = []
  private transforms: Transform[] = []
  private frameId = 0
  private lastFrame = 0
  private rotateX = 0
  private rotateY = 0
  private rotateSpeedX = 0
  private rotateSpeedY = 0
  private transitionToken = 0
  private readonly quality: QualityLevel

  constructor(private readonly options: MotionStageOptions) {
    this.quality = options.quality === 'auto' || !options.quality ? detectQuality() : options.quality
    const profile = qualityProfiles[this.quality]
    this.camera = new PerspectiveCamera(45, 1, 0.1, 100)
    this.camera.position.z = options.cameraZ ?? 18
    this.renderer = new WebGLRenderer({ alpha: true, antialias: profile.antialias, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, profile.maxPixelRatio))
    this.options.container.appendChild(this.renderer.domElement)
    this.cards = new InstancedCardRenderer(this.scene)
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(this.options.container)
    this.resize()
    this.frameId = requestAnimationFrame(this.render)
  }

  async setItems(items: MotionItem[]): Promise<void> {
    const maxItems = qualityProfiles[this.quality].maxVisibleItems
    this.items = items.slice(0, maxItems)
    this.transforms = this.items.map(identityTransform)
    await this.cards.setItems(this.items)
    this.cards.apply(this.transforms)
  }

  async to(layout: Layout, options: TransitionOptions = {}): Promise<void> {
    const token = ++this.transitionToken
    const from = this.transforms.map((transform) => ({ ...transform }))
    const target = layout.calculate(this.items.length, this.context())
    this.cards.setOrientation(layout.orientation ?? 'surface')
    this.cards.setHideBackHemisphere(layout.hideBackHemisphere ?? false)
    const duration = Math.max(0, options.duration ?? 1200)
    const ease = options.easing ?? easing.cubicInOut
    if (duration === 0) {
      this.transforms = target
      this.cards.apply(target)
      return
    }
    await new Promise<void>((resolve) => {
      const startedAt = performance.now()
      const update = (now: number) => {
        if (token !== this.transitionToken) return resolve()
        const progress = Math.min(1, (now - startedAt) / duration)
        const eased = ease(progress)
        this.transforms = target.map((transform, index) =>
          interpolateTransform(from[index] ?? identityTransform(), transform, eased),
        )
        this.cards.apply(this.transforms)
        if (progress < 1) requestAnimationFrame(update)
        else resolve()
      }
      requestAnimationFrame(update)
    })
  }

  autoRotate(options: { x?: number; y?: number } = {}): void {
    this.rotateSpeedX = options.x ?? 0
    this.rotateSpeedY = options.y ?? 0.25
  }

  stopRotation(): void {
    this.rotateSpeedX = 0
    this.rotateSpeedY = 0
  }

  timeline(): Timeline {
    return new Timeline()
  }

  resize(): void {
    const { clientWidth: width, clientHeight: height } = this.options.container
    if (!width || !height) return
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height, false)
  }

  destroy(): void {
    this.transitionToken += 1
    cancelAnimationFrame(this.frameId)
    this.resizeObserver.disconnect()
    this.cards.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  getQuality(): QualityLevel {
    return this.quality
  }

  private context() {
    return { width: this.options.container.clientWidth, height: this.options.container.clientHeight }
  }

  private readonly render = (now: number) => {
    const delta = Math.min(0.05, (now - this.lastFrame) / 1000 || 0)
    this.lastFrame = now
    this.rotateX += this.rotateSpeedX * delta
    this.rotateY += this.rotateSpeedY * delta
    this.cards.setGroupRotation(this.rotateX, this.rotateY)
    this.renderer.render(this.scene, this.camera)
    this.frameId = requestAnimationFrame(this.render)
  }
}
