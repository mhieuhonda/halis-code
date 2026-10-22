/**
 * Anthropic Messages API client with SSE streaming and tool use.
 */
import type { LlmMessage, LlmProvider, LlmRequest, LlmResult, LlmStreamOptions, LlmToolCall } from './types'
import { LlmError } from './types'

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'tool_result'; tool_use_id: string; content: string | ContentBlock[]; is_error?: boolean }

function imageBlock(dataUri: string): ContentBlock | null {
  const match = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(dataUri)
  if (!match) return null
  return { type: 'image', source: { type: 'base64', media_type: match[1]!.toLowerCase(), data: match[2]! } }
}

/**
 * The Anthropic Messages API requires user/assistant roles to strictly
 * alternate, but the agent loop legitimately produces consecutive user
 * turns: one tool_result message per parallel tool call, and the final-step
 * "wrap up" nudge right after tool results. Merge them into the previous
 * user message's content blocks instead of sending two user messages in a
 * row (a guaranteed 400: "roles must alternate").
 */
function pushUserMessage(messages: Array<Record<string, unknown>>, content: ContentBlock[]): void {
  const last = messages[messages.length - 1]
  if (last && last.role === 'user') {
    last.content = [...(last.content as ContentBlock[]), ...content]
    return
  }
  messages.push({ role: 'user', content })
}

