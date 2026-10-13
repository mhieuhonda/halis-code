/**
 * Live integration test — runs a REAL agent turn against the free OpenCode
 * Zen model (`ling-3.1-flash-free`, key from opencode.ai/zen), exercises the
 * tool loop (write_file, read_file, run_command) under the real sandbox +
 * permission engine, and probes the live Telegraph testnet node (free
 * discovery + x402 quote).
 *
 * Requires network + OPENCODE_API_KEY (model) / TELEGRAPH_LIVE=1 (node).
 * Skipped automatically when offline.
 */
import { describe, expect, it, beforeAll } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { HarnessEvent } from '@shared/types'
import { LlmDispatcher } from '@main/models/llm/client'
import { ModelCatalog } from '@main/models/catalog'
import { AgentRunner } from '@main/harness/loop'
import { ApprovalManager, defaultSingleAgentPermissions } from '@main/harness/approvals'
import { FileLockManager } from '@main/harness/file-locking'
import { TaskBoard } from '@main/harness/task-board'
import { createSandbox } from '@main/harness/sandbox'
import { createToolRegistry } from '@main/harness/tools/registry'
import { TodoStore, type ToolContext } from '@main/harness/tools'
import { JobRegistry } from '@main/harness/jobs'
import { ScheduleStore } from '@main/harness/schedules'
import { McpManager } from '@main/harness/mcp'
import { buildSingleAgentPrompt } from '@main/swarm/prompts'
import { ReceiptLedger } from '@main/telegraph/receipts'
import { listIntents, listMiners, quoteAsk } from '@main/telegraph/client'
import { TELEGRAPH_NETWORKS } from '@shared/types'

const LIVE_MODEL = 'opencode/ling-3.1-flash-free'
const KEY = process.env.OPENCODE_API_KEY ?? ''
const TELEGRAPH_LIVE = process.env.TELEGRAPH_LIVE === '1'

let online = false
let telegraphOnline = false
beforeAll(async () => {
  if (!KEY) return
  try {
    const res = await fetch('https://models.opencode.ai/api.json', { signal: AbortSignal.timeout(8000) })
    online = res.ok
  } catch {
    online = false
  }
})

describe('live: free model agent turn', () => {
  it(
    'runs a full tool loop on opencode/ling-3.1-flash-free',
    { timeout: 180_000, retry: 1 },
    async () => {
      if (!KEY || !online) return console.warn('no OPENCODE_API_KEY or offline — skipping live test')
      const ws = mkdtempSync(join(tmpdir(), 'halis-e2e-'))
      try {
        const catalog = new ModelCatalog()
        const dispatcher = new LlmDispatcher(() => catalog.get(), () => undefined)
        const registry = createToolRegistry()
        const approvals = new ApprovalManager()
        const locks = new FileLockManager()
        const sandbox = createSandbox(ws)
        const taskBoard = new TaskBoard(join(ws, '.halis', 'task-board.json'), locks)
        const ledger = new ReceiptLedger(join(ws, 'receipts.json'))
        const runner = new AgentRunner(dispatcher, registry)

        const events: HarnessEvent[] = []
        const toolContext: ToolContext = {
          sandbox,
          locks,
          taskBoard,
          approvals,
          workspace: ws,
          sessionId: 'e2e',
          messageId: 'm1',
          agentId: 'halis',
          agentName: 'Halis',
          permissions: defaultSingleAgentPermissions(),
          alwaysRules: [],
          autoApproveAll: true, // unattended run
          telegraph: {
            network: TELEGRAPH_NETWORKS['base-sepolia']!,
            autoApproveUpTo: 0,
            dailyBudgetUsd: 5,
            ledger,
          },
          emit: (e) => events.push(e),
          jobs: new JobRegistry(),
          schedules: new ScheduleStore(ws),
          mcp: new McpManager(),
          todos: new TodoStore('e2e', () => {}),
          settings: {},
        }

        const result = await runner.runTurn(
          {
            sessionId: 'e2e',
            messageId: 'm1',
            modelId: LIVE_MODEL,
            systemPrompt: buildSingleAgentPrompt(ws, 'en', taskBoard.renderForPrompt()),
            history: [
              {
                role: 'user',
                content:
                  'Create a file named notes.txt in the workspace containing exactly the text: Halis was here. Then read it back and tell me its contents.',
              },
            ],
            swarm: false,
            maxSteps: 8,
            toolContext,
          },
          (e) => events.push(e),
        )

        // The agent must have used tools and produced a final answer.
        expect(result.toolRuns.length).toBeGreaterThan(0)
        expect(existsSync(join(ws, 'notes.txt'))).toBe(true)
        expect(readFileSync(join(ws, 'notes.txt'), 'utf8')).toContain('Halis was here')
        expect(result.text.length).toBeGreaterThan(0)
        expect(result.error).toBeUndefined()

        // Streaming reached the UI layer.
        const deltas = events.filter((e) => e.type === 'message-delta')
        expect(deltas.length).toBeGreaterThan(0)

        // The tool runs went through the permission engine and completed.
        const toolStarts = events.filter((e) => e.type === 'tool-start')
        expect(toolStarts.length).toBeGreaterThan(0)
      } finally {
        rmSync(ws, { recursive: true, force: true })
      }
    },
  )
})

describe('live: telegraph testnet', () => {
  // Opt-in: the third-party node is flaky — an unguarded block makes plain
  // `npm test` fail red on any offline or firewalled CI runner (and hang
  // until the per-test timeout on blackholed networks).
  beforeAll(async () => {
    if (!TELEGRAPH_LIVE) return
    try {
      const network = TELEGRAPH_NETWORKS['base-sepolia']!
      // Any HTTP answer (even 404/405) proves the node is reachable — only
      // network-level failure (null) means offline.
      const res = await fetch(network.nodeUrl, { method: 'GET', signal: AbortSignal.timeout(8000) }).catch(() => null)
      telegraphOnline = res !== null
    } catch {
      telegraphOnline = false
    }
  })

  it(
    'discovers miners and intents from the live node (free)',
    { timeout: 30_000, retry: 1 },
    async () => {
      if (!TELEGRAPH_LIVE || !telegraphOnline) return console.warn('TELEGRAPH_LIVE not set or node unreachable — skipping live telegraph test')
      const network = TELEGRAPH_NETWORKS['base-sepolia']!
      const miners = await listMiners(network)
      expect(Array.isArray(miners)).toBe(true)
      if (miners.length) {
        expect(miners[0]).toHaveProperty('id')
        expect(miners[0]).toHaveProperty('name')
      }
      const intents = await listIntents(network)
      expect(Array.isArray(intents)).toBe(true)
    },
  )

  it(
    'quotes a paid ask from the 402 challenge without paying',
    { timeout: 30_000, retry: 1 },
    async () => {
      if (!TELEGRAPH_LIVE || !telegraphOnline) return console.warn('TELEGRAPH_LIVE not set or node unreachable — skipping live telegraph test')
      const network = TELEGRAPH_NETWORKS['base-sepolia']!
      const quote = await quoteAsk({ network, query: 'What is the price direction of ETH?' })
      // Either a priced 402 challenge or a free serve — both prove the rail works.
      expect(quote).toHaveProperty('amountUsd')
      expect(quote.network).toBe('eip155:84532')
      console.log('[quote]', JSON.stringify(quote))
    },
  )
})
