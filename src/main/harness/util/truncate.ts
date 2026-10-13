/**
 * Global tool-output truncation.
 * Every tool result passes through here: text beyond the caps is clipped
 * and the full output is spilled to a file the model can re-read with
 * read_file. Applies a uniform context budget across all tools.
 */
import { mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const TOOL_OUTPUT_MAX_LINES = 2_000
export const TOOL_OUTPUT_MAX_BYTES = 50 * 1024

/** Spill files older than this are pruned (the model re-reads them
 * essentially immediately or never — nothing should grow unbounded inside
 * the user's workspace for months). */
const SPILL_MAX_AGE_MS = 48 * 60 * 60 * 1000

let spillDir: string | null = null
let counter = 0

/** Best-effort pruning of stale spill files (every ~50 spills, not every write). */
function pruneSpillDir(): void {
  if (!spillDir) return
  try {
    const cutoff = Date.now() - SPILL_MAX_AGE_MS
    for (const name of readdirSync(spillDir)) {
      if (!name.endsWith('.txt')) continue
      try {
        const file = join(spillDir, name)
        if (statSync(file).mtimeMs < cutoff) unlinkSync(file)
      } catch {
        /* raced away — fine */
      }
    }
  } catch {
    /* best effort */
  }
}

export function setToolOutputSpillDir(dir: string): void {
  spillDir = dir
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    /* best effort */
  }
}

export interface TruncationResult {
  text: string
  truncated: boolean
  spillPath?: string
}

export function truncateToolOutput(output: string, toolCallId: string): TruncationResult {
  // Budget is in BYTES (context windows are token/byte-shaped, not
  // UTF-16-code-unit-shaped): .length under-counts multibyte text up to 3x.
  if (Buffer.byteLength(output, 'utf8') <= TOOL_OUTPUT_MAX_BYTES) return { text: output, truncated: false }

  const lines = output.split('\n')
  let text = lines.slice(0, TOOL_OUTPUT_MAX_LINES).join('\n')
  if (Buffer.byteLength(text, 'utf8') > TOOL_OUTPUT_MAX_BYTES) {
    // Clip by bytes without splitting a UTF-8 sequence: back off from the
    // cap to the last non-continuation byte, or the cut decodes to U+FFFD
    // replacement characters at the tail.
    const buf = Buffer.from(text, 'utf8')
    let end = TOOL_OUTPUT_MAX_BYTES
    while (end > 0 && (buf[end - 1]! & 0b1100_0000) === 0b1000_0000) end--
    text = buf.subarray(0, end).toString('utf8')
  }

  let spillPath: string | undefined
  if (spillDir) {
    try {
      counter++
      // The id alone can collide across agents/sessions (local backends emit
      // sequential "call_0", "call_1"…) — a second spill would overwrite the
      // first and the model would read ANOTHER tool's output. Prefix with
      // monotonic counters so every file is unique.
      const safeId = toolCallId.replace(/[^\w-]/g, '')
      spillPath = join(spillDir, `tool_${counter}_${Date.now().toString(36)}_${safeId}.txt`)
      writeFileSync(spillPath, output, 'utf8')
      if (counter % 50 === 0) pruneSpillDir()
    } catch {
      spillPath = undefined
    }
  }

  const totalLines = lines.length
  const marker = spillPath
    ? `[Output truncated: showing the first portion of ${totalLines} lines. Full output saved to: ${spillPath} — read it with read_file if you need more.]`
    : `[Output truncated: showing the first portion of ${totalLines} lines.]`
  return { text: `${text}\n${marker}`, truncated: true, spillPath }
}
