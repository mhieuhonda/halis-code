/**
 * File tools: read, write, edit, multi_edit, list, read_image — all
 * path-jailed to the workspace and coordinated through the file-lock
 * manager. The edit matching is opencode's 3-tier fuzzy scheme (exact →
 * unicode-normalized → line-based with trailing-whitespace + CRLF
 * tolerance).
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, readdirSync, rmdirSync, statSync, unlinkSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import type { ToolContext, ToolDef, ToolResult } from './index'
import { isLogLikePath, isStateFilePath } from '../file-locking'
import { fuzzyReplace } from '../util/edit-match'

const MAX_READ_CHARS = 200_000
const MAX_LS_ENTRIES = 500
const IMAGE_MIMES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
/** Edit tools load the whole file synchronously on the main process — a
 * multi-GB artifact would freeze (or OOM) the app before any matching. */
const MAX_EDIT_BYTES = 8 * 1024 * 1024

/** Number() + isFinite: "offset": "line 50" → NaN would slice(NaN, NaN) into a
 * silently EMPTY result — the model would conclude the file is empty. */
function toFiniteInt(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function rel(ws: string, p: string): string {
  const r = relative(ws, p)
  return r && !r.startsWith('..') ? r : p
}

function truncate(s: string, max = MAX_READ_CHARS): string {
  if (s.length <= max) return s
  return `${s.slice(0, max)}\n… (truncated, ${s.length - max} more characters — read with offset/limit)`
}

/**
 * Make sure the parent directory of a target file exists and is a real
 * directory. Concurrent writes to sibling paths race here (parallel tool
 * calls), so mkdir is always re-run — it is idempotent. When a path
 * component exists as a FILE (a model writing "src" then "src/index.js" is
 * the classic case), fail with a message the agent can act on.
 */
function ensureWritableParent(file: string, ws: string): void {
  const dir = dirname(file)
  if (existsSync(dir)) {
    if (!statSync(dir).isDirectory()) {
      throw new Error(`Cannot write ${rel(ws, file)}: "${rel(ws, dir)}" already exists as a FILE but a directory is needed at that path. Remove or rename that file first (delete_file), then retry.`)
    }
    return
  }
  try {
    mkdirSync(dir, { recursive: true })
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOTDIR' || code === 'EEXIST' || code === 'EISDIR') {
      throw new Error(`Cannot write ${rel(ws, file)}: a parent path component is a file where a directory is needed ("${rel(ws, dir)}"). Remove or rename that file first, then retry.`)
    }
    throw err
  }
}

export const readFileTool: ToolDef = {
  name: 'read_file',
  description:
    'Read a text file from the workspace. Returns numbered lines. Use offset/limit for large files. Outside the workspace is not allowed.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path, relative to the workspace root' },
      offset: { type: 'number', description: 'Line to start from (1-based)' },
      limit: { type: 'number', description: 'Maximum number of lines to return' },
    },
    required: ['path'],
  },
  kind: 'other',
  readOnly: true,
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const path = ctx.sandbox.safePath(String(args.path ?? ''))
    if (!existsSync(path)) {
      return { output: `File not found: ${String(args.path)}. Use glob to find the right path.` }
    }
    const stat = statSync(path)
    if (stat.isDirectory()) {
      return { output: `${String(args.path)} is a directory. Use list_dir instead.` }
    }
    // FIFOs / sockets / devices: statSync reports them size 0, and a
    // synchronous readFileSync would BLOCK the main process forever (open()
    // waits for a writer that never comes — the whole UI dies).
    if (!stat.isFile()) {
      return { output: `Not a regular file: ${String(args.path)}.` }
    }
    if (stat.size > 8 * 1024 * 1024) return { output: `File too large (${(stat.size / 1048576).toFixed(1)} MB).` }
    const content = readFileSync(path, 'utf8')
    const lines = content.split('\n')
    const offset = Math.max(1, toFiniteInt(args.offset, 1))
    const limit = Math.min(toFiniteInt(args.limit, 2000), 2000)
    const slice = lines.slice(offset - 1, offset - 1 + limit)
    const numbered = slice.map((line, i) => `${offset + i}: ${line}`).join('\n')
    return {
      output: truncate(numbered) + (offset + slice.length - 1 < lines.length ? `\n… (${lines.length - (offset + slice.length - 1)} more lines)` : ''),
      data: { path: rel(ctx.workspace, path), totalLines: lines.length },
    }
  },
}

