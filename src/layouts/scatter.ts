import type { Layout, Transform } from '../core/types.js'

export interface ScatterOptions {
  direction?: 'random' | 'radial' | 'left' | 'right'
  distance?: number
  depth?: number
  spin?: number
  scale?: number
  opacity?: number
  seed?: number
}

export function scatter(options: ScatterOptions = {}): Layout {
  const direction = options.direction ?? 'random'
  const distance = positive(options.distance, 10)
  const depth = Math.max(0, options.depth ?? distance * 0.6)
  const spin = Math.max(0, options.spin ?? Math.PI * 2)
  const scale = Math.max(0, options.scale ?? 0.25)
  const opacity = Math.min(1, Math.max(0, options.opacity ?? 0))
  const seed = Number.isFinite(options.seed) ? options.seed as number : 2030

  return {
    name: `scatter-${direction}`,
    orientation: 'camera',
    calculate(count): Transform[] {
      return Array.from({ length: Math.max(0, count) }, (_, index) => {
        const position = scatterPosition(index, direction, distance, depth, seed)
        return {
          ...position,
          scale,
          rotationX: centeredRandom(index * 7 + 4, seed) * spin,
          rotationY: centeredRandom(index * 7 + 5, seed) * spin,
          rotationZ: centeredRandom(index * 7 + 6, seed) * spin,
          opacity,
        }
      })
    },
  }
}

function scatterPosition(
  index: number,
  direction: NonNullable<ScatterOptions['direction']>,
  distance: number,
  depth: number,
  seed: number,
): Pick<Transform, 'x' | 'y' | 'z'> {
  const distanceFactor = 0.7 + random(index * 7 + 1, seed) * 0.3
  if (direction === 'left' || direction === 'right') {
    return {
      x: (direction === 'left' ? -1 : 1) * distance * distanceFactor,
      y: centeredRandom(index * 7 + 2, seed) * distance,
      z: centeredRandom(index * 7 + 3, seed) * depth,
    }
  }

  if (direction === 'radial') {
    const azimuth = random(index * 7 + 2, seed) * Math.PI * 2
    const elevation = Math.asin(random(index * 7 + 3, seed) * 2 - 1)
    const radius = distance * distanceFactor
    const horizontal = Math.cos(elevation) * radius
    return {
      x: Math.cos(azimuth) * horizontal,
      y: Math.sin(elevation) * radius,
      z: Math.sin(azimuth) * horizontal * Math.min(1, depth / distance),
    }
  }

  return {
    x: centeredRandom(index * 7 + 1, seed) * distance * 2,
    y: centeredRandom(index * 7 + 2, seed) * distance * 2,
    z: centeredRandom(index * 7 + 3, seed) * depth * 2,
  }
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
