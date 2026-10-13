/**
 * OpenAI-compatible chat client with SSE streaming and function calling.
 * Covers Anthropic popular list, OpenAI, Google (OpenAI-compat endpoint),
 * OpenRouter, Vercel AI Gateway, OpenCode Zen, Ollama and every other
 * gateway that speaks the /chat/completions dialect.
 */
import type { LlmMessage, LlmProvider, LlmRequest, LlmResult, LlmStreamOptions, LlmToolCall } from './types'
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
  try {
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
  } finally {
    // A mid-stream throw (chunk.error) or an early consumer break must not
    // leave the body reader locked and the socket pinned until the server
    // times it out — retries would strand one stream per attempt.
    try {
      await reader.cancel()
    } catch {
      /* already closed */
    }
  }
}

export function toOpenAiMessages(messages: LlmMessage[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = []
  for (const m of messages) {
    if (m.role === 'system') {
      out.push({ role: 'system', content: m.content })
    } else if (m.role === 'user') {
      if (m.images?.length) {
        const parts: Array<Record<string, unknown>> = [{ type: 'text', text: m.content }]
        for (const image of m.images) parts.push({ type: 'image_url', image_url: { url: image.dataUri } })
        out.push({ role: 'user', content: parts })
      } else {
        out.push({ role: 'user', content: m.content })
      }
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
      // OpenAI-compatible tool messages are string-only. Images ride along
      // in a synthetic user turn right after the tool result — otherwise
      // read_image answers on every OpenAI-compat provider (DeepSeek, Groq,
      // OpenRouter, Gemini-compat, Ollama…) reach the model blind while the
      // tool output claims "It is attached to this conversation".
      out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content })
      if (m.images?.length) {
        const parts: Array<Record<string, unknown>> = [
          { type: 'text', text: `[Tool result for ${m.toolName ?? 'tool'} included an image — attached below.]` },
        ]
        for (const image of m.images) parts.push({ type: 'image_url', image_url: { url: image.dataUri } })
        out.push({ role: 'user', content: parts })
      }
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

  private body(request: LlmRequest, stream: boolean, withUsage = true): string {
    const body: Record<string, unknown> = {
      model: request.model,
      messages: toOpenAiMessages(request.messages),
      stream,
    }
    // Strict OpenAI-dialect servers only send the final usage chunk when it
    // is requested — without this, token accounting stays silently zeroed.
    if (stream && withUsage) body.stream_options = { include_usage: true }
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

  /** POST /chat/completions with a one-shot fallback for gateways that reject stream_options. */
  private async postChat(request: LlmRequest, stream: boolean, signal?: AbortSignal): Promise<Response> {
    let res = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: this.body(request, stream),
      signal,
    })
    // A few OpenAI-compat gateways blanket-400 the (standard) stream_options
    // field — retry once without usage accounting instead of failing the
    // whole turn over a diagnostic.
    if (res.status === 400 && stream) {
      let mentionsStreamOptions = false
      try {
        mentionsStreamOptions = /stream_options/i.test((await res.clone().text()).slice(0, 1000))
      } catch {
        /* ignore */
      }
      if (mentionsStreamOptions) {
        res = await fetch(`${this.baseURL}/chat/completions`, {
          method: 'POST',
          headers: this.headers(),
          body: this.body(request, stream, false),
          signal,
        })
      }
    }
    if (!res.ok) await this.failFrom(res)
    return res
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
      res.headers.get('retry-after'),
    )
  }

  async stream(request: LlmRequest, options: LlmStreamOptions): Promise<LlmResult> {
    const res = await this.postChat(request, true, options.signal ?? request.signal)

    const result: LlmResult = { text: '', reasoning: '', toolCalls: [], usage: { inputTokens: 0, outputTokens: 0 }, finishReason: 'other' }
    // Tool call fragments arrive in arbitrary index order; accumulate.
    const toolAcc = new Map<number, { id: string; name: string; args: string }>()
    // A dropped TCP connection ends the SSE loop like a normal completion —
    // without checking the terminal marker ([DONE] / finish_reason), a
    // truncated answer is saved as a successful turn.
    let sawTerminal = false

    for await (const data of sseLines(res)) {
      if (!data || data === '[DONE]') {
        if (data === '[DONE]') sawTerminal = true
        continue
      }
      let chunk: {
        choices?: Array<{
          delta?: { content?: string | null; reasoning?: string | null; reasoning_content?: string | null; tool_calls?: OpenAiToolCallDelta[] }
          finish_reason?: string | null
        }>
        usage?: { prompt_tokens?: number; completion_tokens?: number }
        error?: { message?: string } | string
      }
      try {
        chunk = JSON.parse(data)
      } catch {
        continue
      }
      // OpenAI-compatible gateways signal mid-stream failures as an error
      // payload instead of a choice (or close the stream right after) —
      // swallowing them produced silently truncated answers.
      if (chunk.error) {
        const message = typeof chunk.error === 'string' ? chunk.error : chunk.error.message
        throw new LlmError(message || 'Provider stream error', undefined, this.providerName)
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
        sawTerminal = true
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
    // Partial content with NO terminal marker = the connection died
    // mid-generation. Throw (status undefined → retryable) so withRetry can
    // re-request instead of persisting a silently truncated answer.
    if (!sawTerminal && (result.text || result.toolCalls.length)) {
      throw new LlmError(`${this.providerName} stream ended without a completion marker — the answer may be truncated`, undefined, this.providerName)
    }
    return result
  }

  async complete(request: LlmRequest): Promise<LlmResult> {
    const res = await this.postChat(request, false, request.signal)
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
