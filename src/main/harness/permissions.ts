/**
 * Permission model — inspired by opencode's rule engine, specialized for
 * what the user asked for:
 *  - read-only tools run automatically;
 *  - state-changing tools require an approval card;
 *  - USDC-spending tools always require an approval card unless the user
 *    chose "always accept" up to a limit;
 *  - per-agent permission switches can tighten or loosen all of this.
 */
import type { AgentPermissions, AlwaysAllowRule, ApprovalKind } from '@shared/types'

export type PermissionEffect = 'allow' | 'ask' | 'deny'

export interface PermissionContext {
  tool: string
  kind: ApprovalKind
  /** True when the tool only reads state. */
  readOnly: boolean
  /** USD cost when the tool spends money. */
  amountUsd?: number
  agent: AgentPermissions
  /** Saved "always allow" rules (session + persistent). */
  alwaysRules: AlwaysAllowRule[]
  agentId: string
  /** Global demo switch from settings. */
  autoApproveAll: boolean
}

export interface PermissionDecision {
  effect: PermissionEffect
  reason: string
}

const READ_ONLY_TOOLS = new Set([
  'read_file',
  'list_dir',
  'glob',
  'grep',
  'task_board_list',
  'task_board_read',
  'telegraph_miners',
  'telegraph_intents',
  'telegraph_verify',
  'telegraph_signals',
  'send_message',
  'finish',
  /* opencode / deepseek-harness ported tools */
  'web_fetch',
  'web_search',
  'todo_write',
  'job_list',
  'job_output',
  'schedule_list',
  'git_status',
  'git_diff',
  'git_log',
  'delegate_task',
  'skill',
])

const STATE_TOOLS = new Set([
  'write_file',
  'edit_file',
  'multi_edit',
  'delete_file',
  'apply_patch',
  'run_command',
  'task_board_create',
  'task_board_claim',
  'task_board_update',
  'schedule_create',
  'schedule_delete',
  'git_commit',
])

export function isReadOnlyTool(tool: string): boolean {
  return READ_ONLY_TOOLS.has(tool)
}

export function evaluate(ctx: PermissionContext): PermissionDecision {
  const { agent, kind, tool, amountUsd, alwaysRules, agentId, autoApproveAll } = ctx

  // 1. Denies first — agent configuration wins over convenience.
  if (agent.readOnly && (STATE_TOOLS.has(tool) || kind === 'shell' || kind === 'file-write')) {
    return { effect: 'deny', reason: 'This agent is configured read-only and cannot modify state.' }
  }
  if (kind === 'shell' && !agent.canRunShell) {
    return { effect: 'deny', reason: 'This agent is not allowed to run terminal commands.' }
  }
  if (kind === 'usdc-spend' && !agent.canUseTelegraph) {
    return { effect: 'deny', reason: 'This agent is not allowed to use Telegraph (paid intelligence).' }
  }
  if (kind === 'question') {
    return { effect: 'allow', reason: 'Asking the user is always allowed.' }
  }

  // 2. Read-only tools run automatically. The declared readOnly flag is the
  //    source of truth for built-in tools (the old hardcoded allowlist kept
  //    drifting out of sync — read_image kept popping approval cards); MCP
  //    tools declaring readOnlyHint are trusted the same way, while their
  //    mutation siblings stay on ask.
  if (ctx.readOnly) {
    return { effect: 'allow', reason: 'Read-only tool.' }
  }

  // 3. Global demo switch.
  if (autoApproveAll) {
    return { effect: 'allow', reason: 'Auto-approve is enabled in settings.' }
  }

  // 4. Saved "always" rules for this agent + kind.
  const matched = alwaysRules.filter((r) => r.agentId === agentId && r.kind === kind && (!r.tool || r.tool === tool))
  if (matched.length) {
    if (kind === 'usdc-spend') {
      const ok = matched.some((r) => (r.maxAmountUsd ?? 0) >= (amountUsd ?? Infinity))
      if (ok) return { effect: 'allow', reason: `Always-accept is active up to $${matched.find((r) => (r.maxAmountUsd ?? 0) >= (amountUsd ?? Infinity))!.maxAmountUsd?.toFixed(2)}.` }
    } else {
      return { effect: 'allow', reason: 'You chose "Always allow" for this kind of action.' }
    }
  }

  // 5. Per-agent auto-approvals.
  if (kind === 'file-write' && agent.autoApproveEdits) {
    return { effect: 'allow', reason: 'This agent auto-approves file edits.' }
  }
  if (kind === 'shell' && agent.autoApproveShell) {
    return { effect: 'allow', reason: 'This agent auto-approves commands.' }
  }
  if (kind === 'usdc-spend' && (amountUsd ?? 0) > 0 && amountUsd! <= agent.usdcAutoApproveUpTo && agent.usdcAutoApproveUpTo > 0) {
    return { effect: 'allow', reason: `Below this agent's auto-approve limit ($${agent.usdcAutoApproveUpTo.toFixed(2)}).` }
  }

  // 6. Default: ask.
  return { effect: 'ask', reason: 'This action changes state or spends money.' }
}
