/**
 * Global tool-output truncation — modeled on opencode's tool-output.ts.
 * Every tool result passes through here: text beyond the caps is clipped
 * and the full output is spilled to a file the model can re-read with
 * read_file. Applies a uniform context budget across all tools.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const TOOL_OUTPUT_MAX_LINES = 2_000
export const TOOL_OUTPUT_MAX_BYTES = 50 * 1024

let spillDir: string | null = null
let counter = 0

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
    // Clip by bytes without splitting a UTF-8 sequence.
    const buf = Buffer.from(text, 'utf8')
    text = buf.subarray(0, TOOL_OUTPUT_MAX_BYTES).toString('utf8')
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
