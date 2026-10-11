/**
 * Swarm context filtering — the anti-cross-talk layer.
 *
 * Every agent gets: its system prompt, the shared objective, a compact
 * digest of the general conversation, and every message addressed to it,
 * sent by it, or @mentioning it. Everything else is summarized away. The
 * planner's messages are always visible because the planner is the
 * coordinator.
 */
import type { AgentConfig, ChatMessage } from '@shared/types'

export interface ContextWindow {
  /** Rolling objective text pinned to the top of the context. */
  objective: string
  /** How many recent general messages to include as digest. */
  digestWindow: number
  /** Hard character budget for the assembled transcript. */
  charBudget: number
}

export const DEFAULT_CONTEXT_WINDOW: ContextWindow = {
  objective: '',
  digestWindow: 10,
  charBudget: 48_000,
}

export function messageConcerns(message: ChatMessage, agentId: string, plannerId: string | undefined, allAgents: AgentConfig[]): boolean {
  if (message.from === agentId) return true
  if (message.role === 'user' && (!message.to.length || message.to.includes('all'))) return false // user broadcast handled by digest/planner
  if (message.to.includes(agentId)) return true
  if (message.mentions.includes(agentId)) return true
  // Mentioning by name also counts — models emit "@Name".
  const agent = allAgents.find((a) => a.id === agentId)
  if (agent) {
    const lower = message.content.toLowerCase()
    if (message.mentions.some((m) => m.toLowerCase() === agent.name.toLowerCase())) return true
    if (lower.includes(`@${agent.name.toLowerCase()}`)) return true
  }
  if (plannerId && message.from === plannerId) return true
  return false
}

/** Compact a message for the digest section. */
function digestLine(message: ChatMessage, nameOf: (id: string) => string): string {
  const who = message.role === 'user' ? 'User' : nameOf(message.from)
  const to = message.to.length ? ` → ${message.to.map(nameOf).join(', ')}` : ''
  const content = message.content.replace(/\s+/g, ' ').slice(0, 400)
  return `${who}${to}: ${content}`
}

export interface AssembledContext {
  systemSections: string[]
  transcript: Array<{ role: 'user' | 'assistant'; text: string }>
}

/**
 * Build the per-agent view of a swarm conversation, formatted as an
 * OpenAI-style transcript (role user/assistant). Tool noise is omitted —
 * agents see each other's *messages*, not raw tool output.
 */
export function buildAgentContext(params: {
  agent: AgentConfig
  agents: AgentConfig[]
  plannerId?: string
  messages: ChatMessage[]
  objective: string
  window?: Partial<ContextWindow>
}): AssembledContext {
  const { agent, agents, plannerId, messages, objective } = params
  const window = { ...DEFAULT_CONTEXT_WINDOW, ...params.window }
  const nameOf = (id: string) => {
    if (id === 'user') return 'User'
    return agents.find((a) => a.id === id)?.name ?? id
  }

  const mine: ChatMessage[] = []
  const digestSource: ChatMessage[] = []

  for (const message of messages) {
    if (message.role === 'system') continue
    if (messageConcerns(message, agent.id, plannerId, agents)) {
      mine.push(message)
    } else {
      digestSource.push(message)
    }
  }

  // Newest N general messages as a running summary; older ones collapse to a count.
  const recentDigest = digestSource.slice(-window.digestWindow)
  const olderCount = digestSource.length - recentDigest.length

  const lines: string[] = []
  if (objective) lines.push(`## Objective\n${objective}`)
  lines.push(`## Team\n${agents.map((a) => `- ${a.name} (@${a.name}, role: ${a.roleId}${a.id === plannerId ? ', PLANNER' : ''})`).join('\n')}`)
  if (olderCount > 0) {
    lines.push(`## Conversation so far\n(${olderCount} earlier messages summarized away)`)
  }
  if (recentDigest.length) {
    lines.push(`## Recent group context\n${recentDigest.map((m) => digestLine(m, nameOf)).join('\n')}`)
  }

  const transcript = mine.map((m) => {
    const speaker = m.role === 'user' ? 'User' : nameOf(m.from)
    const recipients = m.to.length ? ` (to: ${m.to.map(nameOf).join(', ')})` : ''
    return {
      role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
      text: `${speaker}${recipients}:\n${m.content}`,
    }
  })

  // Character budget: trim digest sections first, then oldest transcript turns.
  let sections = lines.join('\n\n')
  if (sections.length > window.charBudget * 0.4) {
    sections = lines.slice(0, 2).join('\n\n') + `\n\n(…earlier context trimmed to fit the window…)`
  }
  let transcriptText = transcript
    .map((t) => `${t.role}: ${t.text}`)
    .join('\n\n')
  while (transcriptText.length + sections.length > window.charBudget && transcript.length > 2) {
    transcript.shift()
    transcriptText = transcript.map((t) => `${t.role}: ${t.text}`).join('\n\n')
  }

  return {
    systemSections: [sections],
    transcript,
  }
}
