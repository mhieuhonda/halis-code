/** Permission engine: read-only auto-allow, per-agent gates, USDC limits. */
import { describe, expect, it } from 'vitest'
import { evaluate, isReadOnlyTool } from '@main/harness/permissions'
import type { AgentPermissions } from '@shared/types'

function perms(patch: Partial<AgentPermissions> = {}): AgentPermissions {
  return {
    readOnly: false,
    autoApproveEdits: false,
    canRunShell: true,
    autoApproveShell: false,
    canUseTelegraph: true,
    usdcAutoApproveUpTo: 0,
    ...patch,
  }
}

const base = {
  tool: 'read_file',
  kind: 'other' as const,
  readOnly: true,
  agent: perms(),
  alwaysRules: [],
  agentId: 'a1',
  autoApproveAll: false,
}

describe('evaluate', () => {
  it('auto-allows read-only tools', () => {
    const d = evaluate({ ...base, tool: 'read_file', kind: 'other', readOnly: true })
    expect(d.effect).toBe('allow')
  })

  it('asks for file writes by default', () => {
    const d = evaluate({ ...base, tool: 'write_file', kind: 'file-write', readOnly: false })
    expect(d.effect).toBe('ask')
  })

  it('asks for shell commands by default', () => {
    const d = evaluate({ ...base, tool: 'run_command', kind: 'shell', readOnly: false })
    expect(d.effect).toBe('ask')
  })

  it('denies writes for read-only agents', () => {
    const d = evaluate({ ...base, tool: 'edit_file', kind: 'file-write', readOnly: false, agent: perms({ readOnly: true }) })
    expect(d.effect).toBe('deny')
  })

  it('denies shell when the agent cannot run commands', () => {
    const d = evaluate({ ...base, tool: 'run_command', kind: 'shell', readOnly: false, agent: perms({ canRunShell: false }) })
    expect(d.effect).toBe('deny')
  })

  it('allows writes when the agent auto-approves edits', () => {
    const d = evaluate({ ...base, tool: 'write_file', kind: 'file-write', readOnly: false, agent: perms({ autoApproveEdits: true }) })
    expect(d.effect).toBe('allow')
  })

  it('denies telegraph spending when the agent cannot use it', () => {
    const d = evaluate({ ...base, tool: 'telegraph_ask', kind: 'usdc-spend', readOnly: false, agent: perms({ canUseTelegraph: false }), amountUsd: 0.01 })
    expect(d.effect).toBe('deny')
  })

  it('auto-allows USDC spends under the agent limit', () => {
    const d = evaluate({ ...base, tool: 'telegraph_ask', kind: 'usdc-spend', readOnly: false, agent: perms({ usdcAutoApproveUpTo: 0.05 }), amountUsd: 0.02 })
    expect(d.effect).toBe('allow')
  })

  it('asks for USDC spends above the agent limit', () => {
    const d = evaluate({ ...base, tool: 'telegraph_ask', kind: 'usdc-spend', readOnly: false, agent: perms({ usdcAutoApproveUpTo: 0.05 }), amountUsd: 0.5 })
    expect(d.effect).toBe('ask')
  })

  it('honors saved always-allow rules with a ceiling', () => {
    const rules = [{ agentId: 'a1', kind: 'usdc-spend' as const, tool: 'telegraph_ask', maxAmountUsd: 0.02, createdAt: 0 }]
    const under = evaluate({ ...base, tool: 'telegraph_ask', kind: 'usdc-spend', readOnly: false, alwaysRules: rules, amountUsd: 0.01 })
    const over = evaluate({ ...base, tool: 'telegraph_ask', kind: 'usdc-spend', readOnly: false, alwaysRules: rules, amountUsd: 0.1 })
    expect(under.effect).toBe('allow')
    expect(over.effect).toBe('ask')
  })

  it('global auto-approve-all switch allows everything', () => {
    const d = evaluate({ ...base, tool: 'write_file', kind: 'file-write', readOnly: false, autoApproveAll: true })
    expect(d.effect).toBe('allow')
  })
})

describe('isReadOnlyTool', () => {
  it('classifies the toolset', () => {
    expect(isReadOnlyTool('read_file')).toBe(true)
    expect(isReadOnlyTool('grep')).toBe(true)
    expect(isReadOnlyTool('telegraph_verify')).toBe(true)
    expect(isReadOnlyTool('write_file')).toBe(false)
    expect(isReadOnlyTool('run_command')).toBe(false)
  })
})
