import {
  FrontSide,
  ShaderMaterial,
  Vector2,
  Vector3,
  Vector4,
  type Texture,
} from 'three'
import type {
  CardEffectProgram,
  CardMotionProgram,
  CardProgramUniform,
} from './cards/programs.js'

export type CardShaderProgram = CardMotionProgram | CardEffectProgram

export function createCardProgramMaterial(
  texture: Texture,
  layers: number,
  program?: CardShaderProgram,
): ShaderMaterial {
  const uniforms: ShaderMaterial['uniforms'] = {
    atlas: { value: texture },
    progress: { value: 1 },
    fromBillboard: { value: 0 },
    toBillboard: { value: 0 },
    fromHideBackHemisphere: { value: 0 },
    toHideBackHemisphere: { value: 0 },
    fromHemisphereEdgeFade: { value: 0 },
    toHemisphereEdgeFade: { value: 0 },
    visibleRatio: { value: 1 },
    hoverIndex: { value: -1 },
    uLayers: { value: layers },
  }
  for (const uniform of program?.uniforms ?? []) {
    uniforms[uniform.name] = { value: initialUniformValue(uniform) }
  }
  return new ShaderMaterial({
    uniforms,
    vertexShader: cardVertexShader(program),
    fragmentShader: `
      uniform sampler2D atlas;
      varying vec2 vAtlasUv;
      varying float vOpacity;
      varying float vInstanceVisible;
      varying float vHighlight;
      void main() {
        if (vInstanceVisible < 0.5) discard;
        vec4 color = texture2D(atlas, vAtlasUv);
        vec3 highlighted = mix(color.rgb, min(vec3(1.0), color.rgb * 1.16 + 0.06), vHighlight);
        gl_FragColor = vec4(highlighted, color.a * vOpacity);
      }
    `,
    transparent: true,
    side: FrontSide,
    glslVersion: null,
  })
}

function cardVertexShader(program?: CardShaderProgram): string {
  const attributes = (program?.attributes ?? [])
    .map(({ name, itemSize }) => `attribute ${glslType(itemSize)} ${name};`)
    .join('\n')
  const uniforms = (program?.uniforms ?? [])
    .map(({ name, type }) => `uniform ${type} ${name};`)
    .join('\n')
  const programBody = program?.vertexBody ?? ''
  const isEffect = program?.type === 'effect'
  return `
    attribute vec4 atlasRect;
    attribute vec3 fromPosition;
    attribute vec3 toPosition;
    attribute vec4 fromQuaternion;
    attribute vec4 toQuaternion;
    attribute float fromScale;
    attribute float toScale;
    attribute float fromOpacity;
    attribute float toOpacity;
    attribute float visibilityRank;
    attribute float itemIndex;
    ${attributes}
    uniform float progress;
    uniform float fromBillboard;
    uniform float toBillboard;
    uniform float fromHideBackHemisphere;
    uniform float toHideBackHemisphere;
    uniform float fromHemisphereEdgeFade;
    uniform float toHemisphereEdgeFade;
    uniform float visibleRatio;
    uniform float hoverIndex;
    ${uniforms}
    varying vec2 vAtlasUv;
    varying float vOpacity;
    varying float vInstanceVisible;
    varying float vHighlight;

    vec3 rotateByQuaternion(vec3 value, vec4 quaternion) {
      return value + 2.0 * cross(quaternion.xyz, cross(quaternion.xyz, value) + quaternion.w * value);
    }
    vec4 interpolateQuaternion(vec4 fromValue, vec4 toValue, float amount) {
      vec4 target = dot(fromValue, toValue) < 0.0 ? -toValue : toValue;
      return normalize(mix(fromValue, target, amount));
    }
    ${program?.vertexDeclarations ?? ''}

    void main() {
      vAtlasUv = atlasRect.xy + uv * atlasRect.zw;
      if (visibilityRank > visibleRatio) {
        vOpacity = 0.0;
        vInstanceVisible = 0.0;
        vHighlight = 0.0;
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        return;
      }
      float opacity = mix(fromOpacity, toOpacity, progress);
      vec3 center = mix(fromPosition, toPosition, progress);
      float itemScale = mix(fromScale, toScale, progress);
      vHighlight = 1.0 - step(0.5, abs(itemIndex - hoverIndex));
      itemScale *= mix(1.0, 1.08, vHighlight);
      vec4 itemQuaternion = interpolateQuaternion(fromQuaternion, toQuaternion, progress);
      float programVisible = 1.0;
      ${programBody}
      vOpacity = opacity;
      vec4 centerView = modelViewMatrix * vec4(center, 1.0);
      ${isEffect ? effectProjection() : layoutProjection()}
    }
  `
}

function layoutProjection(): string {
  return `
    vec3 localPosition = rotateByQuaternion(position * itemScale, itemQuaternion);
    vec4 surfaceView = modelViewMatrix * vec4(center + localPosition, 1.0);
    vec4 billboardView = centerView;
    billboardView.xy += position.xy * itemScale;
    float billboardAmount = mix(fromBillboard, toBillboard, progress);
    gl_Position = projectionMatrix * mix(surfaceView, billboardView, billboardAmount);
    vec4 sphereCenterView = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    float hemisphereVisible = step(sphereCenterView.z, centerView.z);
    float hideBackAmount = mix(fromHideBackHemisphere, toHideBackHemisphere, progress);
    vOpacity *= mix(1.0, hemisphereVisible, hideBackAmount);
    float edgeFade = mix(fromHemisphereEdgeFade, toHemisphereEdgeFade, progress);
    if (edgeFade > 0.0) {
      vec3 radialView = normalize(centerView.xyz - sphereCenterView.xyz);
      float facing = dot(radialView, normalize(-centerView.xyz));
      vOpacity *= smoothstep(0.0, edgeFade, facing);
    }
    vInstanceVisible = programVisible;
  `
}

function effectProjection(): string {
  return `
    vInstanceVisible = programVisible;
    centerView.xy += position.xy * itemScale;
    gl_Position = projectionMatrix * centerView;
  `
}

function glslType(itemSize: number): string {
  return itemSize === 1 ? 'float' : `vec${itemSize}`
}

function initialUniformValue(uniform: CardProgramUniform): number | Vector2 | Vector3 | Vector4 {
  const values = typeof uniform.initialValue === 'number'
    ? [uniform.initialValue]
    : [...(uniform.initialValue ?? [])]
  if (uniform.type === 'float') return values[0] ?? 0
  if (uniform.type === 'vec2') return new Vector2(values[0] ?? 0, values[1] ?? 0)
  if (uniform.type === 'vec3') return new Vector3(values[0] ?? 0, values[1] ?? 0, values[2] ?? 0)
  return new Vector4(values[0] ?? 0, values[1] ?? 0, values[2] ?? 0, values[3] ?? 0)
}
