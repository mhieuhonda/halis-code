/**
 * Shell tool — cross-platform command execution with background jobs.
 * POSIX prefers bash with an sh fallback; Windows prefers PowerShell 7 →
 * Windows PowerShell 5.1 (UTF-8 preamble included) → cmd. Commands run with
 * cwd locked to the workspace, screened by the sandbox, capped on time and
 * output. AGENT=HALIS is exported so tools can detect an automated caller,
 * and credential-shaped env vars never reach children.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { SHELL_OUTPUT_CAP, SHELL_TIMEOUT_MS } from '../sandbox'
import type { ToolContext, ToolDef, ToolResult } from './index'

/** pwsh 7 → Windows PowerShell 5.1 → cmd fallback (deepseek-harness resolve chain). */
function resolveWindowsShell(): { shell: string; preamble: string; args: (command: string) => string[]; kind: 'pwsh' | 'powershell' | 'cmd' } {
  const pf = process.env['ProgramFiles'] ?? 'C:\\Program Files'
  const pwsh7 = `${pf}\\PowerShell\\7\\pwsh.exe`
  const powershell5 = `${process.env['SystemRoot'] ?? 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
  // PS 5.1 writes the console in the OEM codepage — force UTF-8 up front so
  // non-ASCII output survives. Statements live on line 1 to keep error line
  // numbers unchanged.
  const preamble =
    '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $OutputEncoding = [System.Text.UTF8Encoding]::new($false); $ProgressPreference = "SilentlyContinue"; '
  if (existsSync(pwsh7)) return { shell: pwsh7, kind: 'pwsh', preamble, args: (command) => ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', preamble + command] }
  if (existsSync(powershell5)) return { shell: powershell5, kind: 'powershell', preamble, args: (command) => ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', preamble + command] }
  return { shell: process.env.ComSpec ?? 'cmd.exe', kind: 'cmd', preamble: '', args: (command) => ['/d', '/s', '/c', command] }
}

/** Credential-shaped names must not leak into children (deepseek-harness scrub). */
const SENSITIVE_ENV = /KEY|PASSWORD|SECRET|TOKEN|PASSWD|PRIVATE/i

function childEnv(ctx: ToolContext): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (SENSITIVE_ENV.test(key) && !key.startsWith('HALIS_')) continue
    out[key] = value
  }
  out.NO_COLOR = '1'
  out.FORCE_COLOR = '0'
  out.TERM = 'dumb'
  out.PAGER = 'cat'
  out.GIT_PAGER = 'cat'
  out.AGENT = 'HALIS'
  out.HALIS_AGENT = ctx.agentName
  out.HALIS_SESSION = ctx.sessionId
  return out
}

interface RunOutcome {
  exitCode: number | null
  signal: NodeJS.Signals | null
  timedOut: boolean
  stdout: string
  stderr: string
  truncated: boolean
}

interface RunHandle {
  outcome: Promise<RunOutcome>
  kill: () => void
}

/**
 * Kill the whole process tree, not just the shell. SIGKILL to /bin/bash
 * reparents grandchildren (sleep, npm, dev servers) to init — they would
 * keep holding ports and files invisibly. POSIX: the shell is spawned
 * detached, so it leads its own process group and -pid kills everyone.
 * Windows: taskkill /T walks the tree.
 */
function killTree(child: ChildProcess): void {
  if (!child.pid) return
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
    } catch {
      child.kill('SIGKILL')
    }
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      child.kill('SIGKILL')
    }
  }
}

function runShellProcess(command: string, ctx: ToolContext, env: Record<string, string>, timeoutMs: number | null, onOutput: (chunk: string) => void): RunHandle {
  const isWin = process.platform === 'win32'
  let shell: string
  let shellArgs: string[]
  if (isWin) {
    const resolved = resolveWindowsShell()
    shell = resolved.shell
    shellArgs = resolved.args(command)
  } else {
    shell = existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh'
    shellArgs = ['-c', command]
  }

  // detached (POSIX) puts the shell in its own process group so killTree can
  // take down the whole tree. stdio pipes keep it reaped by Node.
  const child = spawn(shell, shellArgs, { cwd: ctx.workspace, env, windowsHide: true, detached: !isWin })
  let stdout = ''
  let stderr = ''
  let truncated = false
  let timedOut = false

  const append = (chunk: Buffer, target: 'out' | 'err') => {
    const text = chunk.toString('utf8')
    if (target === 'out') stdout += text
    else stderr += text
    onOutput(text)
    if (stdout.length + stderr.length > SHELL_OUTPUT_CAP * 2) {
      truncated = true
      killTree(child)
    }
  }
  child.stdout?.on('data', (c: Buffer) => append(c, 'out'))
  child.stderr?.on('data', (c: Buffer) => append(c, 'err'))

  const timer =
    timeoutMs === null
      ? null
      : setTimeout(() => {
          timedOut = true
          killTree(child)
        }, timeoutMs)
  if (timer && typeof timer.unref === 'function') timer.unref()

  const outcome = new Promise<RunOutcome>((resolve) => {
    child.on('error', (err) => {
      if (timer) clearTimeout(timer)
      resolve({ exitCode: null, signal: null, timedOut, stdout, stderr: `${stderr}\n${err.message}`.trim(), truncated })
    })
    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer)
      resolve({ exitCode: code, signal, timedOut, stdout, stderr, truncated })
    })
  })

  return {
    outcome,
    kill: () => killTree(child),
  }
}

function formatResult(outcome: RunOutcome): { output: string; data: Record<string, unknown> } {
  const clip = (s: string) => {
    if (s.length <= SHELL_OUTPUT_CAP) return s
    return s.slice(0, SHELL_OUTPUT_CAP)
  }
  const stdout = clip(outcome.stdout)
  const stderr = clip(outcome.stderr)
  const parts: string[] = []
  if (stdout.trim()) parts.push(stdout.trim())
  if (stderr.trim()) parts.push(`stderr:\n${stderr.trim()}`)
  if (outcome.truncated) parts.push('… (output truncated)')
  let statusLine: string
  if (outcome.timedOut) statusLine = 'Command exceeded its timeout and was stopped. For long-running commands use run_in_background: true and collect with job_output.'
  else if (outcome.signal) statusLine = `Killed by ${outcome.signal}`
  else statusLine = `exit code: ${outcome.exitCode ?? 'unknown'}`
  return { output: `${statusLine}\n${parts.join('\n') || '(no output)'}`, data: { exitCode: outcome.exitCode, timedOut: outcome.timedOut, truncated: outcome.truncated } }
}

export const runCommandTool: ToolDef = {
  name: 'run_command',
  description:
    'Run a non-interactive shell command inside the workspace (build, test, git, etc.). Commands are screened; dangerous or system-level commands are rejected. Output is capped. Set run_in_background for dev servers, long builds, or watch tasks — then collect with job_output.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The command to run' },
      timeout_ms: { type: 'number', description: `Timeout in milliseconds (default ${SHELL_TIMEOUT_MS}, max 600000)` },
      run_in_background: { type: 'boolean', description: 'Run as a background job and return immediately. Collect output with job_output; do NOT poll with sleeps.' },
      description: { type: 'string', description: 'Short label (5-10 words) describing what this command does, shown to the user' },
    },
    required: ['command'],
  },
  kind: 'shell',
  readOnly: false,
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const command = String(args.command ?? '')
    ctx.sandbox.screenCommand(command)
    const timeout = Math.min(Math.max(Number(args.timeout_ms ?? SHELL_TIMEOUT_MS), 1000), 600_000)
    const env = childEnv(ctx)
    const label = String(args.description ?? '').trim() || command.slice(0, 80)

    if (args.run_in_background) {
      // The holder lets the registry kill the child even though it is created
      // inside run().
      let handle: RunHandle | null = null
      const started = ctx.jobs.start({
        kind: 'bash',
        label,
        ownerAgentId: ctx.agentId,
        sessionId: ctx.sessionId,
        run: async (controls) => {
          // Background jobs outlive the turn on purpose (dev servers, long
          // builds) — no timeout. Output cap and job_kill still stop them.
          handle = runShellProcess(command, ctx, env, null, (chunk) => controls.setOutput(chunk))
          const outcome = await handle.outcome
          controls.setOutput(`\n[${outcome.timedOut ? 'timed out' : outcome.signal ? `killed by ${outcome.signal}` : `finished with exit code ${outcome.exitCode ?? 'unknown'}`}]\n`)
          controls.settle(outcome.timedOut ? 'failed' : outcome.exitCode === null ? 'killed' : 'completed', outcome.exitCode)
        },
        kill: () => handle?.kill(),
      })
      return {
        output: `Command moved to the background (job id: ${started.id}). Output is streaming there — collect it with job_output (wait: true). Do not poll with sleeps; keep working and check before your final answer.`,
        data: { jobId: started.id, background: true },
      }
    }

    const proc = runShellProcess(command, ctx, env, timeout, () => {})
    const outcome = await proc.outcome
    return formatResult(outcome)
  },
}

export const bashTools = [runCommandTool]
