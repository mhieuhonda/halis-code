/**
 * Unified LLM message/stream vocabulary, normalized across
 * OpenAI-compatible and Anthropic wire formats.
 */

export interface LlmToolDef {
  name: string
  description: string
  parameters: Record<string, unknown> // JSON Schema object
}

export interface LlmToolCall {
  id: string
  name: string
  arguments: string
}

export type LlmMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string; images?: Array<{ mime: string; dataUri: string }> }
  | { role: 'assistant'; content: string; toolCalls?: LlmToolCall[] }
  | { role: 'tool'; toolCallId: string; toolName: string; content: string; isError?: boolean; images?: Array<{ mime: string; dataUri: string }> }

export interface LlmRequest {
  /** Provider model id string (what the API expects in `model`). */
  model: string
  messages: LlmMessage[]
  tools?: LlmToolDef[]
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
}

export type LlmStreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'reasoning'; delta: string }
  | { type: 'toolCall'; call: LlmToolCall }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'error'; error: string }

export interface LlmUsage {
  inputTokens: number
  outputTokens: number
}

export interface LlmResult {
  text: string
  reasoning: string
  toolCalls: LlmToolCall[]
  usage: LlmUsage
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error' | 'other'
}

export interface LlmStreamOptions {
  signal?: AbortSignal
  onEvent: (event: LlmStreamEvent) => void
}

export interface LlmProvider {
  stream(request: LlmRequest, options: LlmStreamOptions): Promise<LlmResult>
  /** Non-streaming convenience used for tiny calls (titles, routing). */
  complete(request: LlmRequest): Promise<LlmResult>
}

export class LlmError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly provider?: string,
    public readonly retryAfter?: string | null,
  ) {
    super(message)
    this.name = 'LlmError'
  }
}
