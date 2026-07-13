import { PerspectiveCamera, Scene, WebGLRenderer } from 'three'
import type { Layout, MotionItem, QualityLevel, Transform, TransitionOptions } from './types'
import { easing, identityTransform, interpolateTransform } from './math'
import { InstancedCardRenderer } from '../renderers/InstancedCardRenderer'
import { detectQuality, qualityProfiles, visibleRatios } from '../performance/quality'
import {
  AdaptivePerformanceManager,
  type PerformanceStats,
} from '../performance/AdaptivePerformanceManager'
import { Timeline } from './Timeline'
import { TunnelEffect } from '../effects/TunnelEffect'
import { LinearShooterEffect } from '../effects/LinearShooterEffect'
import type { StreamingEffect } from '../effects/types'

export interface MotionStageOptions {
  container: HTMLElement
  items?: MotionItem[]
  quality?: QualityLevel | 'auto'
  cameraZ?: number
  adaptivePerformance?: boolean
  onQualityChange?: (quality: QualityLevel, stats: PerformanceStats) => void
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
  private activeTransition: {
    from: Transform[]
    to: Transform[]
    startedAt: number
    duration: number
    easing: (value: number) => number
  } | null = null
  private activeEffect: { effect: StreamingEffect; startedAt: number } | null = null
  private quality: QualityLevel
  private readonly performanceManager: AdaptivePerformanceManager

  constructor(private readonly options: MotionStageOptions) {
    this.quality = options.quality === 'auto' || !options.quality ? detectQuality() : options.quality
    this.performanceManager = new AdaptivePerformanceManager(this.quality)
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
    this.transitionToken += 1
    this.activeTransition = null
    this.activeEffect = null
    this.cards.disableEffect()
    const maxItems = qualityProfiles[this.quality].maxVisibleItems
    this.items = items.slice(0, maxItems)
    this.transforms = this.items.map(identityTransform)
    await this.cards.setItems(this.items)
    this.cards.setTransforms(this.transforms)
    this.cards.setVisibleRatio(visibleRatios[this.quality])
  }

  async to(layout: Layout, options: TransitionOptions = {}): Promise<boolean> {
    const now = performance.now()
    this.transforms = this.resolveCurrentTransforms(now)
    if (this.activeEffect) {
      this.activeEffect = null
      this.cards.disableEffect()
    }
    const token = ++this.transitionToken
    const from = this.transforms
    const target = layout.calculate(this.items.length, this.context())
    this.cards.setOrientation(layout.orientation ?? 'surface')
    this.cards.setHideBackHemisphere(layout.hideBackHemisphere ?? false)
    const duration = Math.max(0, options.duration ?? 1200)
    const ease = options.easing ?? easing.cubicInOut
    if (duration === 0) {
      this.transforms = target
      this.activeTransition = null
      this.cards.setTransforms(target)
      return true
    }
    this.activeTransition = { from, to: target, startedAt: now, duration, easing: ease }
    this.cards.prepareTransition(from, target)
    return new Promise<boolean>((resolve) => {
      const update = (frameTime: number) => {
        if (token !== this.transitionToken) return resolve(false)
        const progress = Math.min(1, (frameTime - now) / duration)
        const eased = ease(progress)
        this.cards.setProgress(eased)
        if (progress < 1) requestAnimationFrame(update)
        else {
          this.transforms = target
          this.activeTransition = null
          resolve(true)
        }
      }
      requestAnimationFrame(update)
    })
  }

  async enterTunnel(effect: TunnelEffect, options: TransitionOptions = {}): Promise<boolean> {
    return this.enterStreamingEffect(effect, () => this.cards.enableTunnel(effect.getGpuData()), options)
  }

  async enterLinearShooter(effect: LinearShooterEffect, options: TransitionOptions = {}): Promise<boolean> {
    return this.enterStreamingEffect(effect, () => this.cards.enableLinearShooter(effect.getGpuData()), options)
  }

  private async enterStreamingEffect(
    effect: StreamingEffect,
    enableEffect: () => void,
    options: TransitionOptions,
  ): Promise<boolean> {
    effect.prepare(this.items.length)
    const target = effect.calculateTransforms(this.items.length, 0)
    const entered = await this.to(
      {
        name: `${effect.name}-entry`,
        orientation: 'camera',
        hideBackHemisphere: false,
        calculate: () => target,
      },
      options,
    )
    if (!entered) return false
    enableEffect()
    this.activeEffect = { effect, startedAt: performance.now() }
    return true
  }

  autoRotate(options: { x?: number; y?: number } = {}): void {
    this.rotateSpeedX = options.x ?? 0
    this.rotateSpeedY = options.y ?? 0.25
  }

  stopRotation(): void {
    this.rotateSpeedX = 0
    this.rotateSpeedY = 0
  }

  setRotation(x: number, y: number): void {
    this.rotateX = x
    this.rotateY = y
    this.cards.setGroupRotation(x, y)
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

  getPerformanceStats(): PerformanceStats {
    return this.performanceManager.getStats()
  }

  private context() {
    return { width: this.options.container.clientWidth, height: this.options.container.clientHeight }
  }

  private resolveCurrentTransforms(now: number): Transform[] {
    if (this.activeEffect) {
      return this.activeEffect.effect.calculateTransforms(
        this.items.length,
        Math.max(0, (now - this.activeEffect.startedAt) / 1000),
      )
    }
    if (!this.activeTransition) return this.transforms.map((transform) => ({ ...transform }))
    const { from, to, startedAt, duration, easing: transitionEasing } = this.activeTransition
    const progress = transitionEasing(Math.min(1, Math.max(0, (now - startedAt) / duration)))
    return to.map((transform, index) =>
      interpolateTransform(from[index] ?? identityTransform(), transform, progress),
    )
  }

  private readonly render = (now: number) => {
    const rawFrameMs = now - this.lastFrame || 0
    const delta = Math.min(0.05, rawFrameMs / 1000)
    this.lastFrame = now
    if (this.options.adaptivePerformance !== false && document.visibilityState === 'visible') {
      const nextQuality = this.performanceManager.recordFrame(rawFrameMs, now)
      if (nextQuality) this.applyQuality(nextQuality)
    }
    this.rotateX += this.rotateSpeedX * delta
    this.rotateY += this.rotateSpeedY * delta
    this.cards.setGroupRotation(this.rotateX, this.rotateY)
    if (this.activeEffect) {
      this.cards.setEffectTime(Math.max(0, (now - this.activeEffect.startedAt) / 1000))
    }
    this.renderer.render(this.scene, this.camera)
    this.frameId = requestAnimationFrame(this.render)
  }

  private applyQuality(quality: QualityLevel): void {
    this.quality = quality
    const profile = qualityProfiles[quality]
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, profile.maxPixelRatio))
    this.cards.setVisibleRatio(visibleRatios[quality])
    this.resize()
    this.options.onQualityChange?.(quality, this.performanceManager.getStats())
  }
}
