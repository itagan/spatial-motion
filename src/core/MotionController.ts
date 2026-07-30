import type { MotionRendererVisualState } from '../renderers/MotionRenderer.js'
import type { Layout } from './types.js'
import { interpolateAngle } from './math.js'
import {
  TransformBuffer,
  type TransformBufferView,
} from './TransformBuffer.js'

export type MotionTransitionStatus =
  | 'running'
  | 'completed'
  | 'interrupted'
  | 'aborted'
  | 'destroyed'

export interface MotionTransitionResult {
  completed: boolean
  status: Exclude<MotionTransitionStatus, 'running'>
}

interface ActiveMotionTransition {
  from: TransformBuffer
  to: TransformBuffer
  elapsedMs: number
  lastUpdatedAt: number
  duration: number
  easing: (value: number) => number
  fromVisual: MotionRendererVisualState
  toVisual: MotionRendererVisualState
  targetLayout: Layout
  layout: string
  resolve: (result: MotionTransitionResult) => void
  removeAbortListener: () => void
}

interface StartTransitionOptions {
  from: TransformBuffer
  to: TransformBuffer
  fromVisual: MotionRendererVisualState
  toVisual: MotionRendererVisualState
  targetLayout: Layout
  duration: number
  easing: (value: number) => number
  now: number
  signal?: AbortSignal
}

export interface MotionTransitionSnapshot {
  from: TransformBufferView
  to: TransformBufferView
  fromVisual: MotionRendererVisualState
  toVisual: MotionRendererVisualState
  progress: number
  targetLayout: Layout
}

export class MotionController {
  private activeTransition: ActiveMotionTransition | null = null
  private lastStatus: MotionTransitionStatus | null = null
  private lastLayout: string | null = null
  private readonly resolvedBuffer = new TransformBuffer()

  hasActiveTransition(): boolean {
    return this.activeTransition !== null
  }

  getTargetLayout(): Layout | null {
    return this.activeTransition?.targetLayout ?? null
  }

  getState(now: number, paused: boolean): {
    active: boolean
    status: MotionTransitionStatus | null
    layout: string | null
    progress: number
  } {
    const transition = this.activeTransition
    return transition
      ? {
          active: true,
          status: 'running',
          layout: transition.layout,
          progress: this.progress(transition, now, paused),
        }
      : {
          active: false,
          status: this.lastStatus,
          layout: this.lastLayout,
          progress: this.lastStatus === 'completed' ? 1 : 0,
        }
  }

  start(options: StartTransitionOptions): Promise<MotionTransitionResult> {
    if (options.signal?.aborted) {
      return Promise.resolve(this.record(options.targetLayout.name, 'aborted'))
    }
    return new Promise<MotionTransitionResult>((resolve) => {
      const transition: ActiveMotionTransition = {
        from: options.from,
        to: options.to,
        elapsedMs: 0,
        lastUpdatedAt: options.now,
        duration: options.duration,
        easing: options.easing,
        fromVisual: options.fromVisual,
        toVisual: options.toVisual,
        targetLayout: options.targetLayout,
        layout: options.targetLayout.name,
        resolve,
        removeAbortListener: () => {},
      }
      const handleAbort = () => {
        if (this.activeTransition === transition) this.cancel('aborted')
      }
      options.signal?.addEventListener('abort', handleAbort, { once: true })
      transition.removeAbortListener = () =>
        options.signal?.removeEventListener('abort', handleAbort)
      this.activeTransition = transition
    })
  }

  settle(
    layout: string,
    status: 'completed' | 'aborted',
  ): MotionTransitionResult {
    return this.record(layout, status)
  }

  cancel(status: 'interrupted' | 'aborted' | 'destroyed'): void {
    const transition = this.activeTransition
    if (!transition) return
    this.activeTransition = null
    transition.removeAbortListener()
    const result = this.record(transition.layout, status)
    transition.resolve(result)
  }

