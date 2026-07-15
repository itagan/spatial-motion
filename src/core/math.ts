import type { EasingFunction, Transform } from './types.js'

export const identityTransform = (): Transform => ({
  x: 0,
  y: 0,
  z: 0,
  scale: 0.01,
  rotationX: 0,
  rotationY: 0,
  rotationZ: 0,
  opacity: 1,
})

export const easing = {
  linear: (t: number) => t,
  sineInOut: ((t: number) => -(Math.cos(Math.PI * t) - 1) / 2) satisfies EasingFunction,
  cubicInOut: ((t: number) =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2) satisfies EasingFunction,
}

export function interpolateTransform(from: Transform, to: Transform, t: number): Transform {
  const lerp = (a: number, b: number) => a + (b - a) * t
  return {
    x: lerp(from.x, to.x),
    y: lerp(from.y, to.y),
    z: lerp(from.z, to.z),
    scale: lerp(from.scale, to.scale),
    rotationX: lerp(from.rotationX, to.rotationX),
    rotationY: lerp(from.rotationY, to.rotationY),
    rotationZ: lerp(from.rotationZ, to.rotationZ),
    opacity: lerp(from.opacity, to.opacity),
  }
}
