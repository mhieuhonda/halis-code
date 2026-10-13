/**
 * Fuzzy string replacement for edit tools — ported from opencode's edit
 * matching: literal → unicode-normalized → line-based (trailing whitespace
 * + CRLF tolerant). Also carries a small line-diff generator used for
 * approval previews and change summaries.
 */

function normalizeForMatch(s: string): string {
  return s
    .normalize('NFC')
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/[\u00A0\u2000-\u200B]/g, ' ')
}

export interface FuzzyMatchResult {
  /** New content with the replacement applied, or null when not found. */
  content: string | null
  occurrences: number
  /** How the match was made — useful for honest tool output. */
  strategy: 'exact' | 'normalized' | 'line-based' | 'none'
}

export function splitKeepEndings(content: string): { lines: string[]; endings: string[] } {
  // endings[i] is the newline that FOLLOWS lines[i] ('' after the last line).
  // Keeping them per line preserves mixed CRLF/LF files byte-for-byte
  // outside the replaced span.
  const lines: string[] = []
  const endings: string[] = []
  let rest = content
  for (;;) {
    const idx = rest.indexOf('\n')
    if (idx === -1) {
      lines.push(rest)
      endings.push('')
      break
    }
    const line = rest.slice(0, idx)
    if (line.endsWith('\r')) {
      lines.push(line.slice(0, -1))
      endings.push('\r\n')
    } else {
      lines.push(line)
      endings.push('\n')
    }
    rest = rest.slice(idx + 1)
  }
  return { lines, endings }
}

export function fuzzyReplace(content: string, oldString: string, newString: string, replaceAll: boolean): FuzzyMatchResult {
  // Tier 1 — exact.
  const exactCount = content.split(oldString).length - 1
  if (exactCount > 0) {
    if (exactCount > 1 && !replaceAll) return { content: null, occurrences: exactCount, strategy: 'exact' }
    // Function replacement: a string replacement would interpret $&, $`, $'
    // and $$ patterns inside newString and silently corrupt the file.
    const updated = replaceAll ? content.split(oldString).join(newString) : content.replace(oldString, () => newString)
    return { content: updated, occurrences: exactCount, strategy: 'exact' }
  }

  // Tier 2 — unicode-normalized needle, matched LINE-WISE against the
  // normalized lines but spliced into the ORIGINAL content, so everything
  // outside the replaced span keeps its exact bytes (smart quotes, NBSP,
  // NFD forms elsewhere in the file must survive the edit).
  const { lines, endings } = splitKeepEndings(content)
  // Keep each line's original terminator inside the comparison: a \n needle
  // must NOT match a \r\n file here — that case belongs to tier 3, which
  // reports it honestly as 'line-based'.
  const normLines = lines.map((l, i) => normalizeForMatch(l + (endings[i] === '\r\n' ? '\r' : '')))
  const oldLines = normalizeForMatch(oldString).split('\n')
  const newLines = newString.split('\n')
  const matchesAt: number[] = []
  for (let i = 0; i + oldLines.length <= normLines.length; i++) {
    let ok = true
    for (let j = 0; j < oldLines.length; j++) {
      if (normLines[i + j] !== oldLines[j]) {
        ok = false
        break
      }
    }
    if (ok) matchesAt.push(i)
  }
  if (matchesAt.length > 0) {
    if (matchesAt.length > 1 && !replaceAll) return { content: null, occurrences: matchesAt.length, strategy: 'normalized' }
    const targets = replaceAll ? matchesAt : [matchesAt[0]!]
    for (const at of [...targets].sort((a, b) => b - a)) {
      spliceLines(lines, endings, at, oldLines.length, newLines)
    }
    return { content: lines.map((l, i) => l + (endings[i] ?? '')).join(''), occurrences: targets.length, strategy: 'normalized' }
  }

  // Tier 3 — line-based match (trailing whitespace differences tolerated).
  const strip = (s: string) => s.replace(/\s+$/, '')
  const oldLinesT = normalizeForMatch(oldString).split('\n')

  const lineMatchesAt: number[] = []
  for (let i = 0; i + oldLinesT.length <= lines.length; i++) {
    let ok = true
    for (let j = 0; j < oldLinesT.length; j++) {
      if (strip(lines[i + j] ?? '') !== strip(oldLinesT[j] ?? '')) {
        ok = false
        break
      }
    }
    if (ok) lineMatchesAt.push(i)
  }

  if (lineMatchesAt.length === 0) return { content: null, occurrences: 0, strategy: 'none' }
  if (lineMatchesAt.length > 1 && !replaceAll) return { content: null, occurrences: lineMatchesAt.length, strategy: 'line-based' }

  const targets = replaceAll ? lineMatchesAt : [lineMatchesAt[0]!]
  // Replace from the end so indices stay valid.
  for (const at of [...targets].sort((a, b) => b - a)) {
    spliceLines(lines, endings, at, oldLinesT.length, newString.split('\n'))
  }
  return { content: lines.map((l, i) => l + (endings[i] ?? '')).join(''), occurrences: targets.length, strategy: 'line-based' }
}

