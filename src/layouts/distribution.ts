export function distributeWeighted(count: number, weights: number[]): number[] {
  if (weights.length === 0) return []
  if (count <= 0) return new Array<number>(weights.length).fill(0)

  const distribution = new Array<number>(weights.length).fill(0)
  const occupied = Math.min(count, weights.length)
  for (let index = 0; index < occupied; index += 1) distribution[index] = 1

  let remaining = count - occupied
  if (remaining === 0) return distribution

  const normalized = weights.map((weight) => Math.max(0, weight))
  const totalWeight = normalized.reduce((sum, weight) => sum + weight, 0)
  const effectiveWeights = totalWeight > 0 ? normalized : normalized.map(() => 1)
  const effectiveTotal = effectiveWeights.reduce((sum, weight) => sum + weight, 0)
  let allocated = 0
  const allocations = effectiveWeights.map((weight, index) => {
    const exact = (remaining * weight) / effectiveTotal
    const amount = Math.floor(exact)
    distribution[index] += amount
    allocated += amount
    return { index, fraction: exact - amount }
  })

  remaining -= allocated
  allocations
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index)
    .forEach(({ index }) => {
      if (remaining > 0) {
        distribution[index] += 1
        remaining -= 1
      }
    })

  return distribution
}
