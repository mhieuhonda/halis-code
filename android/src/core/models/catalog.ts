/**
 * Model catalog registry — mobile edition: bundled snapshot + live refresh
 * from the upstream catalog source. No local Ollama detection (there is no
 * local daemon on a phone).
 */
import type { CatalogSnapshot, ModelInfo, ProviderInfo } from '@shared/types'
import { BUNDLED_MODELS, BUNDLED_PROVIDERS } from './catalog-data'

const MODELS_DEV_URL = 'https://models.opencode.ai/api.json'
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
  private timer: ReturnType<typeof setInterval> | null = null
  private refreshing = false
  private onUpdated: ((snap: CatalogSnapshot) => void) | null = null

  constructor() {
    this.snapshot = {
      providers: BUNDLED_PROVIDERS,
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

  /** Models grouped by provider: sections in bundled order, free models first. */
  byProvider(): Array<{ provider: ProviderInfo; models: ModelInfo[] }> {
    return this.snapshot.providers
      .map((provider) => ({
        provider,
        models: this.snapshot.models
          .filter((m) => m.providerId === provider.id)
          .sort((a, b) => Number(b.free) - Number(a.free) || a.name.localeCompare(b.name)),
      }))
      .filter((g) => g.models.length > 0)
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
      const devResult = await this.fetchModelsDev()
      let models = [...BUNDLED_MODELS]
      let providers = [...BUNDLED_PROVIDERS]
      let source: CatalogSnapshot['source'] = 'bundled'

      if (devResult) {
        const fresh = this.mergeModelsDev(devResult)
        models = fresh.models
        providers = fresh.providers
        source = 'models.dev'
      }

      this.snapshot = { providers, models, updatedAt: Date.now(), source }
      this.onUpdated?.(this.snapshot)
      return this.snapshot
    } catch (err) {
      console.warn('[halis] catalog refresh failed, keeping current snapshot:', err)
      return this.snapshot
    } finally {
      this.refreshing = false
    }
  }

  private async fetchModelsDev(): Promise<Record<string, ModelsDevProvider> | null> {
    try {
      const res = await fetch(MODELS_DEV_URL, { signal: AbortSignal.timeout(15_000) })
      if (!res.ok) return null
      const data: unknown = await res.json()
      if (!data || typeof data !== 'object' || Array.isArray(data)) return null
      return data as Record<string, ModelsDevProvider>
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
        models.push(...BUNDLED_MODELS.filter((m) => m.providerId === bundled.id).map((m) => ({ ...m, id: cleanModelToken(m.id), apiId: cleanModelToken(m.apiId) })))
        continue
      }
      providers.push(bundled)
      const seen = new Set<string>()
      // Keep the bundled models as the BASE: the remote catalog renames/
      // retires entries, and the user's selected model must not vanish on a
      // background refresh.
      for (const model of BUNDLED_MODELS.filter((m) => m.providerId === bundled.id)) {
        const id = cleanModelToken(model.id)
        if (seen.has(id)) continue
        seen.add(id)
        models.push({ ...model, id, apiId: cleanModelToken(model.apiId) })
      }
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
}

export const modelCatalog = new ModelCatalog()
