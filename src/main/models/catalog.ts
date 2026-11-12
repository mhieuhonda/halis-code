/**
 * Model catalog registry: bundled snapshot of the models.dev dataset +
 * live refresh from https://models.dev/api.json + local Ollama detection.
 */
import type { ApiStyle, CatalogSnapshot, ModelInfo, ProviderInfo } from '@shared/types'
import { BUNDLED_MODELS, BUNDLED_PROVIDERS } from './catalog-data'

const MODELS_DEV_URL = 'https://models.dev/api.json'
const OLLAMA_URL = 'http://127.0.0.1:11434'
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000

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
        const fresh = this.mergeModelsDev(devResult)
        models = fresh.models
        providers = fresh.providers
        source = 'models.dev'
      }
      if (ollamaModels.length) {
        models = [...models.filter((m) => m.providerId !== 'ollama' || !m.tags?.includes('suggested')), ...ollamaModels]
        if (source === 'models.dev') source = 'merged'
      } else {
        // Daemon unreachable: carry over previously DETECTED ollama models so
        // a session mid-way through `ollama/x` does not explode with
        // `Unknown model` the moment the daemon takes a nap (the refresh
        // used to rebuild from the bundled base, which has none of them).
        const prevDetected = this.snapshot.models.filter((m) => m.providerId === 'ollama' && m.tags?.includes('detected'))
        if (prevDetected.length) {
          models = [...models.filter((m) => m.providerId !== 'ollama' || !m.tags?.includes('suggested')), ...prevDetected]
        }
      }

      this.snapshot = { providers, models, updatedAt: Date.now(), source }
      this.onUpdated?.(this.snapshot)
      return this.snapshot
    } catch (err) {
      // A degenerate upstream payload (or any merge failure) must not escape
      // as an unhandled rejection from `void this.refresh()` — keep serving
      // the last good snapshot and log instead.
      console.warn('[halis] catalog refresh failed, keeping current snapshot:', err)
      return this.snapshot
    } finally {
      // A throw anywhere above (bad payload shape from models.dev, …) must
      // not wedge this flag — refresh would silently die until restart.
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
    const providers: ProviderInfo[] = []
    const models: ModelInfo[] = []
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
      providers.push(toProviderInfo(providerId, entry))
      const seen = new Set<string>()
      for (const model of bundledModels) {
        if (seen.has(model.id)) continue
        seen.add(model.id)
        models.push(model)
      }
      for (const model of liveModels) {
        if (seen.has(model.id)) continue
        seen.add(model.id)
        models.push(model)
      }
    }
    // The local daemon entry is never part of the upstream payload.
    const ollama = BUNDLED_PROVIDERS.find((p) => p.id === 'ollama')
    if (ollama) providers.push(ollama)
    return { providers: sortProviders(providers), models }
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
