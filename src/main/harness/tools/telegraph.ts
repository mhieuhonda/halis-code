/**
 * Telegraph tools — how agents buy verified intelligence instead of
 * hallucinating it. Paid tools are gated by the USDC approval card (price
 * quoted from the 402 challenge before payment); discovery and verification
 * tools are free.
 */
import type { TelegraphReceipt } from '@shared/types'
import { askTelegraph, listIntents, listMiners, verifySignal } from '../../telegraph/client'
import { CODING_INTENTS } from '../../telegraph/config'
import { evaluate } from '../permissions'
import type { ToolContext, ToolDef, ToolResult } from './index'

class DeniedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DeniedError'
  }
}

function formatResult(result: unknown, depth = 0): string {
  if (result === null || result === undefined) return '(empty result)'
  if (typeof result === 'string') return result.slice(0, 4000)
  if (typeof result === 'number' || typeof result === 'boolean') return String(result)
  if (Array.isArray(result)) return result.slice(0, 50).map((r) => formatResult(r, depth + 1)).join('\n')
  if (typeof result === 'object') {
    const obj = result as Record<string, unknown>
    // Common chat-shaped results
    if (obj.content && typeof obj.content === 'string') return String(obj.content).slice(0, 4000)
    if (Array.isArray(obj.choices) && obj.choices[0]?.message?.content) {
      return String((obj.choices[0] as { message: { content: unknown } }).message.content).slice(0, 4000)
    }
    try {
      return JSON.stringify(result, null, 2).slice(0, 4000)
    } catch {
      return String(result)
    }
  }
  return String(result)
}

/** Shared runner for paid asks: quote → budget check → approval → pay → receipt. */
async function runPaidAsk(params: { query: string; minerId?: string; ctx: ToolContext; title: string }): Promise<ToolResult> {
  const { ctx } = params
  if (!ctx.telegraph.privateKey) {
    return {
      output:
        'Telegraph wallet is not configured. Ask the user to open the Telegraph tab and create (or import) a burner wallet funded with a little testnet USDC.',
    }
  }
  const { network, ledger } = ctx.telegraph

  let quotedUsd = 0
  try {
    const result = await askTelegraph({
      query: params.query,
      minerId: params.minerId,
      privateKey: ctx.telegraph.privateKey,
      network,
      onQuote: async (quote) => {
        quotedUsd = quote.amountUsd
        // Daily budget hard stop.
        const spentToday = ledger.spentTodayUsd()
        if (ctx.telegraph.dailyBudgetUsd > 0 && spentToday + quote.amountUsd > ctx.telegraph.dailyBudgetUsd) {
          throw new DeniedError(
            `Daily Telegraph budget reached ($${spentToday.toFixed(2)} of $${ctx.telegraph.dailyBudgetUsd.toFixed(2)}). Ask the user to raise the budget in Settings.`,
          )
        }
        // Permission engine with the real quoted price — saved "always"
        // rules, per-agent auto-approve limits and the global switch all
        // apply before the approval card is shown.
        const decision = evaluate({
          tool: 'telegraph_ask',
          kind: 'usdc-spend',
          readOnly: false,
          amountUsd: quote.amountUsd,
          agent: ctx.permissions,
          alwaysRules: ctx.alwaysRules,
          agentId: ctx.agentId,
          autoApproveAll: ctx.autoApproveAll,
        })
        if (decision.effect === 'deny') {
          throw new DeniedError(`Telegraph spending is not allowed for this agent: ${decision.reason}`)
        }
        if (decision.effect === 'ask') {
          const response = await requestSpendApproval(ctx, quote.amountUsd, params.query)
          if (response !== 'approved') {
            throw new DeniedError(`The user ${response === 'rejected' ? 'rejected' : 'did not approve'} this paid request ($${quote.amountUsd.toFixed(2)}). Do not retry without asking.`)
          }
        }
      },
    })

    let receipt: TelegraphReceipt | undefined
    if (result.receipt) {
      receipt = ledger.append(result.receipt, network, params.query)
      ctx.telegraph.onReceipt?.(receipt, ctx.messageId)
    } else {
      // Served without a receipt header — still record cost from the response.
      receipt = ledger.append(
        {
          receiptHash: `local_${Date.now()}`,
          rail: 'x402',
          payer: '',
          miner: result.minerName,
          intent: result.intent ?? '',
          amountUsd: result.costUsd,
          amountUusdc: String(Math.round(result.costUsd * 1e6)),
          epochId: 0,
          settlement: 'onchain',
          chain: network.caip2,
          txHash: '',
          timestamp: Math.floor(Date.now() / 1000),
        },
        network,
        params.query,
      )
      ctx.telegraph.onReceipt?.(receipt, ctx.messageId)
    }

    const header = `Telegraph answer (miner: ${result.minerName}${result.intent ? `, intent: ${result.intent}` : ''}, cost: $${result.costUsd.toFixed(2)}, ${result.durationMs}ms${receipt?.txHash ? `, tx: ${receipt.txHash.slice(0, 18)}…` : ''})`
    return {
      output: `${header}\n\n${formatResult(result.result)}`,
      data: { receipt, ask: result },
    }
  } catch (err) {
    if (err instanceof DeniedError) return { output: `Not executed: ${err.message}` }
    const message = err instanceof Error ? err.message : String(err)
    return { output: `Telegraph request failed: ${message}` }
  }
}

