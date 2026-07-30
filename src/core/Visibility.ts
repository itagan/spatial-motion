export function visibilityRank(index: number): number {
  return (index * 0.618033988749895) % 1
}
