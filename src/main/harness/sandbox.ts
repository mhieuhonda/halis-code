/**
 * Workspace sandbox: agents operate inside a designated workspace only.
 * File tools are path-jailed; shell commands run with cwd = workspace and
 * are screened against an obvious-danger blocklist.
 */
import { isAbsolute, join, normalize, resolve, sep } from 'node:path'
import { existsSync, realpathSync, statSync } from 'node:fs'

export class SandboxError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SandboxError'
  }
}

const BLOCKED_PATTERNS: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /\brm\s+(-[a-z]*\s+)*-?[rf]{0,2}\s*(--no-preserve-root\s+)?\/(\s|$)/i, why: 'recursive delete targeting the filesystem root' },
  { pattern: /\brm\s+-[rf]+\s+~(\s|\/|$)/, why: 'recursive delete targeting the home directory' },
  { pattern: /\bmkfs\b/i, why: 'filesystem formatting' },
  { pattern: /\bdd\b[^|]*\bof=\/dev\//i, why: 'raw device writes' },
  { pattern: /\bsudo\b/i, why: 'privilege escalation' },
  { pattern: /\bsu\b\s+/i, why: 'privilege escalation' },
  { pattern: /:\(\)\s*\{\s*:\|:&\s*\};\s*:/, why: 'fork bomb' },
  { pattern: /\b(shutdown|reboot|halt|poweroff)\b/i, why: 'system power control' },
  { pattern: /\bchmod\s+(-R\s+)?777\s+\/(\s|$)/, why: 'world-writable root permissions' },
  { pattern: /\bcurl\b[^|]*\|\s*(ba)?sh/, why: 'piping remote scripts into a shell' },
  { pattern: /\bwget\b[^|]*\|\s*(ba)?sh/, why: 'piping remote scripts into a shell' },
  { pattern: /\b(npm|npx|pnpm|yarn|bun)\s+(install|i|add)\s+.*\s--force\s.*postinstall/i, why: 'forced post-install scripts' },
]

const INTERACTIVE = [/\bvim?\b(?!\s*-)/, /\bnano\b/, /\bless\b/, /\bmore\b/, /\btop\b/, /\bhtop\b/, /\bssh\b(?!.*(?:git@|BatchMode))/]

export interface Sandbox {
  /** Resolve and jail a path inside the workspace (or its .halis dir). */
  safePath(input: string): string
  /** Screen a shell command; throws SandboxError when blocked. */
  screenCommand(command: string): void
  readonly workspace: string
}

export function createSandbox(workspace: string): Sandbox {
  const root = resolve(workspace)
  if (!existsSync(root)) throw new SandboxError(`Workspace does not exist: ${root}`)

  const realRoot = (() => {
    try {
      return realpathSync(root)
    } catch {
      return root
    }
  })()

  function safePath(input: string): string {
    if (!input || typeof input !== 'string') throw new SandboxError('A file path is required.')
    const cleaned = input.trim().replace(/^~(?=\/|$)/, '')
    const base = isAbsolute(cleaned) ? resolve(cleaned) : resolve(root, cleaned)
    const normalized = normalize(base)

    // Jail check on the lexical path first.
    const inside = (p: string) => p === realRoot || p.startsWith(realRoot + sep)
    if (!inside(normalized)) {
      throw new SandboxError(
        `Access denied: "${input}" resolves outside the workspace (${root}). Agents can only touch files inside the workspace.`,
      )
    }

    // Symlink escape check when the file exists.
    if (existsSync(normalized)) {
      let real: string
      try {
        real = statSync(normalized).isDirectory() ? realpathSync(normalized) : realpathSync(normalized)
      } catch {
        throw new SandboxError(`Could not resolve "${input}".`)
      }
      if (!inside(real)) {
        throw new SandboxError(`Access denied: "${input}" is a symlink pointing outside the workspace.`)
      }
    }
    return normalized
  }

  function screenCommand(command: string): void {
    const cmd = command.trim()
    if (!cmd) throw new SandboxError('Empty command.')
    for (const { pattern, why } of BLOCKED_PATTERNS) {
      if (pattern.test(cmd)) {
        throw new SandboxError(`Command blocked (${why}). Terminal access is limited to the workspace.`)
      }
    }
    for (const pattern of INTERACTIVE) {
      if (pattern.test(cmd)) {
        throw new SandboxError('Interactive terminal programs are not supported. Use non-interactive commands.')
      }
    }
    // cd outside the workspace + something afterwards is a common escape.
    const cdEscape = /\bcd\s+(\/|~|\.\.)\s*$|\bcd\s+\/(etc|var|usr|bin|sbin|opt|root|proc|sys|dev)\b/.test(cmd)
    if (cdEscape) {
      throw new SandboxError('Commands must stay inside the workspace directory.')
    }
  }

  return { safePath, screenCommand, workspace: root }
}

/** Monospace-friendly byte cap. */
export const SHELL_OUTPUT_CAP = 100_000
export const SHELL_TIMEOUT_MS = 120_000
