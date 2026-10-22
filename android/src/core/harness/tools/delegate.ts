/**
 * delegate_task — spawn a fresh sub-agent for a self-contained task
 * (depth-limited to 1 in Halis Code). The sub-agent runs its own loop with the same tools minus
 * delegation itself; its final message is the tool result. The parent
 * should include everything the child needs in the prompt.
 */
import type { ToolContext, ToolDef, ToolResult } from './index'

export const delegateTaskTool: ToolDef = {
  name: 'delegate_task',
  description:
    'Delegate a self-contained sub-task to a fresh agent and get its final report. Include EVERYTHING it needs in the prompt (context, file paths, constraints) — the child starts with no memory of this conversation. Use for focused research, bulk refactors, or independent verification. The child shares this workspace but you keep coordinating: check the task board and file locks it leaves behind.',
  parameters: {
    type: 'object',
    properties: {
      description: { type: 'string', description: '3-6 word label for the task, shown to the user' },
      prompt: { type: 'string', description: 'The complete task brief: goal, relevant files, constraints, and what "done" looks like' },
    },
    required: ['description', 'prompt'],
  },
  kind: 'other',
  readOnly: false,
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const description = String(args.description ?? '').trim()
    const prompt = String(args.prompt ?? '').trim()
    if (!description || !prompt) return { output: 'Both description and prompt are required.' }
    if ((ctx.delegationDepth ?? 0) >= 1 || !ctx.delegate) {
      return { output: 'Delegation is not available here (depth limit). Do the work directly.' }
    }
    ctx.emit({ type: 'typing', sessionId: ctx.sessionId, agentId: `sub:${ctx.agentId}`, agentName: `${ctx.agentName} → sub-agent`, isTyping: true })
    try {
      const result = await ctx.delegate({ description, prompt })
      if (result.error) return { output: `Sub-agent failed: ${result.error}. Handle the task directly or retry with a narrower brief.` }
      return {
        output: `Sub-agent "${description}" finished. Its report:\n\n${result.output}`,
        data: { delegated: true, description },
      }
    } finally {
      ctx.emit({ type: 'typing', sessionId: ctx.sessionId, agentId: `sub:${ctx.agentId}`, agentName: `${ctx.agentName} → sub-agent`, isTyping: false })
    }
  },
}

export const delegateTools = [delegateTaskTool]
