/**
 * Reminder tools — schedule_create / schedule_list / schedule_delete. A
 * schedule delivers a
 * prompt back into the session later (once or recurring). Exactly one
 * selector is allowed per call.
 */
import type { ToolContext, ToolDef, ToolResult } from './index'
import { buildSelector, describeSelector } from '@core/schedules'

export const scheduleCreateTool: ToolDef = {
  name: 'schedule_create',
  description:
    'Schedule a reminder prompt to be delivered back into this session later — "remind me to check the build in 10 minutes", "every morning summarize new issues". Exactly ONE selector: after_seconds | at (ISO) | every_seconds (>=60) | daily {time "HH:MM"} | weekly {time, weekdays 1=Mon..7=Sun} | cron {expression, 5 fields}.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Short label (max 120 chars), e.g. "Check CI status"' },
      prompt: { type: 'string', description: 'What to tell the agent when it fires — a full instruction' },
      after_seconds: { type: 'number', description: 'Fire once, N seconds from now' },
      at: { type: 'string', description: 'Fire once, at an ISO 8601 datetime' },
      every_seconds: { type: 'number', description: 'Recur every N seconds (min 60)' },
      daily: {
        type: 'object',
        properties: {
          time: { type: 'string', description: '"HH:MM" local time' },
        },
        required: ['time'],
        description: 'Recur daily',
      },
      weekly: {
        type: 'object',
        properties: {
          time: { type: 'string', description: '"HH:MM" local time' },
          weekdays: { type: 'array', items: { type: 'number' }, description: '1=Mon..7=Sun' },
        },
        required: ['time', 'weekdays'],
        description: 'Recur weekly',
      },
      cron: { type: 'string', description: 'Recur on a 5-field cron expression (minute hour dom month dow)' },
    },
    required: ['title', 'prompt'],
  },
  kind: 'other',
  readOnly: false,
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const selector = buildSelector(args)
    if ('error' in selector) return { output: selector.error }
    const result = await ctx.schedules.create({
      sessionId: ctx.sessionId,
      title: String(args.title ?? ''),
      prompt: String(args.prompt ?? ''),
      selector: selector.selector,
      createdBy: ctx.agentId,
    })
    if ('error' in result) return { output: result.error }
    const when = new Date(result.schedule.nextFireAt).toISOString()
    return {
      output: `Reminder "${result.schedule.title}" scheduled (${describeSelector(selector.selector)}). First fire: ${when}. I will receive the prompt automatically.`,
      data: { schedule: result.schedule },
    }
  },
}

export const scheduleListTool: ToolDef = {
  name: 'schedule_list',
  description: 'List reminders scheduled for this session with their next fire time.',
  parameters: { type: 'object', properties: {} },
  kind: 'other',
  readOnly: true,
  async execute(_args, ctx): Promise<ToolResult> {
    const schedules = ctx.schedules.forSession(ctx.sessionId)
    if (!schedules.length) return { output: 'No reminders scheduled for this session.' }
    const lines = schedules.map((s) => `${s.id.slice(-6)} "${s.title}" — ${describeSelector(s.selector)} — next: ${new Date(s.nextFireAt).toISOString()} (fired ${s.fireCount}x)`)
    return { output: lines.join('\n'), data: { schedules } }
  },
}

export const scheduleDeleteTool: ToolDef = {
  name: 'schedule_delete',
  description: 'Delete a reminder by id (get ids from schedule_list).',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Reminder id (the full id or the last 6 chars)' },
    },
    required: ['id'],
  },
  kind: 'other',
  readOnly: false,
  async execute(args, ctx): Promise<ToolResult> {
    const id = String(args.id ?? '').trim()
    if (!id) return { output: 'id is required — get reminder ids from schedule_list.' }
    const schedules = ctx.schedules.forSession(ctx.sessionId)
    const exact = schedules.filter((s) => s.id === id)
    if (exact.length === 1) {
      const result = await ctx.schedules.remove(exact[0]!.id)
      return { output: result.message }
    }
    const matches = schedules.filter((s) => s.id.endsWith(id))
    if (!matches.length) return { output: `No reminder matching "${id}" in this session.` }
    if (matches.length > 1) {
      // A 1-2 char suffix matches several ids — the old `find` deleted the
      // first one without warning. Demand a longer suffix instead.
      return { output: `"${id}" matches ${matches.length} reminders (${matches.map((s) => s.id.slice(-6)).join(', ')}). Send more characters of the id.` }
    }
    const result = await ctx.schedules.remove(matches[0]!.id)
    return { output: result.message }
  },
}

export const scheduleTools = [scheduleCreateTool, scheduleListTool, scheduleDeleteTool]