export const listDirTool: ToolDef = {
  name: 'list_dir',
  description: 'List a directory in the workspace: names, types, sizes.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Directory path relative to the workspace (default: workspace root)' },
    },
  },
  kind: 'other',
  readOnly: true,
  async execute(args, ctx): Promise<ToolResult> {
    const path = ctx.sandbox.safePath(String(args.path ?? '.'))
    if (!existsSync(path)) return { output: `Directory not found: ${String(args.path)}` }
    const entries = readdirSync(path, { withFileTypes: true })
    const lines = entries
      .slice(0, MAX_LS_ENTRIES)
      .map((e) => {
        let size = ''
        try {
          if (e.isFile()) size = ` (${statSync(join(path, e.name)).size} B)`
        } catch {
          /* ignore */
        }
        return `${e.isDirectory() ? 'dir ' : 'file'} ${e.name}${size}`
      })
    if (entries.length > MAX_LS_ENTRIES) lines.push(`… and ${entries.length - MAX_LS_ENTRIES} more`)
    return { output: lines.join('\n') || '(empty directory)', data: { path: rel(ctx.workspace, path), count: entries.length } }
  },
}

export const writeFileTool: ToolDef = {
  name: 'write_file',
  description: 'Create or overwrite a file in the workspace with the given content. Directories are created automatically.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path relative to the workspace' },
      content: { type: 'string', description: 'Full file content' },
    },
    required: ['path', 'content'],
  },
  kind: 'file-write',
  readOnly: false,
  async execute(args, ctx): Promise<ToolResult> {
    const path = ctx.sandbox.safePath(String(args.path ?? ''))
    const content = String(args.content ?? '')
    const mode = isLogLikePath(path) ? 'advisory' : 'hard'
    if (isStateFilePath(path)) {
      throw new Error('Workspace state files under .halis/ are managed by the harness — edit them through task-board tools.')
    }
    const lockResult = ctx.locks.acquire(path, ctx.agentId, ctx.agentName, mode)
    try {
      const existed = existsSync(path)
      if (existed && statSync(path).isDirectory()) {
        // target path is an existing DIRECTORY — impossible to overwrite
        return { output: `${String(args.path)} is a directory — write to a file path inside it instead.` }
      }
      // `before` exists ONLY to report beforeChars — skip the read for huge
      // files (a synchronous multi-GB load would freeze the main process).
      const before = existed && statSync(path).size <= MAX_EDIT_BYTES ? readFileSync(path, 'utf8') : ''
      ensureWritableParent(path, ctx.workspace)
      const tmp = `${path}.halis-tmp`
      try {
        writeFileSync(tmp, content, 'utf8')
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOTDIR') {
          // Re-check with a friendly message — a sibling parallel write may
          // have created a file where this write needs a directory.
          ensureWritableParent(path, ctx.workspace)
        }
        throw err
      }
      renameSync(tmp, path)
      const lines = content.split('\n').length
      return {
        output: `${existed ? 'Overwrote' : 'Created'} ${rel(ctx.workspace, path)} (${lines} lines, ${content.length} chars).${lockResult.warning ? ` ${lockResult.warning}` : ''}`,
        data: { path: rel(ctx.workspace, path), existed, beforeChars: before.length, afterChars: content.length },
      }
    } finally {
      ctx.locks.release(path, ctx.agentId)
    }
  },
}