export class AnthropicProvider implements LlmProvider {
  constructor(
    private readonly apiKey: string,
    private readonly baseURL = 'https://api.anthropic.com/v1',
    private readonly providerName = 'anthropic',
  ) {}

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01',
      // Direct browser/WebView calls need this explicit opt-in.
      'anthropic-dangerous-direct-browser-access': 'true',
    }
  }

  private body(request: LlmRequest, stream: boolean): string {
    let system = ''
    const messages: Array<Record<string, unknown>> = []
    for (const m of request.messages) {
      if (m.role === 'system') {
        system += (system ? '\n\n' : '') + m.content
      } else if (m.role === 'user') {
        if (m.images?.length) {
          const content: ContentBlock[] = [{ type: 'text', text: m.content }]
          for (const image of m.images) {
            const block = imageBlock(image.dataUri)
            if (block) content.push(block)
          }
          pushUserMessage(messages, content)
        } else {
          pushUserMessage(messages, [{ type: 'text', text: m.content }])
        }
      } else if (m.role === 'assistant') {
        const content: ContentBlock[] = []
        if (m.content) content.push({ type: 'text', text: m.content })
        for (const c of m.toolCalls ?? []) {
          let input: unknown = {}
          try {
            input = JSON.parse(c.arguments || '{}')
          } catch {
            input = { _raw: c.arguments }
          }
          content.push({ type: 'tool_use', id: c.id, name: c.name, input })
        }
        messages.push({ role: 'assistant', content })
      } else {
        const content: ContentBlock[] = [{ type: 'text', text: m.content }]
        for (const image of m.images ?? []) {
          const block = imageBlock(image.dataUri)
          if (block) content.push(block)
        }
        pushUserMessage(messages, [
          { type: 'tool_result', tool_use_id: m.toolCallId, content: content.length > 1 ? content : m.content, is_error: !!m.isError },
        ])
      }
    }
    const body: Record<string, unknown> = {
      model: request.model,
      max_tokens: request.maxTokens ?? 8192,
      messages,
      stream,
    }
    if (system) body.system = system
    if (request.temperature !== undefined) body.temperature = request.temperature
    if (request.tools?.length) {
      body.tools = request.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }))
    }
    return JSON.stringify(body)
  }

  private async failFrom(res: Response): Promise<never> {
    let detail = ''
    try {
      const json = (await res.json()) as { error?: { message?: string } }
      detail = json.error?.message ?? ''
    } catch {
      /* ignore */
    }
    throw new LlmError(`${this.providerName} request failed (${res.status}): ${detail.slice(0, 500) || res.statusText}`, res.status, this.providerName, res.headers.get('retry-after'))
  }

  async stream(request: LlmRequest, options: LlmStreamOptions): Promise<LlmResult> {
    const res = await fetch(`${this.baseURL}/messages`, {
      method: 'POST',
      headers: this.headers(),
      body: this.body(request, true),
      signal: options.signal ?? request.signal,
    })
    if (!res.ok) await this.failFrom(res)

    const result: LlmResult = { text: '', reasoning: '', toolCalls: [], usage: { inputTokens: 0, outputTokens: 0 }, finishReason: 'other' }
    // SSE framing: "event: x\ndata: {...}"
    const toolAcc = new Map<number, { id: string; name: string; args: string }>()
    let currentToolIdx = -1
    // message_stop / stop_reason are the terminal markers — without one, a
    // dropped connection saves a truncated answer as a successful turn.
    let sawTerminal = false

    if (!res.body) throw new LlmError('Anthropic stream returned no body', undefined, this.providerName)
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let raw = ''
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        raw += decoder.decode(value, { stream: true })
        let nl: number
        while ((nl = raw.indexOf('\n')) >= 0) {
          const line = raw.slice(0, nl).replace(/\r$/, '')
          raw = raw.slice(nl + 1)
          if (!line.startsWith('data:')) continue
          const data = line.slice(5).trim()
          if (!data || data === '[DONE]') continue
        let evt: {
          type: string
          content_block?: ContentBlock
          delta?: { type?: string; text?: string; thinking?: string; partial_json?: string; stop_reason?: string }
          index?: number
          message?: { usage?: { input_tokens?: number; output_tokens?: number } }
          usage?: { input_tokens?: number; output_tokens?: number }
          error?: { message?: string }
        }
        try {
          evt = JSON.parse(data)
        } catch {
          continue
        }
        switch (evt.type) {
          case 'message_start':
            result.usage.inputTokens = evt.message?.usage?.input_tokens ?? 0
            break
          case 'content_block_start': {
            const block = evt.content_block
            if (block?.type === 'tool_use') {
              currentToolIdx = evt.index ?? toolAcc.size
              toolAcc.set(currentToolIdx, { id: block.id, name: block.name, args: '' })
            }
            break
          }
          case 'content_block_delta': {
            const d = evt.delta
            if (d?.type === 'text_delta' && d.text) {
              result.text += d.text
              options.onEvent({ type: 'text', delta: d.text })
            } else if (d?.type === 'thinking_delta' && d.thinking) {
              result.reasoning += d.thinking
              options.onEvent({ type: 'reasoning', delta: d.thinking })
            } else if (d?.type === 'input_json_delta' && d.partial_json) {
              const acc = toolAcc.get(evt.index ?? currentToolIdx)
              if (acc) acc.args += d.partial_json
            }
            break
          }
          case 'message_delta':
            if (evt.delta?.stop_reason === 'tool_use') result.finishReason = 'tool_calls'
            else if (evt.delta?.stop_reason === 'max_tokens') result.finishReason = 'length'
            else if (evt.delta?.stop_reason === 'end_turn') result.finishReason = 'stop'
            if (evt.delta?.stop_reason) sawTerminal = true
            if (evt.usage?.output_tokens) result.usage.outputTokens = evt.usage.output_tokens
            break
          case 'message_stop':
            sawTerminal = true
            break
          case 'error':
            // Anthropic sends `event: error` mid-stream (e.g. overloaded).
            // Swallowing it turned a server-side failure into a silently
            // truncated "successful" answer — surface it so withRetry can
            // retry and the runner can mark the turn errored.
            throw new LlmError(evt.error?.message ?? 'Anthropic stream error', undefined, this.providerName)
        }
      }
    }
    } finally {
      // A mid-stream throw must not leave the body reader locked and the
      // socket pinned until the provider times it out — retries would strand
      // one stream per attempt.
      try {
        await reader.cancel()
      } catch {
        /* already closed */
      }
    }

    for (const [, acc] of [...toolAcc.entries()].sort((a, b) => a[0] - b[0])) {
      const call: LlmToolCall = { id: acc.id, name: acc.name, arguments: acc.args || '{}' }
      result.toolCalls.push(call)
      options.onEvent({ type: 'toolCall', call })
    }
    if (result.toolCalls.length) result.finishReason = 'tool_calls'
    // Partial content with NO terminal marker = the connection died
    // mid-generation. Throw (status undefined → retryable) so withRetry can
    // re-request instead of persisting a silently truncated answer.
    // Reasoning-only streams count: a stream killed after thinking deltas
    // but before text/tool output used to pass as a successful empty turn.
    if (!sawTerminal && (result.text || result.reasoning || result.toolCalls.length)) {
      throw new LlmError(`${this.providerName} stream ended without a completion marker — the answer may be truncated`, undefined, this.providerName)
    }
    return result
  }

  async complete(request: LlmRequest): Promise<LlmResult> {
    const res = await fetch(`${this.baseURL}/messages`, {
      method: 'POST',
      headers: this.headers(),
      body: this.body(request, false),
      signal: request.signal,
    })
    if (!res.ok) await this.failFrom(res)
    const json = (await res.json()) as {
      content?: ContentBlock[]
      usage?: { input_tokens?: number; output_tokens?: number }
      stop_reason?: string
    }
    let text = ''
    let reasoning = ''
    const toolCalls: LlmToolCall[] = []
    for (const block of json.content ?? []) {
      if (block.type === 'text') text += block.text
      else if (block.type === 'thinking') reasoning += block.thinking
      else if (block.type === 'tool_use') toolCalls.push({ id: block.id, name: block.name, arguments: JSON.stringify(block.input ?? {}) })
    }
    return {
      text,
      reasoning,
      toolCalls,
      usage: { inputTokens: json.usage?.input_tokens ?? 0, outputTokens: json.usage?.output_tokens ?? 0 },
      finishReason: toolCalls.length ? 'tool_calls' : 'stop',
    }
  }
}

/** Re-exported for the tool-result conversion used by the agent loop. */
export function llmMessagesFromParts(messages: LlmMessage[]): LlmMessage[] {
  return messages
}
