/**
 * Auto-compaction.
 * When the estimated context size crosses ~70% of the model window, older
 * messages are folded into a structured summary (Objective / Requirements /
 * Decisions / Work State / Next Move / Relevant Files / Important Context)
 * while the most recent ~15k tokens stay verbatim. The summary lives on the
 * session and the transcript rebuild starts from it.
 */
import type { ChatMessage, ModelInfo } from '@shared/types'
import type { LlmMessage } from '../models/llm/types'

export const SUMMARY_HEADER = '## Conversation summary (auto-compacted)'
const KEEP_RECENT_TOKENS = 15_000
const CHARS_PER_TOKEN = 4

export function estimateTokens(messages: Array<{ content: string }>): number {
  let chars = 0
  for (const m of messages) chars += m.content.length
  return Math.ceil(chars / CHARS_PER_TOKEN)
}

export function contextWindowOf(model?: ModelInfo): number {
  return model?.contextWindow ?? 128_000
}

/** Compaction ceiling: window minus max(10%, 16k). */
export function compactionCeiling(windowTokens: number): number {
  return windowTokens - Math.max(Math.floor(windowTokens * 0.1), windowTokens >= 2 * 16_000 ? 16_000 : 0)
}

export interface CompactionPlan {
  needed: boolean
  /** Messages to summarize (older side). */
  older: ChatMessage[]
  /** Messages kept verbatim (recent side). */
  recent: ChatMessage[]
}

/** Split a session's messages into (older → summarize) + (recent → keep). */
export function planCompaction(messages: ChatMessage[], model: ModelInfo | undefined): CompactionPlan {
  const window = contextWindowOf(model)
  const ceiling = compactionCeiling(window)
  const total = estimateTokens(messages.map((m) => ({ content: m.content + JSON.stringify(m.parts ?? '') })))
  if (total <= ceiling) return { needed: false, older: [], recent: messages }

  // Walk from the newest message backwards accumulating keep budget.
  const recent: ChatMessage[] = []
  let kept = 0
  let lastUserIndex = messages.length
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!
    const size = Math.ceil((message.content.length + JSON.stringify(message.parts ?? '').length) / CHARS_PER_TOKEN)
    if (kept + size > KEEP_RECENT_TOKENS) break
    if (message.role === 'user') lastUserIndex = i
    recent.unshift(message)
    kept += size
  }
  // Always begin the recent window at a user message so the summary sits
  // cleanly in front of a turn boundary.
  // Backstop: when the keep budget broke BEFORE reaching any user message
  // (huge tool results inflate the first iterations), the walk above leaves
  // lastUserIndex at messages.length — that would fold the ENTIRE
  // conversation, including the newest user request, into the summary.
  // Snap the boundary to the newest user message instead.
  if (lastUserIndex === messages.length) {
    lastUserIndex = messages.findLastIndex((m) => m.role === 'user')
    if (lastUserIndex < 0) return { needed: false, older: [], recent: messages }
  }
  const older = messages.slice(0, lastUserIndex).filter((m) => m.role !== 'system')
  const recentFinal = messages.slice(lastUserIndex)
  if (!older.length) return { needed: false, older: [], recent: messages }
  return { needed: true, older, recent: recentFinal }
}

/** Flatten older messages into a plain-text transcript for the summarizer. */
export function olderToTranscript(older: ChatMessage[]): string {
  const lines: string[] = []
  for (const message of older) {
    if (message.role === 'user') {
      lines.push(`[user] ${message.content}`)
    } else if (message.role === 'assistant') {
      const toolRuns = (message.parts ?? []).flatMap((p) => (p.type === 'tool' ? [p.run] : []))
      const toolLines = toolRuns
        .slice(0, 6)
        .map((run) => `  (tool ${run.tool} ${JSON.stringify(run.args).slice(0, 160)} → ${String(run.result ?? run.state).slice(0, 200)})`)
      lines.push(`[assistant] ${message.content}`)
      for (const line of toolLines) lines.push(line)
    } else if (message.role === 'system') {
      lines.push(`[system] ${message.content}`)
    }
  }
  return lines.join('\n').slice(0, 300_000)
}

export const SUMMARIZE_PROMPT = `Summarize the conversation transcript below for a coding agent that will continue the work with no other memory.

Follow this template EXACTLY, keeping every heading:

## Objective
## Requirements
## Decisions
## Work State
### Completed
### Active
### Blocked
## Next Move
## Relevant Files
## Important Context

Rules:
- Be terse and factual; bullet points only, no prose paragraphs.
- "Relevant Files": at most 15 file paths with one-phrase purpose each.
- Preserve exact file paths, command names, error messages and numbers.
- If a section has nothing to report write "(none)".

Transcript:
`

export function summarizeRequest(transcript: string): Array<{ role: 'user'; content: string }> {
  return [{ role: 'user', content: SUMMARIZE_PROMPT + transcript }]
}

/** Light validation: the reply must follow the template's first heading. */
export function looksLikeSummary(text: string): boolean {
  return /##\s*Objective/.test(text) && /##\s*Work State/.test(text)
}

/** Build the synthetic LLM messages that open a compacted session. */
export function compactedPrefix(summary: string): LlmMessage[] {
  return [{ role: 'user', content: `${SUMMARY_HEADER}\n\n${summary}\n\n(Continue from here.)` }, { role: 'assistant', content: 'Understood — I have the full context from the summary and will continue the work from there.' }]
}
