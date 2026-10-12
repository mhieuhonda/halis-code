/**
 * LIVE swarm test — two agents run a real collaborative turn through the
 * SwarmOrchestrator: the coder writes a file, then addresses the reviewer.
 * Exercises @mention routing, the context filter, tool approvals and the
 * task flow.
 *
 * Uses the keyless Pollinations gateway by default (no key, no setup).
 * Set OPENROUTER_TEST_KEY to run the same turn on free OpenRouter models.
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { HarnessEvent, Session, SwarmConfig } from '@shared/types'
import { LlmDispatcher } from '@main/models/llm/client'
import { ModelCatalog } from '@main/models/catalog'
import { ApprovalManager, defaultSingleAgentPermissions } from '@main/harness/approvals'
import { FileLockManager } from '@main/harness/file-locking'
import { TaskBoard } from '@main/harness/task-board'
import { createSandbox } from '@main/harness/sandbox'
import { createToolRegistry } from '@main/harness/tools/registry'
import { TodoStore } from '@main/harness/tools'
import { JobRegistry } from '@main/harness/jobs'
import { ScheduleStore } from '@main/harness/schedules'
import { McpManager } from '@main/harness/mcp'
import { SwarmOrchestrator } from '@main/swarm/orchestrator'
import { extractMentions, resolveMentions } from '@main/swarm/router'
import { ReceiptLedger } from '@main/telegraph/receipts'
import { TELEGRAPH_NETWORKS } from '@shared/types'

const KEY = process.env.OPENROUTER_TEST_KEY ?? ''
const CODER_MODEL = KEY ? 'openrouter/cohere/north-mini-code:free' : 'pollinations/openai-fast'
const REVIEWER_MODEL = KEY ? 'openrouter/cohere/north-mini-code:free' : 'pollinations/openai-fast'

function agent(id: string, name: string, roleId: string, modelId: string): import('@shared/types').AgentConfig {
  return {
    id,
    name,
    avatar: '🤖',
    color: '#45C4FF',
    roleId,
    modelId,
    apiKey: KEY || undefined,
    permissions: { ...defaultSingleAgentPermissions(), autoApproveEdits: true },
    enabled: true,
  }
}

describe('live: swarm turn on free models', () => {
  it(
    'planner + coder + reviewer finish a small file task',
    { timeout: 300_000, retry: 1 },
    async () => {
      const ws = mkdtempSync(join(tmpdir(), 'halis-swarm-'))
      try {
        const catalog = new ModelCatalog()
        // Live model ids (openrouter free routes) come from the models.dev refresh.
        await catalog.refresh()
        const dispatcher = new LlmDispatcher(() => catalog.get(), () => undefined)
        const registry = createToolRegistry()
        const approvals = new ApprovalManager()
        const locks = new FileLockManager()
        const sandbox = createSandbox(ws)
        const taskBoard = new TaskBoard(join(ws, '.halis', 'task-board.json'), locks)
        const ledger = new ReceiptLedger(join(ws, 'receipts.json'))
        const jobs = new JobRegistry()
        const schedules = new ScheduleStore(ws)
        const mcp = new McpManager()

        const config: SwarmConfig = {
          maxRounds: 2,
          plannerCoordination: true,
          agents: [agent('a1', 'Nova', 'coder', CODER_MODEL), agent('a2', 'Vega', 'reviewer', REVIEWER_MODEL)],
        }

        const session: Session = {
          id: 'swarm-e2e',
          title: 'Swarm smoke test',
          mode: 'swarm',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messageCount: 0,
          messages: [],
        }
        const userText =
          '@Nova create a file named greeting.txt in the workspace root containing exactly this one line: hello from the swarm. Do not create anything else. After writing it, tell @Vega to review greeting.txt.'
        // Mirror app-runtime.send(): parse @mentions and route explicitly.
        const mentions = extractMentions(userText)
        const { resolved } = resolveMentions(mentions, config.agents)
        session.messages.push({
          id: 'u1',
          sessionId: session.id,
          mode: 'swarm',
          from: 'user',
          fromName: 'You',
          to: resolved,
          mentions,
          role: 'user',
          content: userText,
          createdAt: Date.now(),
        })

        const events: HarnessEvent[] = []
        const todos = new TodoStore(session.id, () => {})
        const orchestrator = new SwarmOrchestrator({
          dispatcher,
          registry,
          approvals,
          locks,
          taskBoard,
          sandbox,
          jobs,
          schedules,
          mcp,
          todoFor: () => todos,
          saveTodos: () => {},
          askUser: async () => null,
          getSettings: () => ({
            workspace: ws,
            language: 'en',
            autoApproveAll: true, // unattended run
            telegraph: { networkId: 'base-sepolia', autoApproveUpTo: 0, dailyBudgetUsd: 5 },
            telegraphEnabled: false, // no spending in this test
            tavilyApiKey: undefined,
          }),
          telegraph: {
            enabled: false,
            network: TELEGRAPH_NETWORKS['base-sepolia']!,
            autoApproveUpTo: 0,
            dailyBudgetUsd: 5,
            ledger,
          },
          emit: (e) => events.push(e),
          persistSession: () => {},
        })

        await orchestrator.runTurn({ session, config, objective: session.title, signal: new AbortController().signal })

        // The file was written by the coder agent.
        expect(existsSync(join(ws, 'greeting.txt'))).toBe(true)
        expect(readFileSync(join(ws, 'greeting.txt'), 'utf8')).toContain('hello from the swarm')

        // Agent messages landed in the session with correct attribution.
        const agentMessages = session.messages.filter((m) => m.from !== 'user' && m.from !== 'system')
        expect(agentMessages.length).toBeGreaterThan(0)
        expect(agentMessages.some((m) => m.fromName === 'Nova' || m.fromName === 'Vega')).toBe(true)

        // At least one tool ran through the harness.
        const toolStarts = events.filter((e) => e.type === 'tool-start')
        expect(toolStarts.length).toBeGreaterThan(0)
      } finally {
        rmSync(ws, { recursive: true, force: true })
      }
    },
  )
})