export const editFileTool: ToolDef = {
  name: 'edit_file',
  description:
    'Edit a file by replacing an exact string. old_string must match the file content (matching is tolerant: unicode look-alikes and trailing whitespace differences are normalized). Use replace_all to replace every occurrence.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path relative to the workspace' },
      old_string: { type: 'string', description: 'Exact text to replace' },
      new_string: { type: 'string', description: 'Replacement text (must differ from old_string)' },
      replace_all: { type: 'boolean', description: 'Replace every occurrence (default: first only)' },
    },
    required: ['path', 'old_string', 'new_string'],
  },
  kind: 'file-write',
  readOnly: false,
  async execute(args, ctx): Promise<ToolResult> {
    const path = ctx.sandbox.safePath(String(args.path ?? ''))
    if (!existsSync(path)) return { output: `File not found: ${String(args.path)}` }
    if (isStateFilePath(path)) {
      throw new Error('Workspace state files under .halis/ are managed by the harness.')
    }
    const oldString = String(args.old_string ?? '')
    const newString = String(args.new_string ?? '')
    if (!oldString) return { output: 'old_string is empty — use write_file to create a file instead.' }
    if (oldString === newString) return { output: 'old_string and new_string are identical — nothing to change.' }

    const mode = isLogLikePath(path) ? 'advisory' : 'hard'
    const lockResult = ctx.locks.acquire(path, ctx.agentId, ctx.agentName, mode)
    try {
      if (statSync(path).size > MAX_EDIT_BYTES) {
        return { output: `File too large to edit (${(statSync(path).size / 1048576).toFixed(1)} MB, cap 8 MB). Use run_command for targeted edits (grep/sed) instead.` }
      }
      const content = readFileSync(path, 'utf8')
      const match = fuzzyReplace(content, oldString, newString, !!args.replace_all)
      // content === '' is a VALID result (an edit that empties the file) —
      // only null means "no match". A falsy check would reject it.
      if (match.content === null) {
        if (match.occurrences > 1) {
          return { output: `old_string occurs ${match.occurrences} times in ${rel(ctx.workspace, path)}. Provide more surrounding context or set replace_all: true.` }
        }
        return {
          output: `Could not find old_string in ${rel(ctx.workspace, path)}. Read the file again and copy the exact text, including whitespace and indentation.`,
        }
      }
      const tmp = `${path}.halis-tmp`
      writeFileSync(tmp, match.content, 'utf8')
      renameSync(tmp, path)
      const strategyNote = match.strategy === 'exact' ? '' : ` (matched via ${match.strategy} fallback)`
      return {
        output: `Edited ${rel(ctx.workspace, path)}: ${match.occurrences} replacement(s)${strategyNote}.${lockResult.warning ? ` ${lockResult.warning}` : ''}`,
        data: { path: rel(ctx.workspace, path), replacements: match.occurrences, strategy: match.strategy, oldString, newString },
      }
    } finally {
      ctx.locks.release(path, ctx.agentId)
    }
  },
}

export const multiEditTool: ToolDef = {
  name: 'multi_edit',
  description:
    'Apply several exact replacements to ONE file in a single atomic call. Edits apply in order; if any old_string fails to match, nothing is written. Cheaper and safer than a sequence of edit_file calls on the same file.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path relative to the workspace' },
      edits: {
        type: 'array',
        description: 'Replacements applied in order',
        items: {
          type: 'object',
          properties: {
            old_string: { type: 'string' },
            new_string: { type: 'string' },
            replace_all: { type: 'boolean' },
          },
          required: ['old_string', 'new_string'],
        },
      },
    },
    required: ['path', 'edits'],
  },
  kind: 'file-write',
  readOnly: false,
  async execute(args, ctx): Promise<ToolResult> {
    const path = ctx.sandbox.safePath(String(args.path ?? ''))
    if (!existsSync(path)) return { output: `File not found: ${String(args.path)}` }
    if (isStateFilePath(path)) throw new Error('Workspace state files under .halis/ are managed by the harness.')
    const edits = Array.isArray(args.edits) ? args.edits : []
    if (!edits.length) return { output: 'Provide at least one edit.' }

    const mode = isLogLikePath(path) ? 'advisory' : 'hard'
    const lockResult = ctx.locks.acquire(path, ctx.agentId, ctx.agentName, mode)
    try {
      if (statSync(path).size > MAX_EDIT_BYTES) {
        return { output: `File too large to edit (${(statSync(path).size / 1048576).toFixed(1)} MB, cap 8 MB). Use run_command for targeted edits (grep/sed) instead.` }
      }
      let content = readFileSync(path, 'utf8')
      const applied: Array<{ strategy: string; replacements: number }> = []
      for (let i = 0; i < edits.length; i++) {
        const edit = edits[i] as { old_string?: unknown; new_string?: unknown; replace_all?: unknown }
        const oldString = String(edit?.old_string ?? '')
        const newString = String(edit?.new_string ?? '')
        if (!oldString) return { output: `Edit ${i + 1}: old_string is empty.` }
        if (oldString === newString) return { output: `Edit ${i + 1}: old_string and new_string are identical.` }
        const match = fuzzyReplace(content, oldString, newString, !!edit?.replace_all)
        if (match.content === null) {
          return {
            output: `Edit ${i + 1} failed: old_string not found${match.occurrences > 1 ? ` (${match.occurrences} ambiguous occurrences)` : ''} in ${rel(ctx.workspace, path)}. NOTHING was written. Fix the edit and retry.`,
          }
        }
        content = match.content
        applied.push({ strategy: match.strategy, replacements: match.occurrences })
      }
      const tmp = `${path}.halis-tmp`
      writeFileSync(tmp, content, 'utf8')
      renameSync(tmp, path)
      const total = applied.reduce((sum, a) => sum + a.replacements, 0)
      return {
        output: `Applied ${edits.length} edit(s) to ${rel(ctx.workspace, path)} (${total} replacement(s)).${lockResult.warning ? ` ${lockResult.warning}` : ''}`,
        data: { path: rel(ctx.workspace, path), edits: applied },
      }
    } finally {
      ctx.locks.release(path, ctx.agentId)
    }
  },
}

