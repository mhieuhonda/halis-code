/**
 * Approval manager: turns "ask" permission decisions into approval cards in
 * the UI and parks the tool call until the user answers. "Always" choices
 * are remembered per agent + kind (optionally with a USD ceiling).
 */
import type { AlwaysAllowRule, ApprovalKind, ApprovalRequest } from '@shared/types'
import { newId } from '../util/id'

type Resolver = (response: 'allow' | 'always' | 'reject') => void

export interface ApprovalHooks {
  onRequest: (request: ApprovalRequest) => void
  onResolved: (requestId: string, approved: boolean) => void
  onRulesChanged: (rules: AlwaysAllowRule[]) => void
}

export class ApprovalManager {
  private pending = new Map<string, { request: ApprovalRequest; resolve: Resolver }>()
  private rules: AlwaysAllowRule[] = []
  private hooks: ApprovalHooks | null = null

  setHooks(hooks: ApprovalHooks): void {
    this.hooks = hooks
  }

  getRules(): AlwaysAllowRule[] {
    return this.rules
  }

  setRules(rules: AlwaysAllowRule[]): void {
    this.rules = rules
    this.hooks?.onRulesChanged(this.rules)
  }

  pendingRequests(): ApprovalRequest[] {
    return [...this.pending.values()].map((p) => p.request)
  }

  request(input: {
    sessionId: string
    agentId: string
    agentName: string
    agentColor?: string
    kind: ApprovalKind
    title: string
    detail: string
    risk: 'low' | 'medium' | 'high'
    tool: string
    amountUsd?: number
  }): { id: string; wait: Promise<'allow' | 'always' | 'reject'> } {
    const id = newId('apr')
    const request: ApprovalRequest = { id, createdAt: Date.now(), ...input }
    const wait = new Promise<'allow' | 'always' | 'reject'>((resolve) => {
      this.pending.set(id, { request, resolve })
    })
    this.hooks?.onRequest(request)
    return { id, wait }
  }

  respond(requestId: string, response: 'allow' | 'always' | 'reject'): boolean {
    const entry = this.pending.get(requestId)
    if (!entry) return false
    this.pending.delete(requestId)
    if (response === 'always') {
      const rule: AlwaysAllowRule = {
        agentId: entry.request.agentId,
        kind: entry.request.kind,
        tool: entry.request.tool,
        maxAmountUsd: entry.request.kind === 'usdc-spend' ? Math.max(entry.request.amountUsd ?? 0.01, 0.01) : undefined,
        createdAt: Date.now(),
      }
      this.rules.push(rule)
      this.hooks?.onRulesChanged(this.rules)
    }
    entry.resolve(response)
    this.hooks?.onResolved(requestId, response !== 'reject')
    return true
  }

  /** Reject everything still parked — used when a turn is aborted. */
  rejectAll(): void {
    for (const [, entry] of this.pending) {
      entry.resolve('reject')
      this.hooks?.onResolved(entry.request.id, false)
    }
    this.pending.clear()
  }

  rulesFor(agentId: string): AlwaysAllowRule[] {
    return this.rules.filter((r) => r.agentId === agentId)
  }
}

/** Default permission set used by the single Agent mode. */
export function defaultSingleAgentPermissions(): import('@shared/types').AgentPermissions {
  return {
    readOnly: false,
    autoApproveEdits: false,
    canRunShell: true,
    autoApproveShell: false,
    canUseTelegraph: true,
    usdcAutoApproveUpTo: 0,
  }
}
