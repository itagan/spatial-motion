import type { Layout } from '../core/types.js'
import type { TransformBuffer } from '../core/TransformBuffer.js'
import { defineLayout } from './defineLayout.js'

export interface ScatterOptions {
  direction?: 'random' | 'radial' | 'left' | 'right'
  distance?: number
  depth?: number
  spin?: number
  spinMode?: 'random' | 'directional'
  layers?: number
  scale?: number
  opacity?: number
  seed?: number
}

export function scatter(options: ScatterOptions = {}): Layout {
  const direction = options.direction ?? 'random'
  const distance = positive(options.distance, 10)
  const depth = Math.max(0, options.depth ?? distance * 0.6)
  const spin = Math.max(0, options.spin ?? Math.PI * 2)
  const spinMode = options.spinMode ?? 'random'
  const layers = Math.max(1, Math.floor(options.layers ?? 4))
  const scale = Math.max(0, options.scale ?? 0.25)
  const opacity = Math.min(1, Math.max(0, options.opacity ?? 0))
  const seed = Number.isFinite(options.seed) ? options.seed as number : 2030

  return defineLayout({
    name: `scatter-${direction}`,
    // Surface orientation lets the transition interpolate the configured spin.
    // The cards are normally transparent at rest, so random final tilt is not exposed.
    orientation: 'surface',
    calculateInto(count, _context, target): void {
      for (let index = 0; index < count; index += 1) {
        writeScatterTransform(
          target,
          index,
          direction,
          distance,
          depth,
          spin,
          spinMode,
          layers,
          scale,
          opacity,
          seed,
        )
      }
    },
  })
}

function writeScatterTransform(
  target: TransformBuffer,
  index: number,
  direction: NonNullable<ScatterOptions['direction']>,
  distance: number,
  depth: number,
  spin: number,
  spinMode: NonNullable<ScatterOptions['spinMode']>,
  layers: number,
  scale: number,
  opacity: number,
  seed: number,
): void {
  const layer = index % layers
  const layerJitter = random(index * 7 + 1, seed) * 0.45 + 0.275
  const distanceFactor = 0.68 + ((layer + layerJitter) / layers) * 0.32
  let x: number
  let y: number
  let z: number
  if (direction === 'left' || direction === 'right') {
    x = (direction === 'left' ? -1 : 1) * distance * distanceFactor
    y = centeredRandom(index * 7 + 2, seed) * distance
    z = centeredRandom(index * 7 + 3, seed) * depth
  } else if (direction === 'radial') {
    const azimuth = random(index * 7 + 2, seed) * Math.PI * 2
    const elevation = Math.asin(random(index * 7 + 3, seed) * 2 - 1)
    const radius = distance * distanceFactor
    const horizontal = Math.cos(elevation) * radius
    x = Math.cos(azimuth) * horizontal
    y = Math.sin(elevation) * radius
    z = Math.sin(azimuth) * horizontal * Math.min(1, depth / distance)
  } else {
    x = centeredRandom(index * 7 + 1, seed) * distance * 2
    y = centeredRandom(index * 7 + 2, seed) * distance * 2
    z = centeredRandom(index * 7 + 3, seed) * depth * 2
  }

  let rotationX: number
  let rotationY: number
  let rotationZ: number
  if (spinMode === 'random') {
    rotationX = centeredRandom(index * 7 + 4, seed) * spin
    rotationY = centeredRandom(index * 7 + 5, seed) * spin
    rotationZ = centeredRandom(index * 7 + 6, seed) * spin
  } else {
    const directionSign = direction === 'left' ? -1 : 1
    const magnitude = spin * (0.55 + random(index * 7 + 6, seed) * 0.45)
    rotationX = centeredRandom(index * 7 + 4, seed) * spin * 0.25
    rotationY = centeredRandom(index * 7 + 5, seed) * spin * 0.25
    rotationZ = directionSign * magnitude
  }
  target.setValues(
    index,
    x,
    y,
    z,
    scale,
    rotationX,
    rotationY,
    rotationZ,
    opacity,
  )
}

function centeredRandom(index: number, seed: number): number {
  return random(index, seed) - 0.5
}

function random(index: number, seed: number): number {
  const value = Math.sin(index * 12.9898 + seed * 78.233) * 43758.5453
  return value - Math.floor(value)
}

function positive(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && (value ?? 0) > 0 ? value as number : fallback
}
