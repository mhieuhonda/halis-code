/** Router: @mention parsing and routing decisions — the anti-cross-talk core. */
import { describe, expect, it } from 'vitest'
import { extractMentions, parseAgentReply, resolveMentions, routeNext } from '@main/swarm/router'
import type { AgentConfig, ChatMessage } from '@shared/types'

function agent(id: string, name: string, roleId = 'coder'): AgentConfig {
  return {
    id,
    name,
    avatar: '🤖',
    color: '#fff',
    roleId,
    modelId: 'pollinations/openai-fast',
    permissions: {
      readOnly: false,
      autoApproveEdits: false,
      canRunShell: true,
      autoApproveShell: false,
      canUseTelegraph: true,
      usdcAutoApproveUpTo: 0,
    },
    enabled: true,
  }
}

const agents = [agent('a1', 'Rin', 'planner'), agent('a2', 'Bao', 'coder'), agent('a3', 'Mai', 'reviewer')]

function msg(patch: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'm',
    sessionId: 's',
    mode: 'swarm',
    from: 'user',
    fromName: 'You',
    to: [],
    mentions: [],
    role: 'user',
    content: '',
    createdAt: Date.now(),
    ...patch,
  }
}

describe('extractMentions', () => {
  it('parses unique @mentions', () => {
    expect(extractMentions('hey @Rin and @Bao, also @Rin again')).toEqual(['Rin', 'Bao'])
  })
  it('ignores emails and bare @', () => {
    expect(extractMentions('mail me at a@b.com @ @')).toEqual([])
  })
})

describe('resolveMentions', () => {
  it('is case-insensitive and flags unknown names', () => {
    const { resolved, unknown } = resolveMentions(['rin', 'Nobody'], agents)
    expect(resolved).toEqual(['a1'])
    expect(unknown).toEqual(['Nobody'])
  })
})

describe('parseAgentReply', () => {
  it('extracts addressed teammates from reply text', () => {
    const reply = parseAgentReply('@Bao please fix src/app.ts, then tell @Mai', agents)
    expect(reply.to).toEqual(['a2', 'a3'])
    expect(reply.mentions).toEqual(['Bao', 'Mai'])
  })
})

describe('routeNext', () => {
  it('user @mentions route to exactly those agents', () => {
    const d = routeNext({ message: msg({ content: '@Bao do it', mentions: ['Bao'] }), agents, alreadySpoke: new Set() })
    expect(d.toRun).toEqual(['a2'])
  })

  it('user message without mentions routes to the planner when one exists', () => {
    const d = routeNext({ message: msg({ content: 'build me a thing' }), agents, plannerId: 'a1', alreadySpoke: new Set() })
    expect(d.toRun).toEqual(['a1'])
  })

  it('falls back to everyone when no planner', () => {
    const noPlanner = agents.filter((a) => a.roleId !== 'planner')
    const d = routeNext({ message: msg({ content: 'build' }), agents: noPlanner, alreadySpoke: new Set() })
    expect(d.toRun).toEqual(['a2', 'a3'])
  })

  it('agent messages never route back to the author', () => {
    const d = routeNext({
      message: msg({ from: 'a2', role: 'assistant', content: '@Bao me please', mentions: ['Bao'] }),
      agents,
      alreadySpoke: new Set(),
    })
    expect(d.toRun).toEqual([])
  })

  it('skips agents that already spent their speak budget', () => {
    const d = routeNext({
      message: msg({ from: 'a1', role: 'assistant', content: '@Bao go', mentions: ['Bao'] }),
      agents,
      alreadySpoke: new Set(['a2']),
    })
    expect(d.toRun).toEqual([])
  })

  it('reports unknown mentions so the harness can warn the user', () => {
    const d = routeNext({ message: msg({ content: '@Ghost hello', mentions: ['Ghost'] }), agents, plannerId: 'a1', alreadySpoke: new Set() })
    expect(d.toRun).toEqual([])
    expect(d.unknownMentions).toEqual(['Ghost'])
  })
})
