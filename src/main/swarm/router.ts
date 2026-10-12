/**
 * Addressing router — the core of "no cross-talk".
 *
 * Every message carries explicit `to` (recipients) and `from` fields. The
 * router parses @mentions, resolves them against the roster, and produces
 * the exact set of agents that should take a turn next.
 */
import type { AgentConfig, ChatMessage } from '@shared/types'

export interface RoutingDecision {
  /** Agents that should take a turn now. */
  toRun: string[]
  /** Mentions that could not be resolved. */
  unknownMentions: string[]
}

export function extractMentions(text: string): string[] {
  // @Name counts only at the start or after a non-word character, so emails
  // (a@b.com) and Slack-style channel refs do not fire. Interior dots are
  // allowed (names like "Dev.Lead") but a mention never ENDS with a dot —
  // "@Vega, ship it." must capture "Vega", not "Vega," / "Vega.".
  const matches = text.match(/(?:^|[^A-Za-z0-9@])@([A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9][A-Za-z0-9_-]*)*)/g) ?? []
  // The leading separator char is part of each match ("(@Rin", "**@Rin"),
  // and .trim() only strips whitespace — cut after the LAST '@' so the
  // sigil never leaks into the name.
  return [...new Set(matches.map((m) => m.slice(m.lastIndexOf('@') + 1)))]
}

/** Resolve mention strings to agent ids (case-insensitive name match). */
export function resolveMentions(mentions: string[], agents: AgentConfig[]): { resolved: string[]; unknown: string[] } {
  const resolved: string[] = []
  const unknown: string[] = []
  for (const mention of mentions) {
    // Models pass "@Name" as often as "Name" — strip the sigil before
    // matching (the sigil-aware extractMentions already does this upstream,
    // but manual callers and tool arguments may not).
    const name = mention.trim().replace(/^@+/, '')
    const agent = agents.find((a) => a.name.toLowerCase() === name.toLowerCase())
    if (agent) {
      if (!resolved.includes(agent.id)) resolved.push(agent.id)
    } else {
      unknown.push(name)
    }
  }
  return { resolved, unknown }
}

/** Parse an agent's reply text into (mentions, cleaned content). */
export function parseAgentReply(content: string, agents: AgentConfig[]): { to: string[]; mentions: string[]; unknownMentions: string[] } {
  const mentions = extractMentions(content)
  const { resolved, unknown } = resolveMentions(mentions, agents)
  return { to: resolved, mentions, unknownMentions: unknown }
}

/**
 * Who should run after a message?
 *  - a user message: the @mentioned agents, or the planner (if configured),
 *    or every enabled agent in parallel when neither applies.
 *  - an agent message: the agents it @addressed (excluding the author),
 *    minus anyone who already spoke this round (loop guard).
 */
export function routeNext(params: {
  message: Pick<ChatMessage, 'from' | 'role' | 'content' | 'to' | 'mentions'>
  agents: AgentConfig[]
  plannerId?: string
  alreadySpoke: Set<string>
}): RoutingDecision {
  const { message, agents, plannerId, alreadySpoke } = params
  const enabled = agents.filter((a) => a.enabled)

  if (message.role === 'user') {
    const { resolved, unknown } = resolveMentions(message.mentions, enabled)
    if (resolved.length) return { toRun: resolved, unknownMentions: unknown }
    // The user wrote @mentions but none resolve to a real agent: route to
    // nobody and surface the unknown names — never fall through to broadcast.
    if (message.mentions.length) return { toRun: [], unknownMentions: unknown }
    if (plannerId && enabled.some((a) => a.id === plannerId)) return { toRun: [plannerId], unknownMentions: unknown }
    return { toRun: enabled.map((a) => a.id), unknownMentions: unknown }
  }

  // Agent message: route to addressed teammates.
  const { resolved, unknown } = resolveMentions(message.mentions, enabled)
  const targets = resolved.filter((id) => id !== message.from && !alreadySpoke.has(id))
  return { toRun: targets, unknownMentions: unknown }
}

/** Build the addressing header shown on a message bubble. */
export function describeAddressing(message: Pick<ChatMessage, 'from' | 'fromName' | 'role' | 'to'>, nameOf: (id: string) => string): string {
  if (message.role === 'user') {
    return message.to.length ? `→ ${message.to.map(nameOf).join(', ')}` : ''
  }
  return message.to.length ? `→ ${message.to.map(nameOf).join(', ')}` : ''
}