  advance(now: number, setProgress: (progress: number) => void): TransformBuffer | null {
    const transition = this.activeTransition
    if (!transition) return null
    transition.elapsedMs += Math.max(0, now - transition.lastUpdatedAt)
    transition.lastUpdatedAt = now
    const progress = Math.min(1, transition.elapsedMs / transition.duration)
    setProgress(transition.easing(progress))
    if (progress < 1) return null
    this.activeTransition = null
    transition.removeAbortListener()
    const result = this.record(transition.layout, 'completed')
    transition.resolve(result)
    return transition.to
  }

  rebaseClock(now: number): void {
    if (this.activeTransition) this.activeTransition.lastUpdatedAt = now
  }

  resolveBuffer(
    settled: TransformBufferView,
    now: number,
    paused: boolean,
  ): TransformBufferView {
    const transition = this.activeTransition
    if (!transition) return settled
    const progress = transition.easing(this.progress(transition, now, paused))
    return interpolateBuffers(
      transition.from,
      transition.to,
      progress,
      this.resolvedBuffer,
    )
  }

  resolveVisualState(
    settled: MotionRendererVisualState,
    now: number,
    paused: boolean,
  ): MotionRendererVisualState {
    const transition = this.activeTransition
    if (!transition) return settled
    const progress = transition.easing(this.progress(transition, now, paused))
    return interpolateVisualState(transition.fromVisual, transition.toVisual, progress)
  }

  getSnapshot(now: number, paused: boolean): MotionTransitionSnapshot | null {
    const transition = this.activeTransition
    if (!transition) return null
    return {
      from: transition.from,
      to: transition.to,
      fromVisual: transition.fromVisual,
      toVisual: transition.toVisual,
      progress: transition.easing(this.progress(transition, now, paused)),
      targetLayout: transition.targetLayout,
    }
  }

  private progress(
    transition: ActiveMotionTransition,
    now: number,
    paused: boolean,
  ): number {
    const pendingMs = paused ? 0 : Math.max(0, now - transition.lastUpdatedAt)
    return Math.min(1, (transition.elapsedMs + pendingMs) / transition.duration)
  }

  private record(
    layout: string,
    status: Exclude<MotionTransitionStatus, 'running'>,
  ): MotionTransitionResult {
    this.lastStatus = status
    this.lastLayout = layout
    return { completed: status === 'completed', status }
  }
}

function interpolateBuffers(
  from: TransformBufferView,
  to: TransformBufferView,
  progress: number,
  target: TransformBuffer,
): TransformBuffer {
  target.resize(to.count)
  for (let index = 0; index < to.count; index += 1) {
    const offset = index * 3
    const hasFrom = index < from.count
    for (let axis = 0; axis < 3; axis += 1) {
      const component = offset + axis
      target.positions[component] = lerp(
        hasFrom ? from.positions[component] : 0,
        to.positions[component],
        progress,
      )
      target.rotations[component] = interpolateAngle(
        hasFrom ? from.rotations[component] : 0,
        to.rotations[component],
        progress,
      )
    }
    target.scales[index] = lerp(
      hasFrom ? from.scales[index] : 0.01,
      to.scales[index],
      progress,
    )
    target.opacities[index] = lerp(
      hasFrom ? from.opacities[index] : 1,
      to.opacities[index],
      progress,
    )
  }
  return target
}

function lerp(from: number, to: number, progress: number): number {
  return from + (to - from) * progress
}

function interpolateVisualState(
  from: MotionRendererVisualState,
  to: MotionRendererVisualState,
  progress: number,
): MotionRendererVisualState {
  return {
    billboard: from.billboard + (to.billboard - from.billboard) * progress,
    hideBackHemisphere: from.hideBackHemisphere
      + (to.hideBackHemisphere - from.hideBackHemisphere) * progress,
    hemisphereEdgeFade: from.hemisphereEdgeFade
      + (to.hemisphereEdgeFade - from.hemisphereEdgeFade) * progress,
  }
}
