/**
 * apply_patch — ported from opencode's Patch (util/patch.ts) design:
 * parses the `*** Begin Patch` V4A-ish format, applies hunks to files with
 * a 4-tier fuzzy context match (exact → rstrip → trim → unicode-normalized),
 * supports Add / Update / Delete File, `*** Move to:` renames and the
 * `*** End of File` anchor. Returns per-file results and never throws for
 * per-file failures — callers decide how to report partial success.
 */

import { splitKeepEndings } from './edit-match'

export interface PatchAddFile {
  type: 'add'
  path: string
  content: string
}

export interface PatchDeleteFile {
  type: 'delete'
  path: string
}

export interface PatchUpdateFile {
  type: 'update'
  path: string
  moveTo?: string
  chunks: PatchChunk[]
}

export interface PatchChunk {
  oldLines: string[]
  newLines: string[]
  changedLine: number | null
  contextText: string
  isEndOfFile: boolean
}

export type PatchSection = PatchAddFile | PatchDeleteFile | PatchUpdateFile

export interface PatchApplyResult {
  success: boolean
  output: string
  files: string[]
  failedPath?: string
}

/* ------------------------------------------------------------------ */
/* Parsing                                                            */
/* ------------------------------------------------------------------ */

function stripHeredoc(patch: string): string {
  // Models sometimes wrap the patch in a shell heredoc — accept and strip it.
  const m = patch.match(/^\s*cat\s+(?:<<-?|<<\s*)['"]?(\w+)['"]?\s*\n([\s\S]*?)\n\1\s*$/)
  return m ? (m[2] ?? patch) : patch
}

export function parsePatch(patchText: string): { sections: PatchSection[]; errors: string[] } {
  const text = stripHeredoc(patchText.replace(/\r\n/g, '\n'))
  const lines = text.split('\n')
  const sections: PatchSection[] = []
  const errors: string[] = []

  let i = 0
  while (i < lines.length && lines[i]?.trim() !== '*** Begin Patch') i++
  if (i === lines.length) return { sections, errors: ['Patch must start with "*** Begin Patch".'] }
  i++

  while (i < lines.length) {
    const line = lines[i] ?? ''
    const trimmed = line.trim()
    if (trimmed === '*** End Patch') break

    let m = trimmed.match(/^\*\*\* Add File: (.+)$/)
    if (m) {
      const path = m[1]!.trim()
      i++
      const content: string[] = []
      let started = false
      while (i < lines.length) {
        const line = lines[i]!
        if (line.startsWith('+') || line === '+') {
          started = true
          content.push(line.slice(1))
          i++
          continue
        }
        // A blank line before any + line is a formatting separator models
        // emit after the header — skip it instead of ending the collector.
        if (!started && line.trim() === '') {
          i++
          continue
        }
        // A blank line after content started is an empty content line when
        // another + line follows (multi-paragraph files), otherwise it ends
        // the section. Without the lookahead, every paragraph break after
        // the first would silently TRUNCATE the added file.
        if (started && line.trim() === '' && (lines[i + 1]?.startsWith('+') || lines[i + 1] === '+')) {
          content.push('')
          i++
          continue
        }
        break
      }
      // Never queue a section for a failed Add File — pushing an empty
      // section here would let the patch apply a newline-only file while
      // the error itself went unreported.
      if (!content.length) {
        errors.push(`Add File "${path}": no + lines found.`)
      } else {
        sections.push({ type: 'add', path, content: content.join('\n') + '\n' })
      }
      continue
    }

    m = trimmed.match(/^\*\*\* Delete File: (.+)$/)
    if (m) {
      sections.push({ type: 'delete', path: m[1]!.trim() })
      i++
      continue
    }

    m = trimmed.match(/^\*\*\* Update File: (.+)$/)
    if (m) {
      const path = m[1]!.trim()
      i++
      let moveTo: string | undefined
      const chunks: PatchChunk[] = []
      while (i < lines.length) {
        const t = lines[i]?.trim() ?? ''
        const mv = t.match(/^\*\*\* Move to: (.+)$/)
        if (mv) {
          moveTo = mv[1]!.trim()
          i++
          continue
        }
        if (t.startsWith('*** ')) break
        const chunk = parseChunk(lines, i)
        if (!chunk) break
        chunks.push(chunk.chunk)
        i = chunk.next
      }
      if (!chunks.length) errors.push(`Update File "${path}": no @@ hunks found.`)
      sections.push({ type: 'update', path, moveTo, chunks })
      continue
    }

    // Unknown line inside the patch — skip it (defensive; some models add prose).
    i++
  }
  return { sections, errors }
}

function parseChunk(lines: string[], start: number): { chunk: PatchChunk; next: number } | null {
  const contextMatch = lines[start]?.match(/^@@\s*(.*)$/)
  if (!contextMatch) return null
  const contextText = contextMatch[1] ?? ''
  let i = start + 1
  const oldLines: string[] = []
  const newLines: string[] = []
  let changedLine: number | null = null
  let isEndOfFile = false

  if (lines[i]?.trim() === '*** End of File') {
    isEndOfFile = true
    i++
  }
  while (i < lines.length) {
    const line = lines[i] ?? ''
    if (line.trim() === '*** End of File') {
      // The anchor may trail the hunk body — either position marks an
      // end-of-file anchored chunk.
      isEndOfFile = true
      i++
      break
    }
    if (line.startsWith('@@') || line.trim().startsWith('*** ')) break
    if (line.startsWith('+')) {
      newLines.push(line.slice(1))
      if (changedLine === null) changedLine = oldLines.length
      i++
    } else if (line.startsWith('-')) {
      oldLines.push(line.slice(1))
      changedLine = null // deletions reset insertion anchor; re-derive later
      i++
    } else if (line.startsWith(' ')) {
      oldLines.push(line.slice(1))
      newLines.push(line.slice(1))
      i++
    } else if (line === '') {
      // bare empty line = context line with empty content
      oldLines.push('')
      newLines.push('')
      i++
    } else {
      break
    }
  }
  return { chunk: { oldLines, newLines, changedLine, contextText, isEndOfFile }, next: i }
}

/* ------------------------------------------------------------------ */
/* Fuzzy matching                                                     */
/* ------------------------------------------------------------------ */

type Compare = (line: string) => string

const compares: Array<{ name: string; fn: Compare }> = [
  { name: 'exact', fn: (l) => l },
  { name: 'rstrip', fn: (l) => l.replace(/\s+$/, '') },
  { name: 'trim', fn: (l) => l.trim() },
]

function normalizeUnicode(s: string): string {
  return s
    .normalize('NFC')
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/[\u00A0\u2000-\u200B]/g, ' ')
}

/** Find the offset in `lines` where `pattern` matches, escalating fuzziness. */
export function deriveState(lines: string[], pattern: string[], eof: boolean): number {
  if (!pattern.length) return -1
  const searchStart = eof ? Math.max(0, lines.length - pattern.length) : 0
  const searchEnd = eof ? lines.length - pattern.length : lines.length - pattern.length
  for (const { fn } of compares) {
    const normalized = fn
    const p = pattern.map(normalized)
    for (let offset = Math.max(0, searchStart); offset <= Math.max(-1, searchEnd); offset++) {
      let ok = true
      for (let j = 0; j < p.length; j++) {
        if (normalized(lines[offset + j] ?? '') !== p[j]) {
          ok = false
          break
        }
      }
      if (ok) return offset
    }
  }
  // Tier 4: unicode-normalized comparison.
  const p = pattern.map((l) => normalizeUnicode(l).trim())
  for (let offset = Math.max(0, searchStart); offset <= Math.max(-1, searchEnd); offset++) {
    let ok = true
    for (let j = 0; j < p.length; j++) {
      if (normalizeUnicode(lines[offset + j] ?? '').trim() !== p[j]) {
        ok = false
        break
      }
    }
    if (ok) return offset
  }
  return -1
}

/* ------------------------------------------------------------------ */
/* Apply                                                              */
/* ------------------------------------------------------------------ */

export interface PatchFileSource {
  exists: boolean
  content: string
}

export interface PatchApplyInput {
  sections: PatchSection[]
  /** Read the current content of a workspace-relative path. */
  read: (path: string) => PatchFileSource
  /** Persist the new content (or delete) of a workspace-relative path. */
  write: (path: string, content: string | null) => void
}

export function applyPatch(input: PatchApplyInput): PatchApplyResult {
  const done: string[] = []
  let failedPath: string | undefined
  let failure = ''

  for (const section of input.sections) {
    try {
      if (section.type === 'add') {
        const source = input.read(section.path)
        if (source.exists) throw new Error(`File already exists: ${section.path}`)
        input.write(section.path, section.content)
        done.push(section.path)
      } else if (section.type === 'delete') {
        const source = input.read(section.path)
        if (!source.exists) throw new Error(`File not found: ${section.path}`)
        input.write(section.path, null)
        done.push(section.path)
      } else {
        const source = input.read(section.path)
        if (!source.exists) throw new Error(`File not found: ${section.path}`)
        // Preserve the file's line endings PER LINE: a mixed CRLF/LF file
        // (git autocrlf quirks, cross-platform commits) must not have its
        // untouched lines rewritten to the majority ending — that would
        // show the WHOLE file as changed to git. edit_file already goes to
        // great lengths to preserve these — the patch path must not be the
        // odd one out.
        const split = splitKeepEndings(source.content)
        const endings = split.endings
        let lines = split.lines
        // Drop the trailing empty artifact produced by a final newline so
        // EOF-anchored context offsets stay consistent with the old parser.
        if (lines.length >= 2 && lines[lines.length - 1] === '') {
          lines = lines.slice(0, -1)
          endings.length = lines.length
        }

        for (const chunk of section.chunks) {
          const pattern = chunk.oldLines
          const useEof = chunk.isEndOfFile
          let offset: number
          if (useEof && !pattern.length) {
            offset = lines.length
          } else if (useEof) {
            // anchor at the end: the context lines must match the tail
            const tail = lines.slice(lines.length - pattern.length)
            const normalizedPattern = pattern.map((l) => normalizeUnicode(l).trim())
            const tailOk = pattern.every((_, j) => normalizeUnicode(tail[j] ?? '').trim() === normalizedPattern[j])
            if (!tailOk) throw new Error(`End-of-file context not found near the end of ${section.path}:\n${chunk.contextText || pattern.join('\n')}`)
            offset = lines.length - pattern.length
          } else {
            offset = deriveState(lines, pattern, false)
            if (offset < 0) {
              throw new Error(`Could not find context in ${section.path}:\n${pattern.join('\n')}`)
            }
          }
          const oldCount = pattern.length
          // Same splice semantics as edit-match: intermediate new lines take
          // the block's leading ending (never '' — that would fuse lines when
          // the block sits on the file's last, newline-less line); the last
          // new line inherits the block's final ending so the boundary with
          // the following line is preserved.
          const blockEnding = endings[offset] ?? '\n'
          const lastOldEnding = endings[offset + oldCount - 1] ?? blockEnding
          const newEndings = chunk.newLines.map(() => blockEnding || '\n')
          if (newEndings.length) newEndings[newEndings.length - 1] = lastOldEnding
          if (oldCount === 0 && offset > 0 && endings[offset - 1] === '') {
            // Pure append onto a newline-less last line: supply the separator
            // the old join() provided, or the first new line fuses onto it.
            endings[offset - 1] = blockEnding || '\n'
          }
          const head = lines.slice(0, offset)
          const headEndings = endings.slice(0, offset)
          const tail = lines.slice(offset + oldCount)
          const tailEndings = endings.slice(offset + oldCount)
          lines = [...head, ...chunk.newLines, ...tail]
          endings.length = 0
          endings.push(...headEndings, ...newEndings, ...tailEndings)
        }

        const targetPath = section.moveTo ?? section.path
        const content = lines.map((l, i) => l + (endings[i] ?? '')).join('')
        if (section.moveTo && section.moveTo !== section.path) {
          input.write(section.path, null)
          input.write(targetPath, content)
          done.push(section.path, targetPath)
        } else {
          input.write(section.path, content)
          done.push(section.path)
        }
      }
    } catch (err) {
      failedPath = section.path
      failure = err instanceof Error ? err.message : String(err)
      break
    }
  }

  const parts: string[] = []
  if (done.length) parts.push(`Applied to: ${[...new Set(done)].join(', ')}`)
  if (failure) parts.push(`Failed at "${failedPath}": ${failure}`)
  if (done.length && failure) parts.push('Completed before failure files remain changed.')

  return {
    success: !failure,
    output: parts.join('\n') || 'Nothing to apply.',
    files: [...new Set(done)],
    failedPath,
  }
}
