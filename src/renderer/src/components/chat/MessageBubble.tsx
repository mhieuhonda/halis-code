/**
 * Message rendering — DSH layout:
 * - user    → right-aligned deep-blue bubble, 20px radius
 * - agent   → open markdown from the left (identity row only in swarm mode)
 * - system  → quiet centered pill
 */
import { useMemo, useState } from 'react'
import { ArrowRight, Check, Copy } from 'lucide-react'
import type { ChatMessage, ReceiptRef, ToolRun } from '@shared/types'
import { useT } from '../../i18n'
import { ShimmerText } from '../ui'
import { Markdown } from '../Markdown'
import { ToolCard } from './ToolCard'
import { ReceiptChip } from '../telegraph/ReceiptChip'
import logoUrl from '../../assets/logo.png'

function findReceipts(message: ChatMessage): ReceiptRef[] {
  const out: ReceiptRef[] = []
  for (const part of message.parts ?? []) {
    if (part.type === 'receipt') out.push(part.receipt)
  }
  return out
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

export function MessageBubble({ message, swarm, nameOf }: { message: ChatMessage; swarm: boolean; nameOf: (id: string) => string }) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system' || message.from === 'system'
  const color = message.agentColor ?? '#81858C'

  const receipts = useMemo(() => findReceipts(message), [message])
  const toolRuns: ToolRun[] = useMemo(
    () => (message.parts ?? []).filter((p): p is { type: 'tool'; run: ToolRun } => p.type === 'tool').map((p) => p.run),
    [message],
  )

  const copyAll = () => {
    void navigator.clipboard.writeText(message.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }

  // Highlight @mentions in swarm text — but only OUTSIDE fenced code blocks.
  // Splitting blindly chopped fences at every `@` inside code (decorators,
  // emails), leaving broken half-fences on both sides of a false mention.
  // Consecutive non-mention fragments are merged into ONE Markdown run so
  // fenced code blocks and GFM tables stay intact across the mention.
  const rendered = useMemo(() => {
    if (!swarm || isSystem) return <Markdown>{message.content}</Markdown>
    if (!message.content.includes('@')) return <Markdown>{message.content}</Markdown>
    const fragments: Array<{ text: string; mention: boolean }> = []
    let fence = false
    for (const line of message.content.split('\n')) {
      if (/^\s*(```|~~~)/.test(line)) fence = !fence
      if (fence) {
        fragments.push({ text: line + '\n', mention: false })
        continue
      }
      // Negative lookbehind: `user@example.com` is an email, not a mention —
      // a `@` glued to a preceding word character must never become a chip.
      const chunks = line.split(/(?<![\w.-])(@[A-Za-z0-9][A-Za-z0-9_.-]{0,31})/g)
      for (const c of chunks) {
        if (c) fragments.push({ text: c, mention: c.startsWith('@') && c.length > 1 })
      }
      fragments.push({ text: '\n', mention: false })
    }
    const runs: Array<{ text: string; mention: boolean }> = []
    for (const fragment of fragments) {
      const last = runs[runs.length - 1]
      if (!fragment.mention && last && !last.mention) last.text += fragment.text
      else runs.push({ ...fragment })
    }
    return (
      <div className="md-body selectable">
        {runs.map((run, i) =>
          run.mention ? (
            <span key={i} className="text-[color:var(--hal-alias-link)] font-medium">
              {run.text}
            </span>
          ) : run.text ? (
            <span key={i}>
              <Markdown>{run.text}</Markdown>
            </span>
          ) : null,
        )}
      </div>
    )
  }, [message.content, swarm, isSystem])

  if (isSystem && !message.content && !message.error) return null

  const recipients = message.to.filter((r) => r !== 'user')

  if (isSystem) {
    return (
      <div className="flex justify-center my-3 fade-in">
        <div
          className="rounded-full bg-[var(--hal-alias-interactive-bg-hover)] px-4 py-1.5 text-[12px] text-[color:var(--hal-alias-label-secondary)] max-w-[640px] text-center selectable"
        >
          {message.content || message.error}
        </div>
      </div>
    )
  }

  /* ------------------------------ user ------------------------------ */
  if (isUser) {
    return (
      <div className="flex flex-col items-end mt-1.5 rise">
        <div
          className="w-fit max-w-[70%] rounded-xl px-4 py-2.5"
          style={{ background: 'var(--hal-specific-bubble)', fontSize: 'var(--hal-content-font-size, 14px)', lineHeight: 'calc(22px + var(--hal-content-font-delta, 0px))' }}
        >
          <div className="md-body selectable whitespace-pre-wrap" style={{ margin: 0 }}>
            {message.content}
          </div>
        </div>
      </div>
    )
  }

  /* ----------------------------- agent ------------------------------ */
  const usage = message.usage
  return (
    <div className="flex flex-col mt-1.5 rise group">
      {/* swarm identity row */}
      {swarm ? (
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span
            className="w-6 h-6 rounded-md flex items-center justify-center text-[13px] shrink-0 border-[0.5px] overflow-hidden"
            style={{ backgroundColor: `${color}14`, borderColor: `${color}30` }}
            title={message.fromName}
          >
            {message.agentAvatar?.startsWith('data:image/') ? (
              <img src={message.agentAvatar} alt="" className="w-full h-full object-cover" draggable={false} />
            ) : message.agentAvatar ? (
              <span>{message.agentAvatar}</span>
            ) : (
              <span className="text-[11px] font-semibold" style={{ color }}>
                {(message.fromName || '?').charAt(0).toUpperCase()}
              </span>
            )}
          </span>
          <span className="text-[13px] font-medium text-ink">{message.fromName}</span>
          {message.agentRole ? (
            <span
              className="rounded-md px-1.5 py-0.5 text-[10.5px] leading-none font-medium"
              style={{ background: `${color}14`, color, border: `0.5px solid ${color}2e` }}
            >
              {message.agentRole}
            </span>
          ) : null}
          {recipients.length > 0 || message.to.includes('user') ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-[color:var(--hal-alias-label-tertiary)]">
              <ArrowRight size={11} />
              {recipients.length ? recipients.map(nameOf).join(', ') : t('to_user')}
            </span>
          ) : null}
          {/* quiet hover actions */}
          {!message.streaming && message.content ? (
            <span className="ml-auto flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-[80ms]">
              <button
                className="inline-flex items-center gap-1 text-[11px] text-[color:var(--hal-alias-label-tertiary)] hover:text-ink cursor-pointer bg-transparent border-none p-0 transition-colors duration-100"
                onClick={copyAll}
              >
                {copied ? <Check size={11} className="text-good" /> : <Copy size={11} />}
                {copied ? t('copied') : t('copy')}
              </button>
            </span>
          ) : null}
        </div>
      ) : (
        /* agent mode: hover actions float at the top-right of the turn */
        !message.streaming && message.content ? (
          <div className="flex justify-end h-0 -mt-1 relative z-10">
            <span className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-[80ms]">
              <button
                className="inline-flex items-center gap-1 text-[11px] text-[color:var(--hal-alias-label-tertiary)] hover:text-ink cursor-pointer bg-transparent border-none p-0 transition-colors duration-100"
                onClick={copyAll}
              >
                {copied ? <Check size={11} className="text-good" /> : <Copy size={11} />}
                {copied ? t('copied') : t('copy')}
              </button>
            </span>
          </div>
        ) : null
      )}

      {message.streaming && !message.content ? (
        /* DSH running status: shimmer in the deep-diving tint */
        <div className="flex items-center gap-1.5 py-0.5">
          <span
            className="inline-flex items-center justify-center w-[14px] h-[14px] shrink-0"
            style={{ color: 'var(--hal-alias-label-deep-diving)' }}
          >
            <img src={logoUrl} alt="" className="brand-img w-3.5 h-3.5" draggable={false} />
          </span>
          <span
            className="text-[12px] font-medium"
            style={{ color: 'var(--hal-alias-label-deep-diving)' }}
          >
            <ShimmerText text={`${t('thinking')}…`} />
          </span>
        </div>
      ) : null}

      {/* body */}
      {message.content ? (
        <div className="selectable relative">
          {rendered}
          {message.streaming ? <span className="stream-caret" /> : null}
        </div>
      ) : null}

      {message.reasoning && !isUser ? (
        <details className="mt-1.5 w-full">
          <summary className="inline-flex items-center gap-1.5 text-[11.5px] text-[color:var(--hal-alias-label-tertiary)] cursor-pointer hover:text-[color:var(--hal-alias-label-secondary)] select-none transition-colors duration-100 bg-transparent border-none p-0 list-none">
            <span style={{ color: 'var(--hal-alias-label-deep-diving)' }}>✦</span> {t('reasoning')}
          </summary>
          <div
            className="mt-1 pl-[22px] pr-1 text-[12px] leading-5 text-[color:var(--hal-alias-label-secondary)] whitespace-pre-wrap selectable"
          >
            {message.reasoning}
          </div>
        </details>
      ) : null}

      {/* tool runs */}
      {toolRuns.length ? (
        <div className="mt-1.5 w-full flex flex-col gap-0.5">
          {toolRuns.map((run) => (
            <ToolCard key={run.toolCallId} run={run} />
          ))}
        </div>
      ) : null}

      {/* receipts */}
      {receipts.length ? (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {receipts.map((r) => (
            <ReceiptChip key={r.receiptHash} receipt={r} />
          ))}
        </div>
      ) : null}

      {/* turn tail — token usage */}
      {usage && !message.streaming && (usage.inputTokens > 0 || usage.outputTokens > 0) ? (
        <div className="mt-1.5 text-[10.5px] text-[color:var(--hal-alias-label-caption)] font-mono flex items-center gap-2">
          <span>↑ {fmtTokens(usage.inputTokens)} tok</span>
          <span>·</span>
          <span>↓ {fmtTokens(usage.outputTokens)} tok</span>
        </div>
      ) : null}

      {message.error ? (
        <div className="mt-1.5 text-[12px] leading-5 text-[color:var(--hal-alias-state-error-secondary)] max-w-[640px] selectable">
          {message.error}
        </div>
      ) : null}
    </div>
  )
}
