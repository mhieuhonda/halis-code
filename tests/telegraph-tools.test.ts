/**
 * Telegraph tools unit tests — master switch (registry on/off) and the
 * telegraph_signals tool (ledger-backed listing + verify passthrough).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { createToolRegistry } from '@main/harness/tools/registry'
import { telegraphTools, telegraphSignalsTool, telegraphAskTool } from '@main/harness/tools/telegraph'
import type { ToolContext } from '@main/harness/tools'
import { ReceiptLedger } from '@main/telegraph/receipts'
import { TELEGRAPH_NETWORKS, type TelegraphReceipt } from '@shared/types'
import { defaultSingleAgentPermissions } from '@main/harness/approvals'

vi.mock('@main/telegraph/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/telegraph/client')>()
  return {
    ...actual,
    listMiners: vi.fn(async () => [
      { id: '1', slug: 'm-one', name: 'Miner One', supportedIntents: ['CODE_REVIEW'], minPriceUsdc: 0.01 },
    ]),
    listIntents: vi.fn(async () => [
      { id: 'CODE_REVIEW', label: 'CODE_REVIEW', minerCount: 12 },
      { id: 'WEB_SEARCH', label: 'WEB_SEARCH', minerCount: 30 },
    ]),
    askTelegraph: vi.fn(async (opts: { onQuote?: (q: { amountUsd: number; payTo: string; network: string }) => void | Promise<void> }) => {
      // Mirror the real client: the quote callback runs BEFORE payment so
      // budget/permission guards are exercised in tests.
      await opts?.onQuote?.({ amountUsd: 0.01, payTo: '0xpay', network: 'eip155:84532' })
      return {
        minerId: '1',
        minerName: 'Miner One',
        intent: 'CODE_REVIEW',
        result: { content: 'looks fine' },
        costUsd: 0.01,
        durationMs: 42,
        signalHash: 'sig-abc',
        receipt: baseReceipt(),
      }
    }),
    verifySignal: vi.fn(async (_n: unknown, hash: string) =>
      hash === 'sig-abc' ? { found: true, detail: '{"ok":true}' } : { found: false, detail: 'nope' },
    ),
  }
})

function baseReceipt(): TelegraphReceipt {
  return {
    receiptHash: 'rcp-1',
    rail: 'x402',
    payer: '0xpayer',
    miner: 'Miner One',
    intent: 'CODE_REVIEW',
    amountUsd: 0.01,
    amountUusdc: '10000',
    epochId: 1,
    settlement: 'onchain',
    chain: 'eip155:84532',
    txHash: '0xtx',
    timestamp: Math.floor(Date.now() / 1000),
    signalHash: 'sig-abc',
  }
}

function makeCtx(overrides: Partial<ToolContext['telegraph']> = {}): ToolContext {
  const dir = mkdtempSync(join(tmpdir(), 'halis-tg-'))
  return {
    sandbox: {} as ToolContext['sandbox'],
    locks: {} as ToolContext['locks'],
    taskBoard: {} as ToolContext['taskBoard'],
    approvals: { rulesFor: () => [] } as unknown as ToolContext['approvals'],
    workspace: dir,
    sessionId: 's',
    messageId: 'm',
    agentId: 'halis',
    agentName: 'Halis',
    permissions: defaultSingleAgentPermissions(),
    alwaysRules: [],
    autoApproveAll: true,
    telegraph: {
      enabled: true,
      privateKey: '0x' + '1'.repeat(64),
      network: TELEGRAPH_NETWORKS['base-sepolia']!,
      autoApproveUpTo: 5,
      dailyBudgetUsd: 5,
      ledger: new ReceiptLedger(join(dir, 'receipts.json')),
      ...overrides,
    },
    emit: () => {},
    jobs: {} as ToolContext['jobs'],
    schedules: {} as ToolContext['schedules'],
    mcp: {} as ToolContext['mcp'],
    todos: { get: () => [], replace: () => {} } as unknown as ToolContext['todos'],
    settings: {},
  } as ToolContext
}

describe('telegraph master switch', () => {
  it('registers the full telegraph toolset', () => {
    const registry = createToolRegistry()
    for (const name of ['telegraph_ask', 'telegraph_miners', 'telegraph_intents', 'telegraph_verify', 'telegraph_signals']) {
      expect(registry.get(name), name).toBeDefined()
    }
  })

  it('unregisters the whole telegraph_ namespace and restores it', () => {
    const registry = createToolRegistry()
    expect(registry.unregisterNamespace('telegraph_')).toBe(5)
    expect(registry.get('telegraph_ask')).toBeUndefined()
    expect(registry.get('telegraph_signals')).toBeUndefined()
    for (const tool of telegraphTools) registry.register(tool)
    expect(registry.get('telegraph_ask')).toBeDefined()
    expect(registry.listFor(false).some((t) => t.name === 'telegraph_signals')).toBe(true)
  })
})

describe('telegraph tools with the switch off', () => {
  it('telegraph_ask refuses to run when disabled', async () => {
    const ctx = makeCtx()
    ctx.telegraph.enabled = false
    const result = await telegraphAskTool.execute({ query: 'test' }, ctx)
    expect(result.output).toContain('disabled')
  })

  it('telegraph_signals refuses to run when disabled', async () => {
    const ctx = makeCtx()
    ctx.telegraph.enabled = false
    const result = await telegraphSignalsTool.execute({}, ctx)
    expect(result.output).toContain('disabled')
  })
})

describe('telegraph_signals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('blocks paid asks outright when the daily budget is 0', async () => {
    const ctx = makeCtx({ dailyBudgetUsd: 0 })
    const result = await telegraphAskTool.execute({ query: 'review this code' }, ctx)
    expect(result.output).toContain('Not executed')
    expect(result.output).toContain('$0')
  })

  it('blocks paid asks when the daily budget is already spent', async () => {
    const ctx = makeCtx({ dailyBudgetUsd: 0.005 })
    const result = await telegraphAskTool.execute({ query: 'review this code' }, ctx)
    expect(result.output).toContain('budget reached')
  })

  it('lists recent signals from the ledger after a paid ask', async () => {
    const ctx = makeCtx()
    const ask = await telegraphAskTool.execute({ query: 'review this code' }, ctx)
    expect(ask.output).toContain('Telegraph answer')
    // The receipt in the ledger must carry the signal hash.
    const listed = await telegraphSignalsTool.execute({}, ctx)
    expect(listed.output).toContain('sig-abc')
    expect(listed.output).toContain('CODE_REVIEW')
  })

  it('re-checks a specific signal hash against the node', async () => {
    const ctx = makeCtx()
    const ok = await telegraphSignalsTool.execute({ signal_hash: 'sig-abc' }, ctx)
    expect(ok.output).toContain('verified on the node')
    const missing = await telegraphSignalsTool.execute({ signal_hash: 'sig-nope' }, ctx)
    expect(missing.output).toContain('not found')
  })

  it('says nothing to list when the ledger is empty', async () => {
    const ctx = makeCtx()
    const result = await telegraphSignalsTool.execute({}, ctx)
    expect(result.output).toContain('No signals yet')
  })
})