export const deleteFileTool: ToolDef = {
  name: 'delete_file',
  description: 'Delete a file (or an empty directory) inside the workspace. The action shows an approval card first.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path relative to the workspace' },
    },
    required: ['path'],
  },
  kind: 'file-write',
  readOnly: false,
  async execute(args, ctx): Promise<ToolResult> {
    const path = ctx.sandbox.safePath(String(args.path ?? ''))
    if (!existsSync(path)) return { output: `File not found: ${String(args.path)}` }
    if (isStateFilePath(path)) throw new Error('Workspace state files under .halis/ are managed by the harness.')
    if (path === ctx.sandbox.workspace) return { output: 'Refusing to delete the workspace root.' }
    const stat = statSync(path)
    if (stat.isDirectory() && readdirSync(path).length) {
      return { output: 'Directory is not empty — delete its files first (or use run_command for a deliberate recursive removal).' }
    }
    const mode = 'hard'
    ctx.locks.acquire(path, ctx.agentId, ctx.agentName, mode)
    try {
      if (stat.isDirectory()) {
        readdirSync(path) // re-check emptiness under the lock
        const entries = readdirSync(path)
        if (entries.length) return { output: 'Directory became non-empty; aborted.' }
        rmdirSafe(path)
      } else {
        unlinkSync(path)
      }
      return { output: `Deleted ${rel(ctx.workspace, path)}.`, data: { path: rel(ctx.workspace, path) } }
    } finally {
      ctx.locks.release(path, ctx.agentId)
    }
  },
}

function rmdirSafe(path: string): void {
  rmdirSync(path)
}

export const readImageTool: ToolDef = {
  name: 'read_image',
  description:
    'Read an image (PNG, JPEG, GIF, WebP) from the workspace and attach it to the conversation so vision-capable models can see it. Text files: use read_file instead.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Image path relative to the workspace' },
    },
    required: ['path'],
  },
  kind: 'other',
  readOnly: true,
  async execute(args, ctx): Promise<ToolResult> {
    const path = ctx.sandbox.safePath(String(args.path ?? ''))
    if (!existsSync(path)) return { output: `File not found: ${String(args.path)}` }
    const stat = statSync(path)
    if (stat.isDirectory()) return { output: `${String(args.path)} is a directory.` }
    // A FIFO named "x.png" reports size 0 — readFileSync would block the
    // main process forever. Only regular files are images.
    if (!stat.isFile()) return { output: `Not a regular file: ${String(args.path)}.` }
    const ext = path.slice(path.lastIndexOf('.')).toLowerCase()
    const mime = IMAGE_MIMES[ext]
    if (!mime) return { output: `Unsupported image type "${ext || '(none)'}" — PNG, JPEG, GIF and WebP are supported.` }
    if (statSync(path).size > MAX_IMAGE_BYTES) return { output: `Image too large (${(statSync(path).size / 1048576).toFixed(1)} MB, cap 5 MB).` }
    const data = readFileSync(path)
    const dataUri = `data:${mime};base64,${data.toString('base64')}`
    return {
      output: `Image loaded: ${rel(ctx.workspace, path)} (${(data.length / 1024).toFixed(0)} KB, ${mime}). It is attached to this conversation.`,
      data: { image: { dataUri, mime, path: rel(ctx.workspace, path) } },
    }
  },
}

export const fileTools = [readFileTool, listDirTool, writeFileTool, editFileTool, multiEditTool, deleteFileTool, readImageTool]
