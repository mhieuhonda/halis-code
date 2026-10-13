/**
 * apply_patch — multi-file patch tool. One call can add,
 * update, move or delete several files using the V4A patch format with
 * 4-tier fuzzy context matching. OpenAI models in particular are trained
 * on this format.
 */
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, unlinkSync, statSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import type { ToolContext, ToolDef, ToolResult } from './index'
import { isStateFilePath } from '../file-locking'
import { applyPatch, parsePatch } from '../util/patch'
import { diffStats } from '../util/edit-match'

const INSTRUCTIONS = `Patch format:

*** Begin Patch
*** Add File: path/to/new.txt
+full file content
*** Update File: src/app.ts
*** Move to: src/main.ts
@@ context line
-old line
+new line
*** Delete File: obsolete.txt
*** End Patch`

/**
 * Resolve a patch path through the sandbox jail (lexical + symlink realpath
 * check). A lexical-only check would let `*** Update File: link-outside/x`
 * write through a symlink pointing outside the workspace. Harness state
 * files under .halis/ are off-limits — the same rule write_file enforces.
 */
function resolveInside(ctx: ToolContext, rel: string): string | null {
  try {
    const full = ctx.sandbox.safePath(rel)
    if (isStateFilePath(full)) return null
    return full
  } catch {
    return null
  }
}

export const applyPatchTool: ToolDef = {
  name: 'apply_patch',
  description: `Apply a multi-file patch: add, update, move or delete files in one call. Context lines match fuzzily (trailing whitespace and unicode tolerated). Prefer edit_file for small single-file tweaks; use apply_patch for multi-file or surgical changes.\n\n${INSTRUCTIONS}`,
  parameters: {
    type: 'object',
    properties: {
      patch: { type: 'string', description: 'The full patch text starting with *** Begin Patch' },
    },
    required: ['patch'],
  },
  kind: 'file-write',
  readOnly: false,
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const patchText = String(args.patch ?? '')
    const { sections, errors } = parsePatch(patchText)
    // Surface parse errors even when some sections parsed — a patch that
    // half-parses (e.g. "*** Add File:" followed by a blank line) must not
    // silently apply only the valid-looking parts.
    if (errors.length) {
      return { output: `Invalid patch.\n${errors.join('\n')}\n\n${INSTRUCTIONS}` }
    }

    // Validate every path is inside the workspace before touching anything.
    for (const section of sections) {
      const paths = section.type === 'update' ? [section.path, section.moveTo ?? section.path] : [section.path]
      for (const p of paths) {
        if (isStateFilePath(resolve(ctx.workspace, p))) {
          return { output: `Patch refused: "${p}" is under .halis/ — harness state files are managed by the task-board tools.` }
        }
        if (!resolveInside(ctx, p)) {
          return { output: `Patch path escapes the workspace (or hits a symlink pointing outside): ${p}` }
        }
      }
    }

    // Lock every file we're about to mutate (hard).
    const lockPaths = new Set<string>()
    for (const section of sections) {
      if (section.type === 'update' || section.type === 'delete') lockPaths.add(resolveInside(ctx, section.path)!)
      if (section.type === 'update' && section.moveTo) lockPaths.add(resolveInside(ctx, section.moveTo)!)
      if (section.type === 'add') lockPaths.add(resolveInside(ctx, section.path)!)
    }
    const acquired: Array<{ path: string; mode: 'hard' }> = []
    const previews: Array<{ file: string; before: number; after: number; added: number; removed: number }> = []
    const beforeContents = new Map<string, string>()
    try {
      // Acquisition is inside the try: if a later acquire throws (the file
      // is held by someone else), the earlier hard locks still get released
      // by the finally below instead of leaking until the turn ends.
      for (const path of lockPaths) {
        ctx.locks.acquire(path, ctx.agentId, ctx.agentName, 'hard')
        acquired.push({ path, mode: 'hard' })
      }
      const result = applyPatch({
        sections,
        read: (rel) => {
          const full = resolveInside(ctx, rel)
          if (!full || !existsSync(full)) return { exists: false, content: '' }
          try {
            const content = readFileSync(full, 'utf8')
            beforeContents.set(rel, content)
            return { exists: true, content }
          } catch {
            return { exists: false, content: '' }
          }
        },
        write: (rel, content) => {
          const full = resolveInside(ctx, rel)
          if (!full) throw new Error(`Path escapes workspace: ${rel}`)
          if (content === null) {
            if (existsSync(full)) unlinkSync(full)
            return
          }
          const dir = dirname(full)
          if (existsSync(dir) && !statSync(dir).isDirectory()) {
            throw new Error(`Cannot write ${rel}: "${relative(ctx.workspace, dir)}" already exists as a FILE but a directory is needed at that path. Remove or rename that file first, then retry.`)
          }
          mkdirSync(dir, { recursive: true })
          const tmp = `${full}.halis-tmp`
          writeFileSync(tmp, content, 'utf8')
          renameSync(tmp, full)
        },
      })

      for (const section of sections) {
        if (section.type !== 'update') continue
        const target = section.moveTo ?? section.path
        const full = resolveInside(ctx, target)
        if (!full || !existsSync(full)) continue
        try {
          const after = readFileSync(full, 'utf8')
          const stat = diffStats(beforeContents.get(section.path) ?? '', after)
          previews.push({ file: target, before: (beforeContents.get(section.path) ?? '').length, after: after.length, added: stat.additions, removed: stat.deletions })
        } catch {
          /* preview is best-effort */
        }
      }

      if (!result.success && result.failedPath) {
        return { output: `${result.output}\n\nPatch format reference:\n${INSTRUCTIONS}` }
      }
      const relNames = result.files.map((f) => relative(ctx.workspace, resolveInside(ctx, f) ?? f))
      return {
        output: `${result.output}\nFiles touched: ${relNames.join(', ') || '(none)'}`,
        data: { files: relNames, previews },
      }
    } finally {
      for (const lock of acquired) ctx.locks.release(lock.path, ctx.agentId)
    }
  },
}

export const patchTools = [applyPatchTool]
