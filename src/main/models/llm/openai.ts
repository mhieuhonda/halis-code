/**
 * OpenAI-compatible chat client with SSE streaming and function calling.
 * Covers OpenAI, DeepSeek, Groq, OpenRouter, Mistral, Z.AI, Moonshot,
 * MiniMax, Together, Cerebras, xAI, Google (OpenAI-compat endpoint),
 * Pollinations, LLM7, Ollama, OpenCode Zen and every other gateway that
 * speaks the /chat/completions dialect.
 */
import type { LlmMessage, LlmProvider, LlmRequest, LlmResult, LlmStreamEvent, LlmStreamOptions, LlmToolCall } from './types'
import { LlmError } from './types'

interface OpenAiToolCallDelta {
  index?: number
  id?: string
  type?: string
  function?: { name?: string; arguments?: string }
}

/**
 * Some gateways serving gpt-oss-style models leak harmony channel markers
 * ("[channel]>commentary", "<|channel|>commentary", "<|start|>assistant", …)
 * into tool-call names and arguments. Strip them so the harness receives
 * clean JSON.
 */
function stripChannelMarkers(value: string): string {
  return value
    .replace(/<\|[^|>]{0,40}\|>/g, '')
    .replace(/\[channel\]\s*>\s*(commentary|final|analysis|system)\s*/gi, '')
    .replace(/^(assistant|commentary|final|analysis)\b[:\s]*/i, '')
    .trim()
}

async function* sseLines(res: Response): AsyncGenerator<string> {
  if (!res.body) return
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).replace(/\r$/, '')
      buffer = buffer.slice(nl + 1)
      if (line.startsWith('data:')) yield line.slice(5).trim()
    }
  }
  const rest = buffer.trim()
  if (rest.startsWith('data:')) yield rest.slice(5).trim()
}

export function toOpenAiMessages(messages: LlmMessage[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = []
  for (const m of messages) {
    if (m.role === 'system') {
      out.push({ role: 'system', content: m.content })
    } else if (m.role === 'user') {
      out.push({ role: 'user', content: m.content })
    } else if (m.role === 'assistant') {
      const msg: Record<string, unknown> = { role: 'assistant', content: m.content || null }
      if (m.toolCalls?.length) {
        msg.tool_calls = m.toolCalls.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: c.arguments },
        }))
      }
      out.push(msg)
    } else {
      out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content })
    }
  }
  return out
}

export class OpenAiCompatProvider implements LlmProvider {
  constructor(
    private readonly baseURL: string,
    private readonly apiKey?: string,
    private readonly providerName = 'openai-compatible',
    private readonly extraHeaders: Record<string, string> = {},
  ) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json', ...this.extraHeaders }
    if (this.apiKey) h.Authorization = `Bearer ${this.apiKey}`
    return h
  }

  private body(request: LlmRequest, stream: boolean): string {
    const body: Record<string, unknown> = {
      model: request.model,
      messages: toOpenAiMessages(request.messages),
      stream,
    }
    if (request.tools?.length) {
      body.tools = request.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }))
    }
    if (request.temperature !== undefined) body.temperature = request.temperature
    if (request.maxTokens) body.max_tokens = request.maxTokens
    return JSON.stringify(body)
  }

  private async failFrom(res: Response): Promise<never> {
    let detail = ''
    try {
      const text = await res.text()
      try {
        const json = JSON.parse(text) as { error?: { message?: string } | string; message?: string }
        if (typeof json.error === 'string') detail = json.error
        else detail = json.error?.message ?? json.message ?? text
      } catch {
        detail = text
      }
    } catch {
      /* ignore */
    }
    throw new LlmError(
      `${this.providerName} request failed (${res.status}): ${detail.slice(0, 500) || res.statusText}`,
      res.status,
      this.providerName,
    )
  }

  async stream(request: LlmRequest, options: LlmStreamOptions): Promise<LlmResult> {
    const res = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: this.body(request, true),
      signal: options.signal ?? request.signal,
    })
    if (!res.ok) await this.failFrom(res)

    const result: LlmResult = { text: '', reasoning: '', toolCalls: [], usage: { inputTokens: 0, outputTokens: 0 }, finishReason: 'other' }
    // Tool call fragments arrive in arbitrary index order; accumulate.
    const toolAcc = new Map<number, { id: string; name: string; args: string }>()

    for await (const data of sseLines(res)) {
      if (!data || data === '[DONE]') continue
      let chunk: {
        choices?: Array<{
          delta?: { content?: string | null; reasoning?: string | null; reasoning_content?: string | null; tool_calls?: OpenAiToolCallDelta[] }
          finish_reason?: string | null
        }>
        usage?: { prompt_tokens?: number; completion_tokens?: number }
      }
      try {
        chunk = JSON.parse(data)
      } catch {
        continue
      }
      if (chunk.usage) {
        result.usage.inputTokens = chunk.usage.prompt_tokens ?? result.usage.inputTokens
        result.usage.outputTokens = chunk.usage.completion_tokens ?? result.usage.outputTokens
      }
      const choice = chunk.choices?.[0]
      if (!choice) continue
      const delta = choice.delta ?? {}
      if (typeof delta.content === 'string' && delta.content) {
        result.text += delta.content
        options.onEvent({ type: 'text', delta: delta.content })
      }
      const reasoning = delta.reasoning ?? delta.reasoning_content
      if (typeof reasoning === 'string' && reasoning) {
        result.reasoning += reasoning
        options.onEvent({ type: 'reasoning', delta: reasoning })
      }
      for (const tc of delta.tool_calls ?? []) {
        const idx = tc.index ?? 0
        const acc = toolAcc.get(idx) ?? { id: '', name: '', args: '' }
        if (tc.id) acc.id = tc.id
        if (tc.function?.name) acc.name += tc.function.name
        if (tc.function?.arguments) acc.args += tc.function.arguments
        toolAcc.set(idx, acc)
      }
      if (choice.finish_reason) {
        result.finishReason =
          choice.finish_reason === 'tool_calls' ? 'tool_calls' : choice.finish_reason === 'length' ? 'length' : choice.finish_reason === 'stop' ? 'stop' : 'other'
      }
    }

    for (const [idx, acc] of [...toolAcc.entries()].sort((a, b) => a[0] - b[0])) {
      const call: LlmToolCall = {
        id: acc.id || `call_${idx}_${Date.now()}`,
        name: stripChannelMarkers(acc.name),
        arguments: stripChannelMarkers(acc.args) || '{}',
      }
      result.toolCalls.push(call)
      options.onEvent({ type: 'toolCall', call })
    }
    if (result.toolCalls.length) result.finishReason = 'tool_calls'
    return result
  }

  async complete(request: LlmRequest): Promise<LlmResult> {
    const res = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: this.body(request, false),
      signal: request.signal,
    })
    if (!res.ok) await this.failFrom(res)
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string; reasoning?: string; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> } }>
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }
    const msg = json.choices?.[0]?.message
    return {
      text: msg?.content ?? '',
      reasoning: msg?.reasoning ?? '',
      toolCalls: (msg?.tool_calls ?? []).map((t, i) => ({
        id: t.id ?? `call_${i}`,
        name: t.function?.name ?? '',
        arguments: t.function?.arguments ?? '{}',
      })),
      usage: { inputTokens: json.usage?.prompt_tokens ?? 0, outputTokens: json.usage?.completion_tokens ?? 0 },
      finishReason: 'stop',
    }
  }
}
