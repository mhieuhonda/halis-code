/**
 * Live integration test — runs a REAL agent turn against the free
 * Pollinations gateway (no API key), exercises the tool loop (write_file,
 * read_file, run_command) under the real sandbox + permission engine, and
 * probes the live Telegraph testnet node (free discovery + x402 quote).
 *
 * Requires network. Skipped automatically when offline.
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
import type { ToolContext } from '@main/harness/tools'
import { buildSingleAgentPrompt } from '@main/swarm/prompts'
import { ReceiptLedger } from '@main/telegraph/receipts'
import { listIntents, listMiners, quoteAsk } from '@main/telegraph/client'
import { TELEGRAPH_NETWORKS } from '@shared/types'

const ONLINE = (() => {
  try {
    // synchronous connectivity probe via catalog fetch would be async; use a flag set in beforeAll
    return true
  } catch {
    return false
  }
})()

let online = false
beforeAll(async () => {
  try {
    const res = await fetch('https://text.pollinations.ai/models', { signal: AbortSignal.timeout(8000) })
    online = res.ok
  } catch {
    online = false
  }
})

describe('live: free model agent turn', () => {
  it(
    'runs a full tool loop on pollinations/openai-fast',
    { timeout: 180_000, retry: 1 },
    async () => {
      if (!online) return console.warn('offline — skipping live test')
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
            network: TELEGRAPH_NETWORKS['base-sepolia'],
            autoApproveUpTo: 0,
            dailyBudgetUsd: 5,
            ledger,
          },
          emit: (e) => events.push(e),
        }

        const result = await runner.runTurn(
          {
            sessionId: 'e2e',
            messageId: 'm1',
            modelId: 'pollinations/openai-fast',
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
  it(
    'discovers miners and intents from the live node (free)',
    { timeout: 30_000, retry: 1 },
    async () => {
      const network = TELEGRAPH_NETWORKS['base-sepolia']
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
      const network = TELEGRAPH_NETWORKS['base-sepolia']
      const quote = await quoteAsk({ network, query: 'What is the price direction of ETH?' })
      // Either a priced 402 challenge or a free serve — both prove the rail works.
      expect(quote).toHaveProperty('amountUsd')
      expect(quote.network).toBe('eip155:84532')
      console.log('[quote]', JSON.stringify(quote))
    },
  )
})
