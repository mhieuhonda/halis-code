/**
 * File tools: read, write, edit, list — all path-jailed to the workspace and
 * coordinated through the file-lock manager.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import type { ToolContext, ToolDef, ToolResult } from './index'
import { isLogLikePath, isStateFilePath } from '../file-locking'

const MAX_READ_CHARS = 200_000
const MAX_LS_ENTRIES = 500

function rel(ws: string, p: string): string {
  const r = relative(ws, p)
  return r && !r.startsWith('..') ? r : p
}

function truncate(s: string, max = MAX_READ_CHARS): string {
  if (s.length <= max) return s
  return `${s.slice(0, max)}\n… (truncated, ${s.length - max} more characters — read with offset/limit)`
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
    if (!existsSync(path)) return { output: `File not found: ${String(args.path)}` }
    const stat = statSync(path)
    if (stat.isDirectory()) {
      return { output: `${String(args.path)} is a directory. Use list_dir instead.` }
    }
    if (stat.size > 8 * 1024 * 1024) return { output: `File too large (${(stat.size / 1048576).toFixed(1)} MB).` }
    const content = readFileSync(path, 'utf8')
    const lines = content.split('\n')
    const offset = Math.max(1, Number(args.offset ?? 1))
    const limit = Math.min(Number(args.limit ?? 2000), 2000)
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
      const before = existed ? readFileSync(path, 'utf8') : ''
      const dir = dirname(path)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      const tmp = `${path}.halis-tmp`
      writeFileSync(tmp, content, 'utf8')
      renameSync(tmp, path)
      const lines = content.split('\n').length
      return {
        output: `${existed ? 'Overwrote' : 'Created'} ${rel(ctx.workspace, path)} (${lines} lines, ${content.length} chars).${lockResult.warning ? ` ${lockResult.warning}` : ''}`,
        data: { path: rel(ctx.workspace, path), existed, beforeChars: before.length, afterChars: content.length },
      }
    } finally {
      if (mode === 'hard') ctx.locks.release(path, ctx.agentId)
    }
  },
}

export const editFileTool: ToolDef = {
  name: 'edit_file',
  description:
    'Edit a file by replacing an exact string. old_string must match the file content exactly (including whitespace). Use replace_all to replace every occurrence.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path relative to the workspace' },
      old_string: { type: 'string', description: 'Exact text to replace' },
      new_string: { type: 'string', description: 'Replacement text' },
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
    if (!oldString) return { output: 'old_string is empty — refusing to edit.' }

    const mode = isLogLikePath(path) ? 'advisory' : 'hard'
    const lockResult = ctx.locks.acquire(path, ctx.agentId, ctx.agentName, mode)
    try {
      const content = readFileSync(path, 'utf8')
      const occurrences = content.split(oldString).length - 1
      if (occurrences === 0) {
        return {
          output: `old_string not found in ${rel(ctx.workspace, path)}. Read the file again and copy the exact text.`,
        }
      }
      if (occurrences > 1 && !args.replace_all) {
        return { output: `old_string occurs ${occurrences} times. Provide more context or set replace_all: true.` }
      }
      const updated = args.replace_all ? content.split(oldString).join(newString) : content.replace(oldString, newString)
      const tmp = `${path}.halis-tmp`
      writeFileSync(tmp, updated, 'utf8')
      renameSync(tmp, path)
      return {
        output: `Edited ${rel(ctx.workspace, path)}: ${args.replace_all ? occurrences : 1} replacement(s).${lockResult.warning ? ` ${lockResult.warning}` : ''}`,
        data: { path: rel(ctx.workspace, path), replacements: args.replace_all ? occurrences : 1, oldString, newString },
      }
    } finally {
      if (mode === 'hard') ctx.locks.release(path, ctx.agentId)
    }
  },
}

export const fileTools = [readFileTool, listDirTool, writeFileTool, editFileTool]