/**
 * Replace oldCount lines at `at` with `newLines`, keeping the per-line
 * endings of everything around them. New lines inherit the block's original
 * line ending; the boundary with the following line is preserved.
 */
function spliceLines(lines: string[], endings: string[], at: number, oldCount: number, newLines: string[]): void {
  const blockEnding = endings[at] ?? '\n'
  const lastOldEnding = endings[at + oldCount - 1] ?? ''
  // Intermediate new lines need a real separator: blockEnding may be '' when
  // the old block is the file's last line without a trailing newline —
  // filling with '' would fuse the replacement lines together.
  const newEndings = new Array<string>(newLines.length).fill(blockEnding || '\n')
  if (newEndings.length) newEndings[newEndings.length - 1] = lastOldEnding
  lines.splice(at, oldCount, ...newLines)
  endings.splice(at, oldCount, ...newEndings)
}

/* ------------------------------------------------------------------ */
/* Line diff (unified format, no dependency)                          */
/* ------------------------------------------------------------------ */

export interface LineDiffStats {
  additions: number
  deletions: number
}

/** Classic LCS line diff — fine for the sizes agents edit. */
export function diffLines(before: string, after: string): Array<{ type: 'add' | 'del' | 'same'; line: string }> {
  const a = before.replace(/\r\n/g, '\n').split('\n')
  const b = after.replace(/\r\n/g, '\n').split('\n')
  const n = a.length
  const m = b.length
  // Guard against pathological sizes.
  if (n * m > 4_000_000) {
    return [
      ...a.slice(0, 1000).map((line) => ({ type: 'del' as const, line })),
      ...b.slice(0, 1000).map((line) => ({ type: 'add' as const, line })),
    ]
  }
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? (dp[i + 1]![j + 1] ?? 0) + 1 : Math.max(dp[i + 1]![j] ?? 0, dp[i]![j + 1] ?? 0)
    }
  }
  const out: Array<{ type: 'add' | 'del' | 'same'; line: string }> = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'same', line: a[i]! })
      i++
      j++
    } else if ((dp[i + 1]![j] ?? 0) >= (dp[i]![j + 1] ?? 0)) {
      out.push({ type: 'del', line: a[i]! })
      i++
    } else {
      out.push({ type: 'add', line: b[j]! })
      j++
    }
  }
  while (i < n) out.push({ type: 'del', line: a[i++]! })
  while (j < m) out.push({ type: 'add', line: b[j++]! })
  return out
}

export function diffStats(before: string, after: string): LineDiffStats {
  let additions = 0
  let deletions = 0
  for (const entry of diffLines(before, after)) {
    if (entry.type === 'add') additions++
    else if (entry.type === 'del') deletions++
  }
  return { additions, deletions }
}

/** Compact unified diff for previews (context lines capped). */
export function unifiedDiff(before: string, after: string, context = 3, maxLines = 400): string {
  const entries = diffLines(before, after)
  const out: string[] = []
  let pendingAdds = 0
  let pendingDels = 0
  for (const entry of entries) {
    if (entry.type === 'add') {
      out.push(`+${entry.line}`)
      pendingAdds++
      pendingDels = 0
    } else if (entry.type === 'del') {
      out.push(`-${entry.line}`)
      pendingDels++
      pendingAdds = 0
    } else {
      pendingAdds = 0
      pendingDels = 0
      out.push(` ${entry.line}`)
    }
    if (out.length >= maxLines) break
  }
  void context
  return out.join('\n')
}
