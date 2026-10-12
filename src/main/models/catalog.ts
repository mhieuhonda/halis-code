/**
 * Model catalog registry: bundled snapshot + live refresh from models.dev
 * (the public catalog opencode maintains) + local Ollama auto-detection.
 */
import type { CatalogSnapshot, ModelInfo, ProviderInfo } from '@shared/types'
import { BUNDLED_MODELS, BUNDLED_PROVIDERS } from './catalog-data'

const MODELS_DEV_URL = 'https://models.dev/api.json'
const OLLAMA_URL = 'http://127.0.0.1:11434'
const REFRESH_INTERVAL_MS = 10 * 60 * 1000

interface ModelsDevProvider {
  id: string
  name?: string
  env?: string[]
  npm?: string
  api?: string
  doc?: string
  models?: Record<string, ModelsDevModel>
}

interface ModelsDevModel {
  id?: string
  name?: string
  description?: string
  tool_call?: boolean
  reasoning?: boolean
  release_date?: string
  status?: string
  limit?: { context?: number; output?: number }
  cost?: { input?: number; output?: number }
  modalities?: { output?: string[] }
}

/** Strip stray double quotes from generated/merged model ids. */
function cleanModelToken(token: string): string {
  return token.replace(/"/g, '').trim()
}

export class ModelCatalog {
  private snapshot: CatalogSnapshot
  private timer: NodeJS.Timeout | null = null
  private refreshing = false
  private onUpdated: ((snap: CatalogSnapshot) => void) | null = null

  constructor() {
    this.snapshot = {
      providers: BUNDLED_PROVIDERS,
      // Guard against the generator double-quoting ids again: a quoted id
      // would flow into API requests verbatim and every provider would
      // reject it as an unknown model.
      models: BUNDLED_MODELS.map((m) => ({ ...m, id: cleanModelToken(m.id), apiId: cleanModelToken(m.apiId) })),
      updatedAt: Date.now(),
      source: 'bundled',
    }
  }

  get(): CatalogSnapshot {
    return this.snapshot
  }

  /** Lookup tolerates quoted or whitespace-polluted ids from older saved configs. */
  getModel(id: string): ModelInfo | undefined {
    const wanted = cleanModelToken(id)
    return this.snapshot.models.find((m) => m.id === wanted)
  }

  getProvider(id: string): ProviderInfo | undefined {
    return this.snapshot.providers.find((p) => p.id === id)
  }

  listModels(filter?: { providerId?: string; free?: boolean; keyless?: boolean; toolCall?: boolean }): ModelInfo[] {
    let models = this.snapshot.models
    if (filter?.providerId) models = models.filter((m) => m.providerId === filter.providerId)
    if (filter?.free !== undefined) models = models.filter((m) => m.free === filter.free)
    if (filter?.keyless !== undefined) {
      const keylessProviders = new Set(this.snapshot.providers.filter((p) => p.keyless).map((p) => p.id))
      models = models.filter((m) => keylessProviders.has(m.providerId) === filter.keyless)
    }
    if (filter?.toolCall) models = models.filter((m) => m.toolCall)
    return models
  }

  /** Groups for the model picker. */
  groups(): Array<{ id: string; label: string; models: ModelInfo[] }> {
    const models = this.snapshot.models
    const byName = (a: ModelInfo, b: ModelInfo) => a.name.localeCompare(b.name)
    return [
      { id: 'free-no-key', label: 'Free · no key needed', models: models.filter((m) => m.free && this.getProvider(m.providerId)?.keyless).sort(byName) },
      { id: 'free-key', label: 'Free tier · free API key', models: models.filter((m) => m.free && !this.getProvider(m.providerId)?.keyless).sort(byName) },
      { id: 'local', label: 'Local · on your machine', models: models.filter((m) => m.providerId === 'ollama').sort(byName) },
      { id: 'all', label: 'All models', models: [...models].sort(byName) },
    ]
  }

  setUpdatedListener(cb: (snap: CatalogSnapshot) => void): void {
    this.onUpdated = cb
  }

  startBackgroundRefresh(): void {
    if (this.timer) return
    void this.refresh()
    this.timer = setInterval(() => void this.refresh(), REFRESH_INTERVAL_MS)
  }

  stopBackgroundRefresh(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async refresh(): Promise<CatalogSnapshot> {
    if (this.refreshing) return this.snapshot
    this.refreshing = true
    try {
      const [devResult, ollamaModels] = await Promise.all([this.fetchModelsDev(), this.fetchOllama()])
      let models = [...BUNDLED_MODELS]
      let providers = [...BUNDLED_PROVIDERS]
      let source: CatalogSnapshot['source'] = 'bundled'

      if (devResult) {
        // Keep only providers we bundle (curated, known API shapes) but take
        // their freshest model lists.
        const fresh = this.mergeModelsDev(devResult)
        models = fresh.models
        providers = fresh.providers
        source = 'models.dev'
      }
      if (ollamaModels.length) {
        models = [...models.filter((m) => m.providerId !== 'ollama' || !m.tags?.includes('suggested')), ...ollamaModels]
        if (source === 'models.dev') source = 'merged'
      }

      this.snapshot = { providers, models, updatedAt: Date.now(), source }
      this.onUpdated?.(this.snapshot)
      return this.snapshot
    } finally {
      // A throw anywhere above (bad payload shape from models.dev, …) must
      // not wedge this flag — refresh would silently die until restart.
      this.refreshing = false
    }
  }

  private async fetchModelsDev(): Promise<Record<string, ModelsDevProvider> | null> {
    try {
      const res = await fetch(MODELS_DEV_URL, { signal: AbortSignal.timeout(15_000) })
      if (!res.ok) return null
      return (await res.json()) as Record<string, ModelsDevProvider>
    } catch {
      return null
    }
  }

  private mergeModelsDev(dev: Record<string, ModelsDevProvider>): { providers: ProviderInfo[]; models: ModelInfo[] } {
    const providers: ProviderInfo[] = []
    const models: ModelInfo[] = []
    for (const bundled of BUNDLED_PROVIDERS) {
      const fresh = dev[bundled.id]
      if (!fresh) {
        providers.push(bundled)
        models.push(...BUNDLED_MODELS.filter((m) => m.providerId === bundled.id))
        continue
      }
      providers.push(bundled)
      const seen = new Set<string>()
      for (const [modelKey, m] of Object.entries(fresh.models ?? {})) {
        if (m.status === 'deprecated') continue
        if (m.modalities?.output && !m.modalities.output.includes('text')) continue
        const apiId = cleanModelToken(m.id ?? modelKey)
        const id = `${bundled.id}/${apiId}`
        if (seen.has(id)) continue
        seen.add(id)
        const cost = m.cost
        const isFree = cost?.input === 0 && cost?.output === 0
        models.push({
          id,
          apiId,
          name: m.name ?? apiId,
          providerId: bundled.id,
          description: m.description?.slice(0, 200),
          free: isFree,
          toolCall: m.tool_call !== false,
          contextWindow: m.limit?.context,
          maxOutput: m.limit?.output,
          reasoning: !!m.reasoning,
          costPerMTok: cost && (cost.input !== undefined || cost.output !== undefined) ? { input: cost.input ?? 0, output: cost.output ?? 0 } : undefined,
        })
      }
    }
    return { providers, models }
  }

  private async fetchOllama(): Promise<ModelInfo[]> {
    try {
      const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000) })
      if (!res.ok) return []
      const json = (await res.json()) as { models?: Array<{ name?: string; details?: { parameter_size?: string; family?: string } }> }
      return (json.models ?? [])
        .filter((m): m is { name: string } => !!m.name)
        .map((m) => ({
          id: `ollama/${m.name}`,
          apiId: m.name,
          name: `Ollama · ${m.name}`,
          providerId: 'ollama',
          free: true,
          toolCall: true,
          contextWindow: 131072,
          tags: ['detected'],
        }))
    } catch {
      return []
    }
  }
}

export const modelCatalog = new ModelCatalog()
