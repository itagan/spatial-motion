import { defineBuiltinEffectProgram } from './builtinEffectProgram.js'

export const tunnelProgram = defineBuiltinEffectProgram('tunnel', 'program_tunnel_', `
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
`)
