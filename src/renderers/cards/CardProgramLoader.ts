import type {
  CardEffectProgram,
  CardEffectProgramLoader,
} from './programs.js'

export class CardProgramLoader {
  private readonly loading = new Map<string, Promise<CardEffectProgram | null>>()
  private loadCount = 0
  private loadMs = 0

  constructor(
    private readonly configured: Readonly<Record<string, CardEffectProgramLoader>> | undefined,
  ) {}

  load(kind: string): Promise<CardEffectProgram | null> {
    const cached = this.loading.get(kind)
    if (cached) return cached
    const configured = this.configured?.[kind]
    if (!configured && !isBuiltinEffect(kind)) return Promise.resolve(null)
    this.loadCount += 1
    const startedAt = performance.now()
    let loading!: Promise<CardEffectProgram | null>
    loading = Promise.resolve().then(async () => {
      const program = configured
        ? typeof configured === 'function' ? await configured() : configured
        : await loadBuiltinEffectProgram(kind)
      if (!program) return null
      if (program.kind !== kind) {
        throw new TypeError(`Cards effect program "${kind}" loaded mismatched kind "${program.kind}"`)
      }
      return program
    }).catch((error) => {
      if (this.loading.get(kind) === loading) this.loading.delete(kind)
      throw error
    }).finally(() => {
      this.loadMs += performance.now() - startedAt
    })
    this.loading.set(kind, loading)
    return loading
  }

  getLoadCount(): number {
    return this.loadCount
  }

  getLoadMs(): number {
    return this.loadMs
  }

  clear(): void {
    this.loading.clear()
  }
}

function isBuiltinEffect(kind: string): boolean {
  return kind === 'tunnel'
    || kind === 'linear-shooter'
    || kind === 'vortex'
    || kind === 'radial-burst'
}

async function loadBuiltinEffectProgram(kind: string): Promise<CardEffectProgram | null> {
  switch (kind) {
    case 'tunnel':
      return (await import('./tunnelProgram.js')).tunnelProgram
    case 'linear-shooter':
      return (await import('./linearShooterProgram.js')).linearShooterProgram
    case 'vortex':
      return (await import('./vortexProgram.js')).vortexProgram
    case 'radial-burst':
      return (await import('./radialBurstProgram.js')).radialBurstProgram
    default:
      return null
  }
}
