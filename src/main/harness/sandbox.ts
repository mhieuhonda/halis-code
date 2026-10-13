/**
 * Workspace sandbox: agents operate inside a designated workspace only.
 * File tools are path-jailed; shell commands run with cwd = workspace and
 * are screened against an obvious-danger blocklist.
 */
import { dirname, isAbsolute, normalize, resolve, sep } from 'node:path'
import { existsSync, realpathSync } from 'node:fs'

export class SandboxError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SandboxError'
  }
}

const BLOCKED_PATTERNS: Array<{ pattern: RegExp; why: string }> = [
  // `/*` globs every top-level entry — same blast radius as `rm -rf /` itself.
  { pattern: /\brm\s+(-[a-z]*\s+)*-?[rf]{0,2}\s*(--no-preserve-root\s+)?\/(\*|\s|$)/i, why: 'recursive delete targeting the filesystem root' },
  // $HOME is just as destructive as ~ and does not match the sigil form.
  { pattern: /\brm\s+-[rf]+\s+(~|\$\{?HOME\}?)(\s|\/|$)/, why: 'recursive delete targeting the home directory' },
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

const INTERACTIVE = [/\bvim?\b/, /\bnano\b/, /\bless\b/, /\bmore\b/, /\btop\b/, /\bhtop\b/, /\bssh\b(?!.*(?:git@|BatchMode))/]

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
    // Relative paths resolve against the REAL root: with a symlinked
    // workspace (macOS /tmp → /private/tmp, ~/projects on another volume)
    // `resolve(root, …)` keeps the lexical prefix, fails the realpath jail
    // below, and bricks EVERY relative file operation with a misleading
    // "resolves outside the workspace" error.
    const base = isAbsolute(cleaned) ? resolve(cleaned) : resolve(realRoot, cleaned)
    const normalized = normalize(base)

    // Jail check on the lexical path first — accept both the configured root
    // and its realpath form (absolute paths typed through the symlinked root
    // are still inside the workspace).
    const inside = (p: string) => p === realRoot || p.startsWith(realRoot + sep) || p === root || p.startsWith(root + sep)
    if (!inside(normalized)) {
      throw new SandboxError(
        `Access denied: "${input}" resolves outside the workspace (${root}). Agents can only touch files inside the workspace.`,
      )
    }

    // Symlink escape check: resolve the deepest path component that actually
    // exists and jail-check its real path. Checking only the full path would
    // miss `symlink-outside/newfile` where the leaf does not exist yet — the
    // write would land outside the workspace through the symlinked parent.
    let probe = normalized
    while ((probe.startsWith(root + sep) || probe.startsWith(realRoot + sep)) && !existsSync(probe)) probe = dirname(probe)
    if (existsSync(probe)) {
      let real: string
      try {
        real = realpathSync(probe)
      } catch {
        throw new SandboxError(`Could not resolve "${input}".`)
      }
      if (!inside(real)) {
        throw new SandboxError(`Access denied: "${input}" goes through a symlink pointing outside the workspace.`)
      }
    }
    return normalized
  }

  function screenCommand(command: string): void {
    const cmd = command.trim()
    if (!cmd) throw new SandboxError('Empty command.')
    // Screen the raw command AND a normalized copy: quoting the target or
    // spelling out long flags (`rm -rf "/"`, `rm --recursive --force /`,
    // `bash -c 'rm -rf /'`) is enough to slip past the raw patterns alone.
    // False positives on e.g. `echo "rm -rf /"` are acceptable — the
    // blocklist is a fail-closed backstop, not a parser.
    const normalized = cmd
      .replace(/["']/g, '')
      .replace(/--recursive\b/gi, '-r')
      .replace(/--force\b/gi, '-f')
    for (const { pattern, why } of BLOCKED_PATTERNS) {
      if (pattern.test(cmd) || pattern.test(normalized)) {
        throw new SandboxError(`Command blocked (${why}). Terminal access is limited to the workspace.`)
      }
    }
    for (const pattern of INTERACTIVE) {
      if (pattern.test(cmd)) {
        throw new SandboxError('Interactive terminal programs are not supported. Use non-interactive commands.')
      }
    }
    // `cd` is the common escape hatch: commands run with cwd = workspace, so
    // every `cd` re-anchors the sandbox. Screen each occurrence individually
    // (a single whole-string exception test let `cd <ws> && cd /etc` through)
    // and fail closed on forms that resolve outside our control (~, $VAR,
    // flags, `cd -`, bare `cd` → $HOME).
    const insideRoot = (p: string) => {
      const r = resolve(p)
      return r === root || r.startsWith(root + sep) || r === realRoot || r.startsWith(realRoot + sep)
    }
    for (const m of cmd.matchAll(/\bcd\s+("(?:[^"\\]|\\.)*"|'[^']*'|[^\s;|&]+)/g)) {
      let target = m[1] ?? ''
      if (target.length >= 2 && (target.startsWith('"') || target.startsWith("'")) && target.endsWith(target[0])) {
        target = target.slice(1, -1)
      }
      if (target.startsWith('-') || target.includes('~') || target.includes('$')) {
        throw new SandboxError('Commands must stay inside the workspace directory.')
      }
      if (!insideRoot(isAbsolute(target) ? target : resolve(root, target))) {
        throw new SandboxError('Commands must stay inside the workspace directory.')
      }
    }
    // Bare `cd` (no target) jumps to $HOME — catch it at command position so
    // arguments that merely look like `cd` (e.g. `mkdir cd`) stay allowed.
    for (const seg of cmd.split(/&&|\|\||[;|&\n]/)) {
      const tokens = seg.trim().split(/\s+/)
      if (tokens.length === 1 && tokens[0]?.replace(/^["']|["']$/g, '') === 'cd') {
        throw new SandboxError('Commands must stay inside the workspace directory.')
      }
    }
  }

  return { safePath, screenCommand, workspace: root }
}

/** Monospace-friendly byte cap. */
export const SHELL_OUTPUT_CAP = 100_000
export const SHELL_TIMEOUT_MS = 120_000
