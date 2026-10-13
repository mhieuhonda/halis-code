/**
 * todo_write — the agent's own checklist.
 * Whole-list replacement: every call replaces the entire list. The UI
 * renders the latest list as a live checklist; state also persists on the
 * session so it survives restarts.
 */
import type { TodoStatus } from '@shared/types'
import type { ToolContext, ToolDef, ToolResult } from './index'

const MAX_TODOS = 100

export const todoWriteTool: ToolDef = {
  name: 'todo_write',
  description:
    'Write your task checklist for the current session. Replaces the WHOLE list every time. Use it for multi-step work: plan the steps, mark one in_progress while you work on it, mark completed when done. Keep at most one task in_progress.',
  parameters: {
    type: 'object',
    properties: {
      todos: {
        type: 'array',
        description: 'The full checklist — this replaces the previous list',
        items: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'Imperative task description ("Fix the login redirect")' },
            status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
          },
          required: ['content', 'status'],
        },
      },
    },
    required: ['todos'],
  },
  kind: 'other',
  readOnly: true,
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const raw = Array.isArray(args.todos) ? args.todos : []
    if (!raw.length) {
      ctx.todos.replace([])
      return { output: 'Cleared the todo list.', data: { todos: [] } }
    }
    const seen = new Set<string>()
    const todos: Array<{ content: string; status: TodoStatus }> = []
    for (const entry of raw.slice(0, MAX_TODOS)) {
      const content = String((entry as { content?: unknown })?.content ?? '').trim()
      const status = String((entry as { status?: unknown })?.status ?? 'pending') as TodoStatus
      if (!content) return { output: 'Every todo needs non-empty content.' }
      if (seen.has(content)) return { output: `Duplicate todo content: "${content}". Merge or reword duplicates.` }
      if (!['pending', 'in_progress', 'completed'].includes(status)) return { output: `Invalid status "${status}" — use pending | in_progress | completed.` }
      seen.add(content)
      todos.push({ content, status })
    }
    const inProgress = todos.filter((t) => t.status === 'in_progress').length
    if (inProgress > 1) {
      return { output: `At most one task may be in_progress (got ${inProgress}). Mark the others pending or completed.` }
    }
    ctx.todos.replace(todos)
    const counts = {
      pending: todos.filter((t) => t.status === 'pending').length,
      inProgress,
      completed: todos.filter((t) => t.status === 'completed').length,
    }
    return {
      output: `Updated todo list: ${counts.pending} pending, ${counts.inProgress} in progress, ${counts.completed} completed.`,
      data: { todos, counts },
    }
  },
}

export const todoTools = [todoWriteTool]
