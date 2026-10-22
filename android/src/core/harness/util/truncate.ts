/**
 * Global tool-output truncation (mobile). Text beyond the caps is clipped;
 * there is no spill file on the phone — the marker simply says the rest was
 * dropped, so the model asks a narrower question instead.
 */

export const TOOL_OUTPUT_MAX_LINES = 2_000
export const TOOL_OUTPUT_MAX_BYTES = 50 * 1024

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export interface TruncationResult {
  text: string
  truncated: boolean
}

export function truncateToolOutput(output: string, _toolCallId: string): TruncationResult {
  void _toolCallId
  // Budget is in BYTES (context windows are token/byte-shaped, not
  // UTF-16-code-unit-shaped): .length under-counts multibyte text up to 3x.
  if (encoder.encode(output).byteLength <= TOOL_OUTPUT_MAX_BYTES) return { text: output, truncated: false }

  const lines = output.split('\n')
  let text = lines.slice(0, TOOL_OUTPUT_MAX_LINES).join('\n')
  const buf = encoder.encode(text)
  if (buf.byteLength > TOOL_OUTPUT_MAX_BYTES) {
    // Clip by bytes without splitting a UTF-8 sequence: back off from the
    // cap while byte[end-1] is a CONTINUATION byte.
    let end = TOOL_OUTPUT_MAX_BYTES
    while (end > 0 && (buf[end - 1]! & 0b1100_0000) === 0b1000_0000) end--
    text = decoder.decode(buf.subarray(0, end))
  }

  const totalLines = lines.length
  const marker = `[Output truncated: showing the first portion of ${totalLines} lines.]`
  return { text: `${text}\n${marker}`, truncated: true }
}
