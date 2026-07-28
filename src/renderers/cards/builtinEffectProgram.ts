import type { BuiltinStreamingEffectPayload } from '../../effects/types.js'
import {
  defineCardEffectProgram,
  type CardEffectProgram,
  type CardProgramUploadContext,
} from './programs.js'

const helpers = `
  float program_effectTravel(float progress) {
    float value = clamp(progress, 0.0, 1.0);
    return value * value * value * (value * (value * 6.0 - 15.0) + 10.0);
  }
  float program_effectEdgeFade(float progress, float fadeIn, float fadeOut) {
    return smoothstep(0.0, fadeIn, progress)
      * (1.0 - smoothstep(1.0 - fadeOut, 1.0, progress));
  }
  float program_emissionEnvelope(float time, float mode, float interval, float duration, float frequency, float strength) {
    if (mode < 0.5) return 1.0;
    if (mode > 1.5) {
      float wave = sin(time * frequency * 6.28318530718) * 0.5 + 0.5;
      return mix(1.0 - strength, 1.0, wave);
    }
    float phase = mod(time, max(0.001, interval));
    float edge = min(0.1, duration * 0.25);
    return smoothstep(0.0, edge, phase)
      * (1.0 - smoothstep(duration - edge, duration, phase));
  }
`

export function defineBuiltinEffectProgram(
  kind: string,
  prefix: string,
  vertexBody: string,
): CardEffectProgram<BuiltinStreamingEffectPayload> {
  return defineCardEffectProgram<BuiltinStreamingEffectPayload>({
    kind,
    prefix,
    attributes: [
      { name: `${prefix}path`, itemSize: 4 },
      { name: `${prefix}speed`, itemSize: 1, initialValue: -1 },
    ],
    uniforms: [
      { name: `${prefix}time`, type: 'float' },
      { name: `${prefix}a`, type: 'vec4' },
      { name: `${prefix}b`, type: 'vec4' },
      { name: `${prefix}c`, type: 'vec4' },
    ],
    vertexDeclarations: helpers,
    vertexBody,
    upload(context, payload) {
      validatePayload(payload)
      uploadBuiltin(context, prefix, payload)
    },
  })
}

function uploadBuiltin(
  context: CardProgramUploadContext,
  prefix: string,
  payload: BuiltinStreamingEffectPayload,
): void {
  context.setAttribute(`${prefix}path`, payload.paths)
  context.setAttribute(`${prefix}speed`, payload.speedFactors)
  context.setUniform(`${prefix}time`, 0)
  context.setUniform(`${prefix}a`, payload.parameters.subarray(0, 4))
  context.setUniform(`${prefix}b`, payload.parameters.subarray(4, 8))
  context.setUniform(`${prefix}c`, payload.parameters.subarray(8, 12))
}

function validatePayload(payload: BuiltinStreamingEffectPayload): void {
  if (
    !(payload?.paths instanceof Float32Array)
    || !(payload.speedFactors instanceof Float32Array)
    || !(payload.parameters instanceof Float32Array)
    || payload.parameters.length < 12
  ) {
    throw new TypeError('Invalid built-in Cards effect payload')
  }
}
