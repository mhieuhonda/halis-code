/**
 * send_message — the addressing tool. In Swarm mode every agent-to-agent
 * message goes through here with an explicit recipient, never broadcast.
 * The orchestrator parses @mentions and routes to exactly those agents.
 */
import type { ToolDef, ToolResult } from './index'

export const sendMessageTool: ToolDef = {
  name: 'send_message',
  description:
    'Send a message to specific teammates in the swarm. ALWAYS address agents explicitly with @Name. Use this to hand off work, ask a question, or report a result. The named agents will receive your message; nobody else is interrupted.',
  parameters: {
    type: 'object',
    properties: {
      to: { type: 'array', items: { type: 'string' }, description: 'Teammate names to address (e.g. ["Rin", "Bao"])' },
      message: { type: 'string', description: 'What you want to tell them. @mention them in the text too.' },
    },
    required: ['to', 'message'],
  },
  kind: 'other',
  readOnly: true,
  swarmOnly: true,
  async execute(args, ctx): Promise<ToolResult> {
    const to = Array.isArray(args.to) ? (args.to as string[]).map(String) : args.to ? [String(args.to)] : []
    const message = String(args.message ?? '').trim()
    if (!to.length || !message) return { output: 'Both "to" (teammate names) and "message" are required.' }
    if (!ctx.sendMessage) return { output: 'Messaging is only available in Swarm mode.' }
    ctx.sendMessage(to, message)
    const names = to.join(', ')
    return { output: `Delivered to ${names}. They will see your message in their next turn.` }
  },
}

export const swarmTools = [sendMessageTool]
