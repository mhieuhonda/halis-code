/**
 * Background job tools — job_list / job_output / job_kill. Shell commands
 * started with
 * run_in_background register here; the model inspects and stops them
 * through these three tools.
 */
import type { ToolContext, ToolDef, ToolResult } from './index'

export const jobListTool: ToolDef = {
  name: 'job_list',
  description: 'List your background jobs (started with run_command and run_in_background: true) with status and labels.',
  parameters: { type: 'object', properties: {} },
  kind: 'other',
  readOnly: true,
  async execute(_args, ctx: ToolContext): Promise<ToolResult> {
    const jobs = ctx.jobs.list(ctx.agentId)
    if (!jobs.length) return { output: 'No background jobs. Start one with run_command + run_in_background: true.' }
    const lines = jobs.map((j) => `${j.id} [${j.status}] ${j.label}${j.exitCode !== null ? ` (exit ${j.exitCode})` : ''} — output ${j.outputBytes} B`)
    return { output: lines.join('\n'), data: { jobs } }
  },
}

export const jobOutputTool: ToolDef = {
  name: 'job_output',
  description:
    'Read a background job\'s output. Set wait: true to block up to timeout_ms for it to finish (use instead of sleeping). Output is a tail window; very large outputs are truncated.',
  parameters: {
    type: 'object',
    properties: {
      job_id: { type: 'string', description: 'Job id from job_list or run_command' },
      wait: { type: 'boolean', description: 'Wait for completion before returning (default false)' },
      timeout_ms: { type: 'number', description: 'Wait budget in ms (default 30000, max 600000)' },
    },
    required: ['job_id'],
  },
  kind: 'other',
  readOnly: true,
  async execute(args, ctx): Promise<ToolResult> {
    const jobId = String(args.job_id ?? '')
    if (!jobId) return { output: 'job_id is required.' }
    const requested = Number(args.timeout_ms ?? 30_000)
    const result = await ctx.jobs.read(jobId, ctx.agentId, !!args.wait, requested, ctx.signal)
    if ('error' in result) return { output: result.error }
    const status = result.stillRunning ? 'still running' : `${result.job.status}${result.job.exitCode !== null ? ` (exit ${result.job.exitCode})` : ''}`
    return {
      output: `${result.job.id} [${status}]\n${result.text}${result.lossy ? '\n… (older output dropped to fit the window)' : ''}`,
      data: { job: result.job },
    }
  },
}

export const jobKillTool: ToolDef = {
  name: 'job_kill',
  description: 'Kill a running background job you started (for example a dev server you no longer need).',
  parameters: {
    type: 'object',
    properties: {
      job_id: { type: 'string', description: 'Job id' },
      reason: { type: 'string', description: 'Why you are stopping it (logged for the user)' },
    },
    required: ['job_id'],
  },
  kind: 'shell',
  readOnly: false,
  async execute(args, ctx): Promise<ToolResult> {
    const jobId = String(args.job_id ?? '')
    if (!jobId) return { output: 'job_id is required.' }
    const result = ctx.jobs.kill(jobId, ctx.agentId, args.reason ? String(args.reason) : undefined)
    return { output: result.message }
  },
}

export const jobTools = [jobListTool, jobOutputTool, jobKillTool]
