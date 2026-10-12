/**
 * Provider dispatcher: resolves a catalog model id ("provider/model") to a
 * concrete LLM provider client using the user's stored key.
 */
import type { CatalogSnapshot, ModelInfo } from '@shared/types'
import { LlmError } from './types'
import type { LlmProvider, LlmRequest, LlmResult, LlmStreamOptions } from './types'
import { OpenAiCompatProvider } from './openai'
import { AnthropicProvider } from './anthropic'
import { withRetry } from './retry'

/** On retries, previous partial deltas already reached the UI — suppress echo. */
function quietEvents(options: LlmStreamOptions): LlmStreamOptions {
  return { signal: options.signal, onEvent: () => {} }
}

export interface ProviderResolution {
  provider: LlmProvider
  model: ModelInfo
}

export type KeyLookup = (providerId: string) => string | undefined

export class LlmDispatcher {
  constructor(
    private readonly getCatalog: () => CatalogSnapshot,
    private readonly lookupKey: KeyLookup,
  ) {}

  /**
   * Explicit key overrides the vault (used by per-agent keys in Swarm).
   * A blank/whitespace override (e.g. a swarm agent with no per-agent key)
   * falls through to the vault, so a key saved once in Models & Keys works
   * for every agent on that provider without re-entering it.
   */
  resolve(modelId: string, keyOverride?: string): ProviderResolution {
    const { providers, models } = this.getCatalog()
    const model = models.find((m) => m.id === modelId)
    if (!model) throw new LlmError(`Unknown model: ${modelId}. Only models shipped with the app can be used.`, undefined, 'catalog')
    const providerInfo = providers.find((p) => p.id === model.providerId)
    if (!providerInfo) throw new LlmError(`Unknown provider: ${model.providerId}`, undefined, 'catalog')
    const explicit = keyOverride?.trim()
    const key = explicit ? explicit : this.lookupKey(model.providerId)
    if (!providerInfo.keyless && !key) {
      throw new LlmError(`No API key set for ${providerInfo.name}. Open Models & Keys to add one (${providerInfo.envKey ?? 'API key'}).`, undefined, providerInfo.id)
    }
    if (providerInfo.apiStyle === 'anthropic') {
      return { provider: new AnthropicProvider(key!, providerInfo.baseURL, providerInfo.name), model }
    }
    const headers: Record<string, string> = { 'User-Agent': 'halis-code/0.1' }
    if (model.providerId === 'openrouter') {
      headers['HTTP-Referer'] = 'https://github.com/mhieuhonda/halis-code'
      headers['X-Title'] = 'Halis Code'
    }
    return {
      provider: new OpenAiCompatProvider(providerInfo.baseURL, key, providerInfo.name, headers),
      model,
    }
  }

  async stream(modelId: string, request: LlmRequest, options: LlmStreamOptions, keyOverride?: string): Promise<LlmResult> {
    const { provider, model } = this.resolve(modelId, keyOverride)
    return withRetry(
      (attempt) =>
        provider.stream(
          {
            ...request,
            model: model.apiId,
            maxTokens: request.maxTokens ?? (model.maxOutput ? Math.min(model.maxOutput, 32768) : undefined),
          },
          attempt === 0 ? options : { ...options, onEvent: attempt === 0 ? options.onEvent : quietEvents(options).onEvent },
        ),
      options.signal ?? request.signal,
    )
  }

  async complete(modelId: string, request: LlmRequest, keyOverride?: string): Promise<LlmResult> {
    const { provider, model } = this.resolve(modelId, keyOverride)
    return withRetry(() =>
      provider.complete({ ...request, model: model.apiId, maxTokens: request.maxTokens ?? (model.maxOutput ? Math.min(model.maxOutput, 8192) : undefined) }),
    request.signal,
    )
  }

  /** Cheap liveness/key check: one-token completion. */
  async testModel(modelId: string, keyOverride?: string): Promise<{ ok: boolean; detail: string }> {
    try {
      const res = await this.complete(
        modelId,
        {
          model: modelId,
          messages: [
            { role: 'user', content: 'Reply with the single word: pong' },
          ],
          maxTokens: 16,
        },
        keyOverride,
      )
      return { ok: true, detail: res.text.trim().slice(0, 60) || 'connected' }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, detail: message }
    }
  }
}
