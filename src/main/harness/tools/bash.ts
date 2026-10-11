/**
 * Shell tool: runs commands with cwd locked to the workspace, screened by
 * the sandbox, capped on time and output. AGENT=HALIS is exported so tools
 * can detect an automated caller.
 */
import { spawn } from 'node:child_process'
import { SHELL_OUTPUT_CAP, SHELL_TIMEOUT_MS } from '../sandbox'
import type { ToolContext, ToolDef, ToolResult } from './index'

export const runCommandTool: ToolDef = {
  name: 'run_command',
  description:
    'Run a non-interactive shell command inside the workspace (build, test, git, etc.). Commands are screened; dangerous or system-level commands are rejected. Output is capped.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The command to run' },
      timeout_ms: { type: 'number', description: `Timeout in milliseconds (default ${SHELL_TIMEOUT_MS}, max 600000)` },
    },
    required: ['command'],
  },
  kind: 'shell',
  readOnly: false,
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const command = String(args.command ?? '')
    ctx.sandbox.screenCommand(command)
    const timeout = Math.min(Math.max(Number(args.timeout_ms ?? SHELL_TIMEOUT_MS), 1000), 600_000)
    const isWin = process.platform === 'win32'
    const shell = isWin ? process.env.ComSpec ?? 'cmd.exe' : '/bin/bash'
    const shellArgs = isWin ? ['/d', '/s', '/c', command] : ['-lc', command]

    return await new Promise<ToolResult>((resolve) => {
      const child = spawn(shell, shellArgs, {
        cwd: ctx.workspace,
        env: { ...process.env, AGENT: 'HALIS', HALIS_AGENT: ctx.agentName, HALIS_SESSION: ctx.sessionId, FORCE_COLOR: '0', NO_COLOR: '1' },
        windowsHide: true,
      })
      let stdout = ''
      let stderr = ''
      let truncated = false
      const append = (chunk: Buffer, target: 'out' | 'err') => {
        const text = chunk.toString('utf8')
        if (target === 'out') stdout += text
        else stderr += text
        if (stdout.length + stderr.length > SHELL_OUTPUT_CAP * 2) {
          truncated = true
          child.kill('SIGKILL')
        }
      }
      child.stdout.on('data', (c: Buffer) => append(c, 'out'))
      child.stderr.on('data', (c: Buffer) => append(c, 'err'))
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
      }, timeout)
      child.on('error', (err) => {
        clearTimeout(timer)
        resolve({ output: `Failed to start command: ${err.message}` })
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        const clip = (s: string) => {
          if (s.length <= SHELL_OUTPUT_CAP) return s
          truncated = true
          return s.slice(0, SHELL_OUTPUT_CAP)
        }
        stdout = clip(stdout)
        stderr = clip(stderr)
        const parts: string[] = []
        if (stdout.trim()) parts.push(stdout.trim())
        if (stderr.trim()) parts.push(`stderr:\n${stderr.trim()}`)
        if (truncated) parts.push('… (output truncated)')
        resolve({
          output: `exit code: ${code ?? 'killed'}\n${parts.join('\n') || '(no output)'}`,
          data: { exitCode: code, truncated },
        })
      })
    })
  },
}

export const bashTools = [runCommandTool]
