/** Context filter: each agent sees its messages + a digest, not everything. */
import { describe, expect, it } from 'vitest'
import { buildAgentContext, messageConcerns } from '@main/harness/context-filter'
import type { AgentConfig, ChatMessage } from '@shared/types'

function agent(id: string, name: string, roleId = 'coder'): AgentConfig {
  return {
    id,
    name,
    avatar: '🤖',
    color: '#fff',
    roleId,
    modelId: 'x',
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

const rin = agent('a1', 'Rin', 'planner')
const bao = agent('a2', 'Bao')
const mai = agent('a3', 'Mai')
const agents = [rin, bao, mai]

function msg(patch: Partial<ChatMessage>): ChatMessage {
  return {
    id: `m${Math.random().toString(36).slice(2, 7)}`,
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

describe('messageConcerns', () => {
  it('includes messages addressed to the agent', () => {
    const m = msg({ from: 'a2', role: 'assistant', content: '@Mai fix it', to: ['a3'], mentions: ['Mai'] })
    expect(messageConcerns(m, 'a3', 'a1', agents)).toBe(true)
    expect(messageConcerns(m, 'a2', 'a1', agents)).toBe(true) // own message
  })

  it('excludes messages for other agents (planner override aside)', () => {
    // a NON-planner third party sender keeps the exclusion path deterministic:
    const m2 = msg({ from: 'a3', role: 'assistant', content: 'internal note', to: ['a2'], mentions: ['Bao'] })
    expect(messageConcerns(m2, 'a2', 'a1', agents)).toBe(true)
    // planner always visible:
    const p = msg({ from: 'a1', role: 'assistant', content: 'everyone coordinate', to: [] })
    expect(messageConcerns(p, 'a3', 'a1', agents)).toBe(true)
  })

  it('includes the agent’s own messages', () => {
    const m = msg({ from: 'a2', role: 'assistant', content: 'done' })
    expect(messageConcerns(m, 'a2', 'a1', agents)).toBe(true)
  })

  it('always includes planner messages', () => {
    const m = msg({ from: 'a1', role: 'assistant', content: 'coordinates everyone', to: [] })
    expect(messageConcerns(m, 'a3', 'a1', agents)).toBe(true)
  })

  it('matches @Name mentions by display name', () => {
    const m = msg({ from: 'a1', role: 'assistant', content: 'hey @Mai review please', to: [], mentions: ['Mai'] })
    expect(messageConcerns(m, 'a3', 'a1', agents)).toBe(true)
  })
})

describe('buildAgentContext', () => {
  it('gives each agent only what concerns it plus a digest', () => {
    const messages = [
      msg({ role: 'user', content: 'Build the login page' }),
      msg({ from: 'a1', role: 'assistant', content: 'Plan: @Bao build the form, @Mai review after', to: ['a2', 'a3'], mentions: ['Bao', 'Mai'] }),
      msg({ from: 'a2', role: 'assistant', content: 'Form done. @Mai please review login-form.tsx', to: ['a3'], mentions: ['Mai'] }),
      msg({ from: 'a3', role: 'assistant', content: 'Looks good.', to: ['a2'], mentions: ['Bao'] }),
    ]
    const baoCtx = buildAgentContext({ agent: bao, agents, plannerId: 'a1', messages, objective: 'Ship login' })
    // Bao sees: the user message (digest), planner message (planner), its own.
    const speakers = baoCtx.transcript.map((t) => t.text.split(/[(:]/)[0]!.trim())
    expect(speakers).toContain('Rin')
    expect(speakers).toContain('Bao')
    // Mai's reply to Bao is visible to Bao (addressed), Mai's own context differs:
    const maiCtx = buildAgentContext({ agent: mai, agents, plannerId: 'a1', messages, objective: 'Ship login' })
    const maiText = maiCtx.transcript.map((t) => t.text).join(' ')
    expect(maiText).toContain('review login-form.tsx')
  })

  it('includes the objective and roster in system sections', () => {
    const ctx = buildAgentContext({ agent: bao, agents, plannerId: 'a1', messages: [], objective: 'Ship the app' })
    const sections = ctx.systemSections.join('\n')
    expect(sections).toContain('Ship the app')
    expect(sections).toContain('@Rin')
    expect(sections).toContain('CHIEF OF STAFF')
  })

  it('respects the character budget', () => {
    const big = Array.from({ length: 80 }, (_, i) =>
      msg({ from: 'a1', role: 'assistant', content: `@Bao ${'x'.repeat(2000)} #${i}`, to: ['a2'], mentions: ['Bao'] }),
    )
    const ctx = buildAgentContext({ agent: bao, agents, plannerId: 'a1', messages: big, objective: '', window: { charBudget: 5000 } })
    const total = ctx.systemSections.join('').length + ctx.transcript.map((t) => t.text).join('').length
    expect(total).toBeLessThan(7000)
  })
})
