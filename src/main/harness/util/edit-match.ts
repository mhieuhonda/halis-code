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

function splitKeepEndings(content: string): { lines: string[]; ending: '\r\n' | '\n' } {
  const ending: '\r\n' | '\n' = content.includes('\r\n') ? '\r\n' : '\n'
  const lines = content.split(/\r?\n/)
  return { lines, ending }
}

export function fuzzyReplace(content: string, oldString: string, newString: string, replaceAll: boolean): FuzzyMatchResult {
  // Tier 1 — exact.
  const exactCount = content.split(oldString).length - 1
  if (exactCount > 0) {
    if (exactCount > 1 && !replaceAll) return { content: null, occurrences: exactCount, strategy: 'exact' }
    const updated = replaceAll ? content.split(oldString).join(newString) : content.replace(oldString, newString)
    return { content: updated, occurrences: exactCount, strategy: 'exact' }
  }

  // Tier 2 — unicode-normalized needle on normalized haystack.
  const normalizedContent = normalizeForMatch(content)
  const normalizedOld = normalizeForMatch(oldString)
  const normalizedNew = normalizeForMatch(newString)
  const normalizedCount = normalizedContent.split(normalizedOld).length - 1
  if (normalizedCount > 0) {
    if (normalizedCount > 1 && !replaceAll) return { content: null, occurrences: normalizedCount, strategy: 'normalized' }
    const updated = replaceAll
      ? normalizedContent.split(normalizedOld).join(normalizedNew)
      : normalizedContent.replace(normalizedOld, normalizedNew)
    return { content: updated, occurrences: normalizedCount, strategy: 'normalized' }
  }

  // Tier 3 — line-based match (trailing whitespace differences tolerated).
  const { lines, ending } = splitKeepEndings(content)
  const oldLines = normalizeForMatch(oldString).split('\n')
  const newLines = normalizeForMatch(newString).split('\n')
  const strip = (s: string) => s.replace(/\s+$/, '')

  const matchesAt: number[] = []
  for (let i = 0; i + oldLines.length <= lines.length; i++) {
    let ok = true
    for (let j = 0; j < oldLines.length; j++) {
      if (strip(lines[i + j] ?? '') !== strip(oldLines[j] ?? '')) {
        ok = false
        break
      }
    }
    if (ok) matchesAt.push(i)
  }

  if (matchesAt.length === 0) return { content: null, occurrences: 0, strategy: 'none' }
  if (matchesAt.length > 1 && !replaceAll) return { content: null, occurrences: matchesAt.length, strategy: 'line-based' }

  const targets = replaceAll ? matchesAt : [matchesAt[0]!]
  // Replace from the end so indices stay valid.
  for (const at of [...targets].sort((a, b) => b - a)) {
    lines.splice(at, oldLines.length, ...newLines)
  }
  return { content: lines.join(ending), occurrences: targets.length, strategy: 'line-based' }
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
