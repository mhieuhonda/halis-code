/**
 * The agent loop — one turn = a series of LLM steps. Each step streams a
 * response and may carry tool calls; tools run through the permission
 * engine (approval cards when needed), then their results feed the next
 * step. The turn ends when the model answers without tool calls, hits the
 * step cap, or is aborted.
 */
import type { ChatMessage, HarnessEvent, ToolRun } from '@shared/types'
import type { LlmDispatcher } from '../models/llm/client'
import type { LlmMessage, LlmResult, LlmStreamEvent, LlmToolCall } from '../models/llm/types'
import { evaluate } from './permissions'
import type { ToolContext, ToolRegistry } from './tools'

export interface TurnRequest {
  sessionId: string
  /** Streaming message identity for the UI. */
  messageId: string
  modelId: string
  apiKey?: string
  systemPrompt: string
  history: LlmMessage[]
  /** Swarm mode enables swarm-only tools. */
  swarm: boolean
  maxSteps: number
  toolContext: ToolContext
  signal?: AbortSignal
}

export interface TurnResult {
  text: string
  reasoning: string
  steps: number
  toolRuns: ToolRun[]
  aborted: boolean
  error?: string
  finishReason: LlmResult['finishReason']
}

export class AgentRunner {
  constructor(
    private readonly dispatcher: LlmDispatcher,
    private readonly registry: ToolRegistry,
  ) {}

  async runTurn(req: TurnRequest, emit: (event: HarnessEvent) => void): Promise<TurnResult> {
    const ctx = req.toolContext
    const history: LlmMessage[] = [...req.history]
    const toolRuns: ToolRun[] = []
    let steps = 0
    let text = ''
    let reasoning = ''
    let aborted = false
    let lastFinish: LlmResult['finishReason'] = 'stop'

    try {
      while (steps < req.maxSteps) {
        if (req.signal?.aborted) {
          aborted = true
          break
        }
        steps++
        const isFinalStep = steps === req.maxSteps
        const messages: LlmMessage[] = [{ role: 'system', content: req.systemPrompt }, ...history]
        if (isFinalStep && steps > 1) {
          messages.push({
            role: 'user',
            content: 'Step limit reached. Wrap up now: summarize what you did, what remains, and which files changed. Do not call any more tools.',
          })
        }

        const result = await this.dispatcher.stream(
          req.modelId,
          {
            model: req.modelId,
            messages,
            tools: isFinalStep ? undefined : this.registry.llmTools(req.swarm),
            signal: req.signal,
          },
          {
            signal: req.signal,
            onEvent: (ev: LlmStreamEvent) => {
              if (ev.type === 'text') emit({ type: 'message-delta', sessionId: req.sessionId, messageId: req.messageId, delta: ev.delta })
              else if (ev.type === 'reasoning') emit({ type: 'message-reasoning', sessionId: req.sessionId, messageId: req.messageId, delta: ev.delta })
            },
          },
          req.apiKey,
        )
        lastFinish = result.finishReason
        text = result.text
        reasoning = result.reasoning

        if (!result.toolCalls.length) break

        // Record the assistant turn with its tool calls.
        history.push({ role: 'assistant', content: result.text, toolCalls: result.toolCalls })

        for (const call of result.toolCalls) {
          const run = await this.executeToolCall(call, ctx, req, emit)
          toolRuns.push(run)
          history.push({
            role: 'tool',
            toolCallId: call.id,
            toolName: call.name,
            content: run.state === 'completed' ? String(run.result ?? '') : `ERROR: ${run.error ?? 'not executed'}`,
            isError: run.state !== 'completed',
          })
        }
      }
    } catch (err) {
      if (req.signal?.aborted || (err as Error)?.name === 'AbortError') {
        aborted = true
      } else {
        const message = err instanceof Error ? err.message : String(err)
        return { text, reasoning, steps, toolRuns, aborted, error: message, finishReason: 'error' }
      }
    }

    return { text, reasoning, steps, toolRuns, aborted, finishReason: lastFinish }
  }

  private async executeToolCall(call: LlmToolCall, ctx: ToolContext, req: TurnRequest, emit: (event: HarnessEvent) => void): Promise<ToolRun> {
    let args: Record<string, unknown> = {}
    try {
      args = JSON.parse(call.arguments || '{}') as Record<string, unknown>
    } catch {
      args = { _raw: call.arguments }
    }

    const tool = this.registry.get(call.name)
    const run: ToolRun = {
      toolCallId: call.id,
      tool: call.name,
      args,
      state: 'running',
      startedAt: Date.now(),
    }
    const emitRun = (state: ToolRun['state'], patch: Partial<ToolRun> = {}) => {
      Object.assign(run, { state }, patch)
      emit({ type: 'tool-update', sessionId: req.sessionId, messageId: req.messageId, run: { ...run } })
    }
    emit({ type: 'tool-start', sessionId: req.sessionId, messageId: req.messageId, run: { ...run } })

    if (!tool) {
      emitRun('error', { error: `Unknown tool "${call.name}". Available: ${this.registry.listFor(req.swarm).map((t) => t.name).join(', ')}`, endedAt: Date.now() })
      return run
    }

    // --- Permission engine ---
    const kind = tool.kind
    const readOnly = tool.readOnly
    const decision = evaluate({
      tool: tool.name,
      kind,
      readOnly,
      agent: ctx.permissions,
      alwaysRules: ctx.alwaysRules,
      agentId: ctx.agentId,
      autoApproveAll: ctx.autoApproveAll,
    })

    if (decision.effect === 'deny') {
      emitRun('rejected', { error: `Denied: ${decision.reason}`, endedAt: Date.now() })
      return run
    }
    // USDC spends quote their exact price during execution (from the 402
    // challenge) — the tool raises the approval card with the real number.
    const needsLoopApproval = decision.effect === 'ask' && kind !== 'usdc-spend'
    if (needsLoopApproval) {
      emitRun('awaiting-approval', {})
      const { wait } = ctx.approvals.request({
        sessionId: req.sessionId,
        agentId: ctx.agentId,
        agentName: ctx.agentName,
        agentColor: ctx.agentColor,
        kind,
        title:
          kind === 'shell'
            ? `Run command: ${String(args.command ?? '').slice(0, 80)}`
            : kind === 'file-write'
              ? `${call.name === 'write_file' ? 'Write' : 'Edit'} file: ${String(args.path ?? '')}`
              : `Allow ${tool.name}?`,
        detail:
          kind === 'shell'
            ? String(args.command ?? '')
            : kind === 'file-write'
              ? `Target: ${String(args.path ?? '')}`
              : 'This action requires your approval.',
        risk: kind === 'shell' ? 'medium' : kind === 'file-write' ? 'medium' : 'low',
        tool: tool.name,
      })
      const response = await Promise.race([
        wait,
        req.signal
          ? new Promise<null>((resolve) => {
              req.signal!.addEventListener('abort', () => resolve(null), { once: true })
            })
          : new Promise<null>(() => {}),
      ])
      if (response === null) {
        emitRun('rejected', { error: 'Turn aborted', endedAt: Date.now() })
        return run
      }
      if (response === 'reject') {
        emitRun('rejected', { error: 'You rejected this action.', endedAt: Date.now() })
        return run
      }
      run.approval = { approvedBy: response === 'always' ? 'always' : 'user', at: Date.now() }
    }

    // --- Execute ---
    try {
      const result = await tool.execute(args, ctx)
      emitRun('completed', { result: result.output, endedAt: Date.now() })
    } catch (err) {
      emitRun('error', { error: err instanceof Error ? err.message : String(err), endedAt: Date.now() })
    }
    return run
  }
}
