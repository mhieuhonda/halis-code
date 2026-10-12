/**
 * Tool registry — the agent's hands. Every tool declares its approval kind
 * and whether it is read-only; the loop runs the permission engine before
 * executing anything.
 */
import type { AgentPermissions, AlwaysAllowRule, ApprovalKind, HarnessEvent, QuestionAnswer, TelegraphNetworkConfig, TelegraphReceipt } from '@shared/types'
import type { Sandbox } from '../sandbox'
import type { FileLockManager } from '../file-locking'
import type { TaskBoard } from '../task-board'
import type { ApprovalManager } from '../approvals'
import type { JobRegistry } from '../jobs'
import type { ScheduleStore } from '../schedules'
import type { McpManager } from '../mcp'
import type { ReceiptLedger } from '../../telegraph/receipts'

export interface ToolResult {
  /** Model-facing output. Keep tight; big payloads get truncated. */
  output: string
  /** Structured payload for the UI (diffs, receipts, task ids...). */
  data?: unknown
}

export interface ToolContext {
  sandbox: Sandbox
  locks: FileLockManager
  taskBoard: TaskBoard
  approvals: ApprovalManager
  workspace: string
  sessionId: string
  messageId: string
  agentId: string
  agentName: string
  agentColor?: string
  permissions: AgentPermissions
  alwaysRules: AlwaysAllowRule[]
  autoApproveAll: boolean
  telegraph: {
    /** Master switch from Settings — false hides every Telegraph tool. */
    enabled?: boolean
    privateKey?: string
    network: TelegraphNetworkConfig
    autoApproveUpTo: number
    dailyBudgetUsd: number
    ledger: ReceiptLedger
    onReceipt?: (receipt: TelegraphReceipt, messageId: string) => void
  }
  emit: (event: HarnessEvent) => void
  /** Swarm mode: relay a message from this agent to another agent. */
  sendMessage?: (to: string[], content: string) => void
  /* --- extended harness surfaces (opencode/deepseek-style) --- */
  /** Background job registry (bash run_in_background + job_* tools). */
  jobs: JobRegistry
  /** Reminder store (schedule_* tools). */
  schedules: ScheduleStore
  /** MCP client manager (mcp_* tools). */
  mcp: McpManager
  /** Session-scoped todo list; whole-list replacement semantics. */
  todos: TodoStore
  /** ask_user: raise a question card and wait for the user's answers. */
  askUser?: (questions: unknown[]) => Promise<QuestionAnswer[] | null>
  /** Per-turn settings snapshot (tavily key etc.). */
  settings: { tavilyApiKey?: string }
  /** Turn abort signal — tools check it for long waits. */
  signal?: AbortSignal
  /**
   * The id of the tool call currently executing (set by the agent loop).
   * Tools that raise their own cards (ask_user, telegraph_ask) emit
   * tool-updates under this id so the renderer keys them to the real part.
   */
  toolCallId?: string
  /** Sub-agent depth for delegate_task (0 = top level, no nested delegation beyond 1). */
  delegationDepth?: number
  /** Run a nested agent turn for delegate_task; undefined in nested turns. */
  delegate?: (input: { description: string; prompt: string }) => Promise<{ output: string; error?: string }>
}

/** Session-scoped todo list with whole-list replacement (deepseek-harness style). */
export class TodoStore {
  private todos: Array<{ content: string; status: 'pending' | 'in_progress' | 'completed' }> = []
  constructor(
    private readonly sessionId: string,
    private readonly emit: (event: HarnessEvent) => void,
    initial?: Array<{ content: string; status: 'pending' | 'in_progress' | 'completed' }>,
  ) {
    if (initial) this.todos = [...initial]
  }
  get(): Array<{ content: string; status: 'pending' | 'in_progress' | 'completed' }> {
    return [...this.todos]
  }
  replace(todos: Array<{ content: string; status: 'pending' | 'in_progress' | 'completed' }>): void {
    this.todos = [...todos]
    this.emit({ type: 'todo-changed', sessionId: this.sessionId, todos: [...todos] })
  }
}

export interface ToolDef {
  name: string
  description: string
  parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[] }
  kind: ApprovalKind
  readOnly: boolean
  /** Hide from the single-agent mode. */
  swarmOnly?: boolean
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>
}

export class ToolRegistry {
  private tools = new Map<string, ToolDef>()

  register(tool: ToolDef): void {
    this.tools.set(tool.name, tool)
  }

  unregister(name: string): boolean {
    return this.tools.delete(name)
  }

  unregisterNamespace(prefix: string): number {
    let removed = 0
    for (const name of [...this.tools.keys()]) {
      if (name.startsWith(prefix)) {
        this.tools.delete(name)
        removed++
      }
    }
    return removed
  }

  get(name: string): ToolDef | undefined {
    return this.tools.get(name)
  }

  listFor(swarm: boolean): ToolDef[] {
    return [...this.tools.values()].filter((t) => swarm || !t.swarmOnly)
  }

  /** OpenAI-style tool definitions for the LLM. */
  llmTools(swarm: boolean): Array<{ name: string; description: string; parameters: Record<string, unknown> }> {
    return this.listFor(swarm).map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }))
  }
}

export type { ToolRun } from '@shared/types'
