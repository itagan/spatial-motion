import { GLSL3, type ShaderMaterial } from 'three'

export function configureArrayCardMaterial(material: ShaderMaterial): void {
  material.glslVersion = GLSL3
  material.vertexShader = `#define attribute in
#define varying out
${material.vertexShader}`
    .replace(
      'uniform float hoverIndex;',
      'uniform float hoverIndex;\nuniform float uLayers;',
    )
    .replace(
      'varying vec2 vAtlasUv;',
      'varying vec2 vAtlasUv;\nvarying float vLayer;',
    )
    .replace(
      'vAtlasUv = atlasRect.xy + uv * atlasRect.zw;',
      `vAtlasUv = vec2(fract(atlasRect.x), atlasRect.y) + uv * atlasRect.zw;
      vLayer = floor(atlasRect.x);
      if (vLayer >= uLayers) {
        vOpacity = 0.0;
        vInstanceVisible = 0.0;
        vHighlight = 0.0;
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        return;
      }`,
    )
  material.fragmentShader = `#define varying in
#define texture2D texture
out vec4 arrayColor;
#define gl_FragColor arrayColor
${material.fragmentShader}`
    .replace('uniform sampler2D atlas;', 'uniform highp sampler2DArray atlas;')
    .replace(
      'varying vec2 vAtlasUv;',
      'varying vec2 vAtlasUv;\nvarying float vLayer;',
    )
    .replace(
      'texture2D(atlas, vAtlasUv)',
      'texture(atlas, vec3(vAtlasUv, vLayer))',
    )
}
