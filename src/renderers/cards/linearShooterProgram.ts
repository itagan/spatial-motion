import { defineBuiltinEffectProgram } from './builtinEffectProgram.js'

export const linearShooterProgram = defineBuiltinEffectProgram(
  'linear-shooter',
  'program_shooter_',
  `
    programVisible = step(0.0, program_shooter_speed);
    float p = fract(program_shooter_path.z + program_shooter_time * program_shooter_a.y * abs(program_shooter_speed));
    float travel = program_effectTravel(p);
    float distance = mix(program_shooter_a.x, program_shooter_path.y, travel);
    center = vec3(cos(program_shooter_path.x) * distance, sin(program_shooter_path.x) * distance, program_shooter_b.x);
    itemScale = mix(program_shooter_a.z, program_shooter_a.w, travel);
    opacity *= program_effectEdgeFade(p, 0.06, 0.22);
    opacity *= program_emissionEnvelope(program_shooter_time, program_shooter_b.w, program_shooter_c.x, program_shooter_c.y, program_shooter_c.z, program_shooter_c.w);
  `,
)
