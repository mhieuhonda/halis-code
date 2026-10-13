/**
 * Search tools: glob for filenames, grep for content — both implemented
 * natively (no ripgrep dependency) and jailed to the workspace.
 */
import { readdirSync, readFileSync, statSync, type Dirent } from 'node:fs'
import { join, relative, sep } from 'node:path'
import type { ToolContext, ToolDef, ToolResult } from './index'

const MAX_GLOB_RESULTS = 200
const MAX_GREP_RESULTS = 100
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'out', 'build', '.next', '.venv', '__pycache__', '.halis', 'release'])
const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|pdf|zip|tar|gz|bz2|7z|rar|exe|dll|so|dylib|bin|wasm|mp4|mp3|mov|avi|woff2?|ttf|otf)$/i

function walk(root: string, dir = '', out: string[] = [], depth = 0): string[] {
  if (out.length >= MAX_GLOB_RESULTS * 5 || depth > 12) return out
  let entries: Array<Dirent>
  try {
    entries = readdirSync(join(root, dir), { withFileTypes: true }) as Array<Dirent>
  } catch {
    return out
  }
  for (const entry of entries) {
    if (out.length >= MAX_GLOB_RESULTS * 5) break
    const rel = dir ? `${dir}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.') && entry.name !== '.github') continue
      walk(root, rel, out, depth + 1)
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      // FIFOs (mkfifo) and sockets must not enter the list: a synchronous
      // readFileSync on a writer-less FIFO blocks the main process forever.
      out.push(rel)
    }
  }
  return out
}

function globToRegExp(pattern: string): RegExp {
  return new RegExp(`^${globToSource(pattern)}$`, 'i')
}

function globToSource(pattern: string): string {
  let re = ''
  let i = 0
  while (i < pattern.length) {
    const c = pattern[i]!
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        re += '.*'
        i += 2
        if (pattern[i] === '/') i++
      } else {
        re += '[^/]*'
        i++
      }
    } else if (c === '?') {
      re += '[^/]'
      i++
    } else if (c === '{') {
      const end = pattern.indexOf('}', i)
      if (end > 0) {
        // Each alternative is a mini-glob and MUST go through the same
        // conversion: `{*.ts,*.js}` used to emit `(?:*.ts|*.js)` — an
        // invalid regex ("Nothing to repeat") that errored the whole tool.
        re += `(?:${pattern
          .slice(i + 1, end)
          .split(',')
          .map(globToSource)
          .join('|')})`
        i = end + 1
      } else {
        re += '\\{'
        i++
      }
    } else {
      re += c.replace(/[.+^$()|[\]\\]/g, '\\$&')
      i++
    }
  }
  return re
}

export const globTool: ToolDef = {
  name: 'glob',
  description: 'Find files in the workspace by glob pattern, e.g. "src/**/*.ts" or "**/*.md".',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern' },
    },
    required: ['pattern'],
  },
  kind: 'other',
  readOnly: true,
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const pattern = String(args.pattern ?? '**/*')
    const re = globToRegExp(pattern)
    const files = walk(ctx.workspace)
    const matches = files.filter((f) => re.test(f) || re.test(f.split('/').pop()!)).slice(0, MAX_GLOB_RESULTS)
    return {
      output: matches.length ? matches.join('\n') : `No files match "${pattern}".`,
      data: { count: matches.length },
    }
  },
}

export const grepTool: ToolDef = {
  name: 'grep',
  description: 'Search file contents in the workspace with a regular expression. Returns file:line: text matches.',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Regular expression (RE2/JS syntax)' },
      path: { type: 'string', description: 'Limit search to this subdirectory or file' },
      include: { type: 'string', description: 'Filename glob filter, e.g. "*.ts"' },
      case_sensitive: { type: 'boolean', description: 'Case-sensitive match (default false)' },
    },
    required: ['pattern'],
  },
  kind: 'other',
  readOnly: true,
  async execute(args, ctx): Promise<ToolResult> {
    const pattern = String(args.pattern ?? '')
    let re: RegExp
    try {
      re = new RegExp(pattern, args.case_sensitive ? '' : 'i')
    } catch (err) {
      return { output: `Invalid regex: ${err instanceof Error ? err.message : err}` }
    }
    const includeRe = args.include ? globToRegExp(String(args.include)) : null
    const sub = args.path ? ctx.sandbox.safePath(String(args.path)) : ctx.workspace
    let files: string[]
    try {
      files = statSync(sub).isDirectory() ? walk(sub) : [relative(ctx.workspace, sub)]
    } catch {
      return { output: `Path not found: ${String(args.path)}` }
    }
    const results: string[] = []
    const fileLimit = 400
    // statSync once: the single-file case must not run candidates through
    // join() + safePath (the walked list is relative to the workspace only
    // in the directory case).
    const subIsDir = statSync(sub).isDirectory()
    // Report paths relative to the WORKSPACE — what read_file/edit_file
    // resolve against — not relative to the searched sub-path. Without this,
    // `grep path:"src"` prints `utils/x.ts:12` and the follow-up read_file
    // fails with "File not found" (the real path is `src/utils/x.ts`).
    const displayPrefix = subIsDir ? relative(ctx.workspace, sub).split(sep).join('/') : ''
    // Silent caps breed confident false negatives: "No matches" over a
    // partially scanned tree must say so, or the model asserts the absence
    // to the user (reviewer verified this on a 5000-file repo).
    const scanWasPartial = files.length > fileLimit || files.length >= MAX_GLOB_RESULTS * 5
    for (const file of files.slice(0, fileLimit)) {
      if (BINARY_EXT.test(file)) continue
      if (includeRe && !includeRe.test(file.split('/').pop()!)) continue
      let content: string
      try {
        const full = join(sub, file)
        // Re-jail every walked candidate: walk() lists symlinks, and a repo
        // cloned from an untrusted source can carry `creds -> ~/.ssh/id_rsa`.
        // read_file blocks this via safePath's realpath check; grep must not
        // be the hole in the jail (it runs with NO approval card).
        // `full` is already absolute and in-jail — feeding it through
        // relative()+safePath breaks on depth-changing workspace symlinks
        // (macOS /var → /private/var): the relative hops out of the lexical
        // root and every file is silently skipped.
        const target = subIsDir ? ctx.sandbox.safePath(full) : sub
        const st = statSync(target)
        // Only regular files up to 8 MB — the same cap read_file enforces.
        // A 2 GB log loaded synchronously freezes the main process; a FIFO
        // would block forever.
        if (!st.isFile() || st.size > 8 * 1024 * 1024) continue
        content = readFileSync(target, 'utf8')
      } catch {
        continue
      }
      const lines = content.split('\n')
      for (let i = 0; i < lines.length && results.length < MAX_GREP_RESULTS; i++) {
        const line = lines[i]!
        // Cap the tested prefix: a catastrophic-backtracking pattern against
        // a minified 60 KB line freezes the whole main process for minutes
        // (this tool runs synchronously, up to 400 files per call).
        if (re.test(line.length > 8192 ? line.slice(0, 8192) : line)) {
          const shown = displayPrefix ? `${displayPrefix}/${file}` : file
          results.push(`${shown}:${i + 1}: ${line.trim().slice(0, 240)}`)
        }
      }
      if (results.length >= MAX_GREP_RESULTS) break
    }
    const noMatch = `No matches for /${pattern}/.`
    const partialNote = scanWasPartial ? ` (Searched only the first ${Math.min(files.length, fileLimit)} of ${files.length} walked files — narrow with path/include.)` : ''
    return {
      output: results.length ? results.join('\n') + (results.length >= MAX_GREP_RESULTS ? '\n… (result list truncated)' : '') : noMatch + partialNote,
      data: { count: results.length },
    }
  },
}

export const searchTools = [globTool, grepTool]
