import {
  MotionStage,
  cardsRenderer,
  defineCardEffectProgram,
  sphere,
  type StreamingEffect,
  type Transform,
} from '@itagan/spatial-motion'
import '../shared.css'

interface WavePayload {
  phases: Float32Array
  amplitude: number
}

const waveProgram = defineCardEffectProgram<WavePayload>({
  kind: 'business-wave',
  prefix: 'program_wave_',
  attributes: [{ name: 'program_wave_phase', itemSize: 1 }],
  uniforms: [
    { name: 'program_wave_time', type: 'float' },
    { name: 'program_wave_amplitude', type: 'float', initialValue: 2.4 },
  ],
  vertexBody: `
    float angle = program_wave_phase * 6.28318530718;
    float radius = 4.8 + sin(program_wave_time * 1.8 + angle * 3.0) * program_wave_amplitude;
    center = vec3(cos(angle) * radius, sin(angle * 2.0 + program_wave_time) * 2.4, sin(angle) * radius);
    itemScale = 0.72 + sin(program_wave_time * 2.0 + angle) * 0.12;
  `,
  upload(context, payload) {
    context.setAttribute('program_wave_phase', payload.phases)
    context.setUniform('program_wave_time', 0)
    context.setUniform('program_wave_amplitude', payload.amplitude)
  },
})

class BusinessWaveEffect implements StreamingEffect {
  readonly name = 'business-wave'
  readonly kind = 'business-wave'
  private phases = new Float32Array()
  private activeCount = 0

  prepare(count: number, activeLimit = count): void {
    this.activeCount = Math.min(count, activeLimit)
    if (this.phases.length === count) return
    this.phases = Float32Array.from({ length: count }, (_, index) => index / Math.max(1, count))
  }

  calculateTransforms(count: number): Transform[] {
    return Array.from({ length: count }, (_, index) => {
      const angle = index / Math.max(1, count) * Math.PI * 2
      return {
        x: Math.cos(angle) * 4.8,
        y: 0,
        z: Math.sin(angle) * 4.8,
        scale: 0.72,
        rotationX: 0,
        rotationY: 0,
        rotationZ: 0,
        opacity: index < this.activeCount ? 1 : 0,
      }
    })
  }

  getGpuData() {
    return {
      kind: this.kind,
      activeCount: this.activeCount,
      payload: { phases: this.phases, amplitude: 1.25 },
    }
  }
}

const status = document.querySelector<HTMLElement>('#status')!
const stage = new MotionStage({
  container: document.querySelector<HTMLElement>('#stage')!,
  renderer: cardsRenderer({
    effectPrograms: { 'business-wave': waveProgram },
  }),
  quality: 'auto',
  hover: true,
  hoverEffect: 'highlight',
})
const businessLayout = sphere({ radius: 4.8 })
await stage.setItems(Array.from({ length: 320 }, (_, index) => ({
  id: `business-${index}`,
  title: `Node ${index + 1}`,
})))
await stage.to(businessLayout, { duration: 0 })

document.querySelector('#effect')?.addEventListener('click', () => {
  void stage.enterEffect(new BusinessWaveEffect(), { duration: 500 })
})
document.querySelector('#layout')?.addEventListener('click', () => {
  void stage.to(businessLayout, { duration: 500 })
})
stage.on('effecterror', ({ error }) => {
  status.textContent = `PROGRAM ERROR · ${String(error)}`
})

const timer = window.setInterval(() => {
  const stats = stage.getPerformanceStats()
  status.textContent = `${stats.render.drawCalls} DRAW · ${stats.submittedItems} ITEMS · ${stats.renderer.metrics.cachedPrograms ?? 0} PROGRAM`
}, 500)
window.addEventListener('pagehide', () => {
  window.clearInterval(timer)
  stage.destroy()
}, { once: true })