async function requestSpendApproval(ctx: ToolContext, amountUsd: number, query: string): Promise<'approved' | 'rejected' | 'timeout'> {
  const { id, wait } = ctx.approvals.request({
    sessionId: ctx.sessionId,
    agentId: ctx.agentId,
    agentName: ctx.agentName,
    agentColor: ctx.agentColor,
    kind: 'usdc-spend',
    title: `Buy intelligence for $${amountUsd.toFixed(2)} USDC`,
    detail: `Telegraph request: "${query.slice(0, 200)}"`,
    risk: amountUsd > 0.5 ? 'high' : amountUsd > 0.05 ? 'medium' : 'low',
    tool: 'telegraph_ask',
    amountUsd,
  })
  ctx.emit({
    type: 'tool-update',
    sessionId: ctx.sessionId,
    messageId: ctx.messageId,
    run: {
      toolCallId: `approval_${id}`,
      tool: 'telegraph_ask',
      args: { query },
      state: 'awaiting-approval',
      startedAt: Date.now(),
    },
  })
  const response = await wait
  return response === 'reject' ? 'rejected' : 'approved'
}

export const telegraphAskTool: ToolDef = {
  name: 'telegraph_ask',
  description:
    'Buy verified intelligence from the Telegraph network. The query is auto-routed to the top-ranked miner for its intent (code review, security analysis, web search, question answering, LLM inference, …) and comes back with an on-chain receipt. Use this instead of guessing when an independent, ranked answer is worth cents. Costs a small amount of USDC (typically $0.01).',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The question or task for the network, in plain language' },
    },
    required: ['query'],
  },
  kind: 'usdc-spend',
  readOnly: false,
  async execute(args, ctx): Promise<ToolResult> {
    const query = String(args.query ?? '').trim()
    if (!query) return { output: 'Provide a query.' }
    return runPaidAsk({ query, ctx, title: query })
  },
}

export const telegraphMinersTool: ToolDef = {
  name: 'telegraph_miners',
  description: 'List the miners (intelligence providers) currently registered on the Telegraph network, with their intents and floor prices. Free.',
  parameters: { type: 'object', properties: {} },
  kind: 'other',
  readOnly: true,
  async execute(_args, ctx): Promise<ToolResult> {
    try {
      const miners = await listMiners(ctx.telegraph.network)
      if (!miners.length) return { output: 'No miners registered right now.' }
      const lines = miners.slice(0, 60).map((m) => {
        const price = m.minPriceUsdc !== undefined ? `, floor $${m.minPriceUsdc.toFixed(3)}` : ''
        const intents = m.supportedIntents.slice(0, 6).join(', ')
        return `#${m.id} ${m.name}${price} — intents: ${intents}${m.supportedIntents.length > 6 ? ', …' : ''}`
      })
      return { output: lines.join('\n'), data: { miners } }
    } catch (err) {
      return { output: `Could not reach the Telegraph node: ${err instanceof Error ? err.message : err}` }
    }
  },
}

export const telegraphIntentsTool: ToolDef = {
  name: 'telegraph_intents',
  description: 'List the intents the Telegraph network can rank and route (kinds of intelligence you can buy). Free.',
  parameters: { type: 'object', properties: {} },
  kind: 'other',
  readOnly: true,
  async execute(_args, ctx): Promise<ToolResult> {
    try {
      const intents = await listIntents(ctx.telegraph.network)
      const coding = intents.filter((i) => (CODING_INTENTS as readonly string[]).includes(i.id))
      const rest = intents.filter((i) => !(CODING_INTENTS as readonly string[]).includes(i.id))
      const lines = [
        coding.length ? 'Useful for coding work:\n' + coding.map((i) => `- ${i.id}${i.label ? ` — ${i.label}` : ''}`).join('\n') : '',
        rest.length ? `\nOther intents on the network (${rest.length}): ${rest.slice(0, 40).map((i) => i.id).join(', ')}` : '',
      ]
      return { output: lines.filter(Boolean).join('\n') || 'No intents available.', data: { intents } }
    } catch (err) {
      return { output: `Could not reach the Telegraph node: ${err instanceof Error ? err.message : err}` }
    }
  },
}

export const telegraphVerifyTool: ToolDef = {
  name: 'telegraph_verify',
  description: 'Verify a previous paid answer by its signal hash — fetches the recorded signal from the Telegraph node so the result can be re-checked. Free.',
  parameters: {
    type: 'object',
    properties: {
      signal_hash: { type: 'string', description: 'The signal hash returned by a previous telegraph_ask' },
    },
    required: ['signal_hash'],
  },
  kind: 'other',
  readOnly: true,
  async execute(args, ctx): Promise<ToolResult> {
    const hash = String(args.signal_hash ?? '').trim()
    if (!hash) return { output: 'Provide a signal hash.' }
    const res = await verifySignal(ctx.telegraph.network, hash)
    return { output: res.found ? `Signal ${hash} verified on the node:\n${res.detail.slice(0, 2000)}` : `Signal ${hash} not found: ${res.detail}` }
  },
}

export const telegraphTools = [telegraphAskTool, telegraphMinersTool, telegraphIntentsTool, telegraphVerifyTool]
