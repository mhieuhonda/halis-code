/** Unified diff renderer for write_file / edit_file tool bodies. */
import { useMemo } from 'react'

interface DiffLine {
  kind: 'add' | 'del' | 'ctx' | 'hunk'
  text: string
}

const CONTEXT = 2

/**
 * Best-effort unified diff parser. Accepts real unified diffs and falls
 * back to a two-file naive diff when the tool hands us old/new text.
 */
function parseUnifiedDiff(diff: string): DiffLine[] {
  const out: DiffLine[] = []
  let sawHunk = false
  for (const line of diff.split('\n')) {
    // `\ No newline at end of file` markers are metadata, not content.
    if (line.startsWith('\\')) continue
    // File headers only count BEFORE the first hunk: a deleted line whose
    // original text starts with `-- ` serializes to `--- …` and must NOT be
    // swallowed as a header (same for added `++ …`).
    if (!sawHunk && (line.startsWith('--- ') || line.startsWith('+++ ') || line.startsWith('index ') || line.startsWith('diff '))) continue
    if (line.startsWith('@@')) {
      sawHunk = true
      out.push({ kind: 'hunk', text: line })
    } else if (line.startsWith('+')) out.push({ kind: 'add', text: line.slice(1) })
    else if (line.startsWith('-')) out.push({ kind: 'del', text: line.slice(1) })
    else out.push({ kind: 'ctx', text: line.replace(/^ /, '') })
  }
  return out
}

/** Naive LCS line diff — fine for the file sizes tools actually write. */
function lineDiff(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split('\n')
  const b = newText.split('\n')
  const n = a.length
  const m = b.length
  // LCS table — guard against pathological sizes
  if (n * m > 4_000_000) return [{ kind: 'hunk', text: '@@ large change @@' }, ...b.map((l) => ({ kind: 'add' as const, text: l }))]
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    const ai = a[i]!
    const dpNext = dp[i + 1]!
    const dpCur = dp[i]!
    for (let j = m - 1; j >= 0; j--) {
      dpCur[j] = ai === b[j] ? dpNext[j + 1]! + 1 : Math.max(dpNext[j]!, dpCur[j + 1]!)
    }
  }
  const raw: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      raw.push({ kind: 'ctx', text: a[i]! })
      i++
      j++
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      raw.push({ kind: 'del', text: a[i]! })
      i++
    } else {
      raw.push({ kind: 'add', text: b[j]! })
      j++
    }
  }
  while (i < n) raw.push({ kind: 'del', text: a[i++]! })
  while (j < m) raw.push({ kind: 'add', text: b[j++]! })

  // collapse long runs of unchanged lines around edits
  const out: DiffLine[] = []
  let k = 0
  while (k < raw.length) {
    if (raw[k]!.kind === 'ctx') {
      let end = k
      while (end < raw.length && raw[end]!.kind === 'ctx') end++
      const runLen = end - k
      if (runLen > CONTEXT * 2 + 2) {
        out.push(...raw.slice(k, k + CONTEXT))
        out.push({ kind: 'hunk', text: `⋯ ${runLen - CONTEXT * 2} unchanged` })
        out.push(...raw.slice(end - CONTEXT, end))
      } else {
        out.push(...raw.slice(k, end))
      }
      k = end
    } else {
      out.push(raw[k++]!)
    }
  }
  return out
}

