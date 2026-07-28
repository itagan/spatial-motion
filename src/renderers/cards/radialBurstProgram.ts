import { defineBuiltinEffectProgram } from './builtinEffectProgram.js'

export const radialBurstProgram = defineBuiltinEffectProgram(
  'radial-burst',
  'program_radial_',
  `
    programVisible = step(0.0, program_radial_speed);
    float p = fract(program_radial_path.w + program_radial_time * program_radial_a.z * abs(program_radial_speed));
    float curved = program_effectTravel(p);
    float travel = program_radial_b.z > 0.5 ? curved : 1.0 - curved;
    float distance = mix(program_radial_a.x, program_radial_path.z, smoothstep(0.0, 1.0, travel));
    float horizontal = cos(program_radial_path.y) * distance;
    center = vec3(cos(program_radial_path.x) * horizontal, sin(program_radial_path.y) * distance, program_radial_a.w + sin(program_radial_path.x) * horizontal * program_radial_b.w);
    itemScale = mix(program_radial_b.x, program_radial_b.y, travel);
    opacity *= program_effectEdgeFade(p, 0.06, 0.2);
  `,
)
