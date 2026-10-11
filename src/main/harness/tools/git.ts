/**
 * Git tools — read-only status/diff/log plus an approved commit, all run
 * with `git -C <workspace>` and capped output. Committing goes through the
 * shell approval flow so the user sees exactly what will happen.
 */
import { execFile } from 'node:child_process'
import type { ToolContext, ToolDef, ToolResult } from './index'

const GIT_CAP = 60_000

function git(ctx: ToolContext, args: string[], timeoutMs = 20_000): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-C', ctx.sandbox.workspace, '-c', 'core.pager=cat', ...args],
      { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true, env: { ...process.env, GIT_PAGER: 'cat', PAGER: 'cat' } },
      (err, stdout, stderr) => {
        resolve({ ok: !err, stdout: stdout || '', stderr: (stderr || (err ? err.message : '')) || '' })
      },
    )
  })
}

function clip(s: string): string {
  return s.length > GIT_CAP ? `${s.slice(0, GIT_CAP)}\n… (output truncated)` : s
}

export const gitStatusTool: ToolDef = {
  name: 'git_status',
  description: 'Show the workspace git status: current branch, staged/unstaged/untracked files, ahead/behind counts.',
  parameters: { type: 'object', properties: {} },
  kind: 'other',
  readOnly: true,
  async execute(_args, ctx): Promise<ToolResult> {
    const status = await git(ctx, ['status', '--porcelain=v1', '-b'])
    if (!status.ok) return { output: `Not a git repository (or git failed): ${status.stderr.trim().slice(0, 200)}` }
    return { output: clip(status.stdout.trim() || '(clean working tree)') }
  },
}

export const gitDiffTool: ToolDef = {
  name: 'git_diff',
  description: 'Show a git diff of working-tree changes. Set staged: true for staged changes; optionally limit to specific paths.',
  parameters: {
    type: 'object',
    properties: {
      staged: { type: 'boolean', description: 'Diff staged changes instead of unstaged' },
      paths: { type: 'array', items: { type: 'string' }, description: 'Limit the diff to these paths' },
      stat: { type: 'boolean', description: 'Only show the stat summary' },
    },
  },
  kind: 'other',
  readOnly: true,
  async execute(args, ctx): Promise<ToolResult> {
    const diffArgs = ['diff', '--no-color']
    if (args.stat) diffArgs.push('--stat')
    if (args.staged) diffArgs.push('--cached')
    for (const p of Array.isArray(args.paths) ? args.paths.map(String) : []) diffArgs.push(p)
    const result = await git(ctx, diffArgs)
    if (!result.ok) return { output: `git diff failed: ${result.stderr.trim().slice(0, 200)}` }
    if (!result.stdout.trim()) return { output: args.staged ? '(nothing staged)' : '(no unstaged changes)' }
    return { output: clip(result.stdout), data: { paths: args.paths ?? null } }
  },
}

export const gitLogTool: ToolDef = {
  name: 'git_log',
  description: 'Show recent commit history (one line each, newest first). Optionally limit the count (default 20).',
  parameters: {
    type: 'object',
    properties: {
      count: { type: 'number', description: 'Number of commits (default 20, cap 100)' },
    },
  },
  kind: 'other',
  readOnly: true,
  async execute(args, ctx): Promise<ToolResult> {
    const count = Math.min(Math.max(Number(args.count ?? 20), 1), 100)
    const result = await git(ctx, ['log', '--oneline', '--no-decorate', `-n${count}`])
    if (!result.ok) return { output: `git log failed: ${result.stderr.trim().slice(0, 200)}` }
    return { output: clip(result.stdout.trim() || '(no commits yet)') }
  },
}

export const gitCommitTool: ToolDef = {
  name: 'git_commit',
  description:
    'Stage the given files (or all modified files when paths is omitted) and create a commit. Write a short, natural message — summary line under 72 chars, no AI-formula phrasing. Returns the new commit hash.',
  parameters: {
    type: 'object',
    properties: {
      message: { type: 'string', description: 'Commit message (first line acts as the subject)' },
      paths: { type: 'array', items: { type: 'string' }, description: 'Files to stage; omit to stage all modified files' },
    },
    required: ['message'],
  },
  kind: 'shell',
  readOnly: false,
  async execute(args, ctx): Promise<ToolResult> {
    const message = String(args.message ?? '').trim()
    if (!message) return { output: 'A commit message is required.' }
    const paths = Array.isArray(args.paths) ? args.paths.map(String).filter(Boolean) : []
    for (const p of paths) {
      try {
        ctx.sandbox.safePath(p)
      } catch (err) {
        return { output: `Refusing to stage "${p}": ${err instanceof Error ? err.message : String(err)}` }
      }
    }
    const add = await git(ctx, ['add', '--', ...(paths.length ? paths : ['.'])])
    if (!add.ok) return { output: `git add failed: ${add.stderr.trim().slice(0, 200)}` }
    const commit = await git(ctx, ['commit', '-m', message], 30_000)
    if (!commit.ok) {
      const hint = /nothing to commit/i.test(commit.stderr) ? 'Nothing to commit — the working tree matches HEAD.' : commit.stderr.trim().slice(0, 300)
      return { output: `git commit failed: ${hint}` }
    }
    const hash = await git(ctx, ['rev-parse', '--short', 'HEAD'])
    const subject = message.split('\n')[0]!
    return { output: `Committed ${hash.stdout.trim() || ''}: ${subject}`.trim(), data: { hash: hash.stdout.trim() } }
  },
}

export const gitTools = [gitStatusTool, gitDiffTool, gitLogTool, gitCommitTool]