export function DiffView({ diff }: { diff: string }) {
  const lines = useMemo(() => {
    const trimmed = diff.replace(/^\n+/, '')
    // Content-based detection. A real unified diff carries @@ hunk headers;
    // synthetic diffs (lineDiff / write bodies) are bare +/- lines where
    // EVERY non-empty line starts with +, - or a space. Merely containing
    // some -prefixed lines (e.g. markdown with `---` YAML front matter)
    // must NOT trigger diff mode — it would render prose as deletions and
    // inflate the −N counter.
    const rows = trimmed.split('\n')
    const hasHunk = rows.some((l) => l.startsWith('@@'))
    const synthetic =
      !hasHunk &&
      rows.some((l) => /^[+-]/.test(l)) &&
      rows.every((l) => !l.trim() || /^[+\- ]/.test(l))
    if (hasHunk || synthetic) return parseUnifiedDiff(trimmed)
    return [{ kind: 'add' as const, text: trimmed }]
  }, [diff])

  const adds = lines.filter((l) => l.kind === 'add').length
  const dels = lines.filter((l) => l.kind === 'del').length

  return (
    <div className="rounded-lg border-[0.5px] border-[color:var(--dsw-alias-border-l2)] overflow-hidden my-0.5" style={{ background: 'var(--dsw-alias-file-diff-added-gutter)' }}>
      <div className="flex items-center gap-2 px-3 py-1.5 border-b-[0.5px] border-[color:var(--dsw-alias-border-l1)] bg-[var(--dsw-alias-bg-layer-1)]">
        <span className="text-[11px] font-mono text-[color:var(--dsw-alias-file-diff-added-marker)]">+{adds}</span>
        <span className="text-[11px] font-mono text-[color:var(--dsw-alias-file-diff-deleted-marker)]">−{dels}</span>
        <span className="text-[10px] text-[color:var(--dsw-alias-label-caption)] font-mono uppercase tracking-wider ml-auto">diff</span>
      </div>
      <div className="max-h-72 overflow-auto py-1">
        {lines.slice(0, 400).map((line, i) => (
          <div key={i} className={`diff-line ${line.kind === 'add' ? 'diff-add' : line.kind === 'del' ? 'diff-del' : line.kind === 'hunk' ? 'diff-hunk' : 'diff-ctx'} px-1`}>
            <span className="diff-sign">{line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : line.kind === 'hunk' ? '@' : ' '}</span>
            <span className="flex-1">{line.text || ' '}</span>
          </div>
        ))}
        {lines.length > 400 ? <div className="diff-line diff-hunk px-3">⋯ {lines.length - 400} more lines</div> : null}
      </div>
    </div>
  )
}

/** Build a diff body from a write/edit tool run's args. */
export function diffForTool(tool: string, args: Record<string, unknown>): string | null {
  if (tool === 'edit_file') {
    const oldText = args.oldText ?? args.old_string ?? args.search
    const newText = args.newText ?? args.new_string ?? args.replace
    if (typeof oldText === 'string' && typeof newText === 'string') return lineDiff(oldText, newText).map((l) => (l.kind === 'add' ? `+${l.text}` : l.kind === 'del' ? `-${l.text}` : ` ${l.text}`)).join('\n')
    if (typeof newText === 'string') return newText.split('\n').map((l) => `+${l}`).join('\n')
  }
  if (tool === 'multi_edit' && Array.isArray(args.edits)) {
    // One diff block per edit pair, separated so each stays readable.
    const blocks: string[] = []
    for (const e of args.edits as Array<Record<string, unknown>>) {
      const oldText = e.old_string ?? e.oldText
      const newText = e.new_string ?? e.newText
      if (typeof oldText === 'string' && typeof newText === 'string') {
        blocks.push(lineDiff(oldText, newText).map((l) => (l.kind === 'add' ? `+${l.text}` : l.kind === 'del' ? `-${l.text}` : ` ${l.text}`)).join('\n'))
      } else if (typeof newText === 'string') {
        blocks.push(newText.split('\n').map((l) => `+${l}`).join('\n'))
      }
    }
    if (blocks.length) return blocks.join('\n@@\n')
  }
  if (tool === 'apply_patch' && typeof args.patch === 'string' && args.patch.trim()) return args.patch
  if (tool === 'write_file' && typeof args.content === 'string') {
    return args.content.split('\n').map((l) => `+${l}`).join('\n')
  }
  if (typeof args.diff === 'string' && args.diff.trim()) return args.diff
  return null
}

export { lineDiff }
