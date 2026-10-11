/**
 * Task-board tools: the Shared Task Board every agent works from. Claims
 * are atomic; the board file itself is hard-locked during each transaction.
 */
import type { ToolContext, ToolDef, ToolResult } from './index'

export const taskBoardListTool: ToolDef = {
  name: 'task_board_list',
  description: 'List every task on the shared task board with status and assignee. Check this before picking up work.',
  parameters: { type: 'object', properties: {} },
  kind: 'other',
  readOnly: true,
  async execute(_args, ctx: ToolContext): Promise<ToolResult> {
    const tasks = ctx.taskBoard.all()
    if (!tasks.length) return { output: 'Task board is empty. Create tasks with task_board_create if useful.' }
    const lines = tasks.map((t) => `[${t.status}] #${t.id.slice(-6)} ${t.title}${t.assigneeName ? ` — ${t.assigneeName}` : ' — unassigned'}${t.blockedReason ? ` (blocked: ${t.blockedReason})` : ''}`)
    return { output: lines.join('\n'), data: { tasks } }
  },
}

export const taskBoardCreateTool: ToolDef = {
  name: 'task_board_create',
  description: 'Create a task on the shared task board. Describe the outcome, not the steps.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Short task title' },
      description: { type: 'string', description: 'What "done" means for this task' },
    },
    required: ['title'],
  },
  kind: 'other',
  readOnly: false,
  async execute(args, ctx): Promise<ToolResult> {
    const title = String(args.title ?? '').trim()
    if (!title) return { output: 'A task needs a title.' }
    const task = ctx.taskBoard.create(title, args.description ? String(args.description) : undefined, ctx.agentId, ctx.agentId, ctx.agentName)
    return { output: `Created task #${task.id.slice(-6)}: ${task.title}`, data: { task } }
  },
}

export const taskBoardClaimTool: ToolDef = {
  name: 'task_board_claim',
  description: 'Claim a task for yourself before starting it. Fails if another agent already claimed it.',
  parameters: {
    type: 'object',
    properties: {
      task: { type: 'string', description: 'Task id suffix (e.g. 4f2a1b) or exact title' },
    },
    required: ['task'],
  },
  kind: 'other',
  readOnly: false,
  async execute(args, ctx): Promise<ToolResult> {
    try {
      const task = ctx.taskBoard.claim(String(args.task ?? ''), ctx.agentId, ctx.agentName)
      return { output: `Claimed "${task.title}". It is now in_progress and yours.`, data: { task } }
    } catch (err) {
      return { output: err instanceof Error ? err.message : String(err) }
    }
  },
}

export const taskBoardUpdateTool: ToolDef = {
  name: 'task_board_update',
  description: 'Update a task: set status (todo|in_progress|blocked|done) or a blocked reason.',
  parameters: {
    type: 'object',
    properties: {
      task: { type: 'string', description: 'Task id suffix or exact title' },
      status: { type: 'string', description: 'New status: todo | in_progress | blocked | done' },
      blocked_reason: { type: 'string', description: 'Why the task is blocked' },
    },
    required: ['task'],
  },
  kind: 'other',
  readOnly: false,
  async execute(args, ctx): Promise<ToolResult> {
    const status = args.status ? String(args.status) : undefined
    if (status && !['todo', 'in_progress', 'blocked', 'done'].includes(status)) {
      return { output: `Invalid status "${status}". Use todo | in_progress | blocked | done.` }
    }
    try {
      const task = ctx.taskBoard.update(
        String(args.task ?? ''),
        { status: status as 'todo' | 'in_progress' | 'blocked' | 'done' | undefined, blockedReason: args.blocked_reason ? String(args.blocked_reason) : undefined },
        ctx.agentId,
        ctx.agentName,
      )
      return { output: `Updated "${task.title}" → ${task.status}.`, data: { task } }
    } catch (err) {
      return { output: err instanceof Error ? err.message : String(err) }
    }
  },
}

export const taskBoardTools = [taskBoardListTool, taskBoardCreateTool, taskBoardClaimTool, taskBoardUpdateTool]
