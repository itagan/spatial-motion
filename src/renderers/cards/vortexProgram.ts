import { defineBuiltinEffectProgram } from './builtinEffectProgram.js'

export const vortexProgram = defineBuiltinEffectProgram('vortex', 'program_vortex_', `
  programVisible = step(0.0, program_vortex_speed);
  float p = fract(program_vortex_path.z + program_vortex_time * program_vortex_b.x * abs(program_vortex_speed));
  float curved = program_effectTravel(p);
  float travel = program_vortex_c.x > 0.5 ? curved : 1.0 - curved;
  float angle = program_vortex_path.x + p * program_vortex_b.y * 6.28318530718 * (program_vortex_c.x > 0.5 ? 1.0 : -1.0);
  float radius = mix(program_vortex_a.x, program_vortex_path.y, smoothstep(0.0, 1.0, travel));
  center = vec3(cos(angle) * radius, sin(angle) * radius, mix(program_vortex_a.w, program_vortex_a.z, travel));
  itemScale = mix(program_vortex_b.z, program_vortex_b.w, travel);
  opacity *= program_effectEdgeFade(p, 0.07, 0.18);
`)
