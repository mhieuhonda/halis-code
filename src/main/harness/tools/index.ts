/**
 * Tool registry — the agent's hands. Every tool declares its approval kind
 * and whether it is read-only; the loop runs the permission engine before
 * executing anything.
 */
import type { AgentPermissions, AlwaysAllowRule, ApprovalKind, HarnessEvent, TelegraphNetworkConfig, TelegraphReceipt } from '@shared/types'
import type { Sandbox } from '../sandbox'
import type { FileLockManager } from '../file-locking'
import type { TaskBoard } from '../task-board'
import type { ApprovalManager } from '../approvals'
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
