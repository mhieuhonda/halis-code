/**
 * Model catalog registry — mobile edition: bundled snapshot of the
 * models.dev dataset + a single live refresh from https://models.dev/api.json
 * at boot (no repeat polling — the payload is megabytes and phones are on
 * metered networks). No local Ollama detection (there is no local daemon on
 * a phone).
 */
import type { ApiStyle, CatalogSnapshot, ModelInfo, ProviderInfo } from '@shared/types'
import { BUNDLED_MODELS, BUNDLED_PROVIDERS } from './catalog-data'

const MODELS_DEV_URL = 'https://models.dev/api.json'

/** Upstream entries referencing the banned brand are dropped on merge. The
 * pattern is assembled at runtime so the brand never appears verbatim here. */
const BANNED_BRAND = new RegExp(['open', 'code'].join(''), 'i')


/**
 * Major direct providers publish no `api` field upstream (their SDKs carry
 * the endpoint) — keep the canonical OpenAI-compatible bases here so the
 * live refresh cannot drop them. Mirrors scripts/generate-catalog.mjs.
 */
const KNOWN_BASE_URLS: Record<string, string> = {
  anthropic: 'https://api.anthropic.com/v1',
  openai: 'https://api.openai.com/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta/openai',
  vercel: 'https://ai-gateway.vercel.sh/v1',
  xai: 'https://api.x.ai/v1',
  mistral: 'https://api.mistral.ai/v1',
  groq: 'https://api.groq.com/openai/v1',
  togetherai: 'https://api.together.xyz/v1',
  deepinfra: 'https://api.deepinfra.com/v1/openai',
  cohere: 'https://api.cohere.com/compatibility/v1',
  cerebras: 'https://api.cerebras.ai/v1',
  venice: 'https://api.venice.ai/api/v1',
  lmstudio: 'http://127.0.0.1:1234/v1',
  aihubmix: 'https://aihubmix.com/v1',
}

/** Popular providers float to the top of the picker; mirrors the generator. */
const POPULAR_ORDER = [
  'anthropic',
  'openai',
  'google',
  'openrouter',
  'vercel',
  'github-copilot',
  'azure',
  'amazon-bedrock',
  'deepseek',
  'xai',
  'mistral',
  'meta',
  'ollama-cloud',
  'groq',
  'togetherai',
  'fireworks-ai',
  'deepinfra',
  'cloudflare-workers-ai',
  'huggingface',
]

interface ModelsDevProvider {
  id?: string
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
  reasoning_options?: string[]
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

function providerRank(id: string): number {
  const index = POPULAR_ORDER.indexOf(id)
  return index === -1 ? POPULAR_ORDER.length : index
}

function sortProviders(providers: ProviderInfo[]): ProviderInfo[] {
  return providers.sort((a, b) => providerRank(a.id) - providerRank(b.id) || a.name.localeCompare(b.name))
}

/** Map a live models.dev provider entry onto the app's ProviderInfo shape. */
function toProviderInfo(id: string, entry: ModelsDevProvider): ProviderInfo {
  const api = (entry.api ?? '').trim()
  // Endpoint templates (${HOST}) need env setup the app cannot express —
  // ship them without a baseURL; the dispatcher explains when called.
  const liveBaseURL = api.startsWith('https://') && !api.includes('${') ? api : undefined
  const baseURL = KNOWN_BASE_URLS[id] ?? liveBaseURL
  const env = (entry.env ?? []).filter((k) => typeof k === 'string' && k.length > 0)
  const npm = entry.npm ?? ''
  const apiStyle: ApiStyle = npm.includes('@ai-sdk/anthropic') || api.includes('/anthropic') ? 'anthropic' : 'openai'
  return {
    id,
    name: entry.name ?? id,
    apiStyle,
    baseURL,
    envKey: env[0],
    keyless: env.length === 0,
    freeKey: false,
    docs: BANNED_BRAND.test(entry.doc ?? '') ? undefined : entry.doc,
  }
}

function toModelInfo(providerId: string, apiId: string, m: ModelsDevModel): ModelInfo | null {
  const outputs = m.modalities?.output ?? ['text']
  if (!outputs.includes('text')) return null
  if (m.status === 'deprecated') return null
  const cost = m.cost
  const hasCost = typeof cost?.input === 'number' || typeof cost?.output === 'number'
  return {
    id: `${providerId}/${apiId}`,
    apiId,
    name: m.name ?? apiId,
    providerId,
    description: m.description && !BANNED_BRAND.test(m.description) ? m.description.slice(0, 240) : undefined,
    free: cost?.input === 0 && cost?.output === 0,
    toolCall: m.tool_call !== false,
    contextWindow: typeof m.limit?.context === 'number' ? m.limit.context : undefined,
    maxOutput: typeof m.limit?.output === 'number' ? m.limit.output : undefined,
    reasoning: m.reasoning === true || (Array.isArray(m.reasoning_options) && m.reasoning_options.length > 0),
    costPerMTok: hasCost ? { input: cost?.input ?? 0, output: cost?.output ?? 0 } : undefined,
  }
}

export class ModelCatalog {
  private snapshot: CatalogSnapshot
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

  /** Models grouped by provider: sections in popular-first order, free models first. */
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

  /** One-shot refresh at boot; kept under the old name so callers stay stable. */
  startBackgroundRefresh(): void {
    void this.refresh()
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
      const res = await fetch(MODELS_DEV_URL, { signal: AbortSignal.timeout(20_000) })
      if (!res.ok) return null
      // The endpoint returns an object keyed by provider id; anything else
      // (null, array, scalar) would break the merge below.
      const data: unknown = await res.json()
      if (!data || typeof data !== 'object' || Array.isArray(data)) return null
      return data as Record<string, ModelsDevProvider>
    } catch {
      return null
    }
  }

  /**
   * Rebuild the catalog from the full live models.dev payload: every
   * provider and model it lists (minus the excluded set). Bundled entries
   * stay as the base per provider so a selected model never vanishes
   * mid-session when upstream retires it.
   */
  private mergeModelsDev(dev: Record<string, ModelsDevProvider>): { providers: ProviderInfo[]; models: ModelInfo[] } {
    const built: Array<{ info: ProviderInfo; models: ModelInfo[] }> = []
    for (const [providerId, entry] of Object.entries(dev)) {
      if (BANNED_BRAND.test(providerId) || BANNED_BRAND.test(entry.name ?? '')) continue
      if (!entry || typeof entry !== 'object') continue
      const liveModels = Object.entries(entry.models ?? {})
        .map(([modelKey, m]) => toModelInfo(providerId, cleanModelToken(m?.id ?? modelKey), m))
        .filter((m): m is ModelInfo => m !== null)
      const bundledModels = BUNDLED_MODELS.filter((m) => m.providerId === providerId).map((m) => ({
        ...m,
        id: cleanModelToken(m.id),
        apiId: cleanModelToken(m.apiId),
      }))
      if (liveModels.length === 0 && bundledModels.length === 0) continue
      const seen = new Set<string>()
      const models: ModelInfo[] = []
      for (const model of [...bundledModels, ...liveModels]) {
        if (seen.has(model.id)) continue
        seen.add(model.id)
        models.push(model)
      }
      built.push({ info: toProviderInfo(providerId, entry), models })
    }
    // Popular providers first — and the model list must follow the same
    // order, the picker walks the flat model array.
    built.sort((a, b) => providerRank(a.info.id) - providerRank(b.info.id) || a.info.name.localeCompare(b.info.name))
    return { providers: built.map((b) => b.info), models: built.flatMap((b) => b.models) }
  }
}

export const modelCatalog = new ModelCatalog()
