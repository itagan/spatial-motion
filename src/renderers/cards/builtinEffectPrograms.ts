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

export const builtinEffectPrograms: Readonly<Record<string, CardEffectProgram>> = Object.freeze({
  tunnel: builtin('tunnel', 'program_tunnel_', `
    programVisible = step(0.0, program_tunnel_speed);
    float p = fract(program_tunnel_path.z + program_tunnel_time * program_tunnel_a.w * abs(program_tunnel_speed));
    float travel = program_effectTravel(p);
    float spread = smoothstep(0.0, 1.0, travel);
    float angle = program_tunnel_path.x + p * program_tunnel_b.x;
    vec2 direction = vec2(cos(angle), sin(angle));
    if (program_tunnel_path.w > 0.5) direction /= max(max(abs(direction.x), abs(direction.y)), 0.000001);
    center = vec3(direction * mix(program_tunnel_a.z, program_tunnel_path.y, spread), mix(program_tunnel_a.x, program_tunnel_a.y, travel));
    itemScale = mix(program_tunnel_b.y, program_tunnel_b.z, travel);
    opacity *= program_effectEdgeFade(p, 0.08, 0.18);
    opacity *= program_emissionEnvelope(program_tunnel_time, program_tunnel_b.w, program_tunnel_c.x, program_tunnel_c.y, program_tunnel_c.z, program_tunnel_c.w);
  `),
  'linear-shooter': builtin('linear-shooter', 'program_shooter_', `
    programVisible = step(0.0, program_shooter_speed);
    float p = fract(program_shooter_path.z + program_shooter_time * program_shooter_a.y * abs(program_shooter_speed));
    float travel = program_effectTravel(p);
    float distance = mix(program_shooter_a.x, program_shooter_path.y, travel);
    center = vec3(cos(program_shooter_path.x) * distance, sin(program_shooter_path.x) * distance, program_shooter_b.x);
    itemScale = mix(program_shooter_a.z, program_shooter_a.w, travel);
    opacity *= program_effectEdgeFade(p, 0.06, 0.22);
    opacity *= program_emissionEnvelope(program_shooter_time, program_shooter_b.w, program_shooter_c.x, program_shooter_c.y, program_shooter_c.z, program_shooter_c.w);
  `),
  vortex: builtin('vortex', 'program_vortex_', `
    programVisible = step(0.0, program_vortex_speed);
    float p = fract(program_vortex_path.z + program_vortex_time * program_vortex_b.x * abs(program_vortex_speed));
    float curved = program_effectTravel(p);
    float travel = program_vortex_c.x > 0.5 ? curved : 1.0 - curved;
    float angle = program_vortex_path.x + p * program_vortex_b.y * 6.28318530718 * (program_vortex_c.x > 0.5 ? 1.0 : -1.0);
    float radius = mix(program_vortex_a.x, program_vortex_path.y, smoothstep(0.0, 1.0, travel));
    center = vec3(cos(angle) * radius, sin(angle) * radius, mix(program_vortex_a.w, program_vortex_a.z, travel));
    itemScale = mix(program_vortex_b.z, program_vortex_b.w, travel);
    opacity *= program_effectEdgeFade(p, 0.07, 0.18);
  `),
  'radial-burst': builtin('radial-burst', 'program_radial_', `
    programVisible = step(0.0, program_radial_speed);
    float p = fract(program_radial_path.w + program_radial_time * program_radial_a.z * abs(program_radial_speed));
    float curved = program_effectTravel(p);
    float travel = program_radial_b.z > 0.5 ? curved : 1.0 - curved;
    float distance = mix(program_radial_a.x, program_radial_path.z, smoothstep(0.0, 1.0, travel));
    float horizontal = cos(program_radial_path.y) * distance;
    center = vec3(cos(program_radial_path.x) * horizontal, sin(program_radial_path.y) * distance, program_radial_a.w + sin(program_radial_path.x) * horizontal * program_radial_b.w);
    itemScale = mix(program_radial_b.x, program_radial_b.y, travel);
    opacity *= program_effectEdgeFade(p, 0.06, 0.2);
  `),
})

function builtin(kind: string, prefix: string, vertexBody: string): CardEffectProgram {
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
