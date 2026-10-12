/**
 * Message rendering:
 * - user    → right-aligned block with an identity rail
 * - agent   → open layout: identity row, markdown, tool rows, turn tail
 * - system  → quiet centered pill
 */
import { useMemo, useState } from 'react'
import { ArrowRight, Bot, Check, Copy } from 'lucide-react'
import type { ChatMessage, ReceiptRef, ToolRun } from '@shared/types'
import { useT } from '../../i18n'
import { Badge } from '../ui'
import { Markdown } from '../Markdown'
import { ToolCard } from './ToolCard'
import { ReceiptChip } from '../telegraph/ReceiptChip'

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
  const color = isUser ? '#8b95a8' : message.agentColor ?? '#FF7A3E'

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
  const rendered = useMemo(() => {
    if (!swarm || isSystem) return <Markdown>{message.content}</Markdown>
    if (!message.content.includes('@')) return <Markdown>{message.content}</Markdown>
    const parts: Array<{ text: string; mention: boolean }> = []
    let fence = false
    for (const line of message.content.split('\n')) {
      if (/^\s*(```|~~~)/.test(line)) fence = !fence
      if (fence) {
        parts.push({ text: line + '\n', mention: false })
        continue
      }
      const chunks = line.split(/(@[A-Za-z0-9][A-Za-z0-9_.-]{0,31})/g)
      const joined = chunks.map((c) => ({ text: c, mention: c.startsWith('@') && c.length > 1 }))
      parts.push(...joined)
      parts.push({ text: '\n', mention: false })
    }
    return (
      <div className="md-body selectable">
        {parts.map((part, i) =>
          part.mention ? (
            <span key={i} className="text-signal font-medium">
              {part.text}
            </span>
          ) : part.text ? (
            <span key={i}>
              <Markdown>{part.text}</Markdown>
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
      <div className="flex justify-center my-3.5 fade-in">
        <div className="rounded-full border border-line bg-panel2/70 px-4 py-1.5 text-[12px] text-muted max-w-[640px] text-center selectable">
          {message.content || message.error}
        </div>
      </div>
    )
  }

  /* ------------------------------ user ------------------------------ */
  if (isUser) {
    return (
      <div className="flex flex-col items-end my-4 rise">
        <div className="max-w-[640px] w-fit rounded-2xl rounded-tr-md border border-line bg-panel2 pl-4 pr-4 py-3 relative overflow-hidden">
          <span className="absolute left-0 top-0 bottom-0 w-[2px] bg-gradient-to-b from-ember to-signal opacity-70" />
          <div className="md-body selectable whitespace-pre-wrap">{message.content}</div>
        </div>
      </div>
    )
  }

  /* ----------------------------- agent ------------------------------ */
  const usage = message.usage
  return (
    <div className="flex gap-3 my-4 rise group">
      {/* avatar */}
      <div
        className="w-7 h-7 rounded-lg flex items-center justify-center text-[14px] shrink-0 mt-0.5 border"
        style={{ backgroundColor: `${color}14`, borderColor: `${color}38` }}
        title={message.fromName}
      >
        {message.agentAvatar ? <span>{message.agentAvatar}</span> : <Bot size={14} style={{ color }} />}
      </div>

      <div className="flex flex-col min-w-0 flex-1 max-w-[720px]">
        {/* identity row */}
        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
          <span className="text-[12.5px] font-semibold" style={{ color }}>
            {message.fromName}
          </span>
          {swarm && message.agentRole ? <Badge>{message.agentRole}</Badge> : null}
          {swarm && (recipients.length > 0 || message.to.includes('user')) ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-faint">
              <ArrowRight size={11} />
              {recipients.length ? recipients.map(nameOf).join(', ') : t('to_user')}
            </span>
          ) : null}
          {message.model && !swarm ? (
            <span className="text-[10.5px] text-faint font-mono">{message.model.split('/').pop()}</span>
          ) : null}
          {message.streaming ? (
            <span className="shimmer-text text-[11px] font-medium">{t('thinking')}…</span>
          ) : null}
          {/* turn tail — quiet actions on hover */}
          {!message.streaming && message.content ? (
            <span className="ml-auto flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                className="inline-flex items-center gap-1 text-[10.5px] text-faint hover:text-ink cursor-pointer transition-colors"
                onClick={copyAll}
              >
                {copied ? <Check size={11} className="text-good" /> : <Copy size={11} />}
                {copied ? t('copied') : t('copy')}
              </button>
            </span>
          ) : null}
        </div>

        {/* body */}
        {message.content || message.streaming ? (
          <div className="selectable">
            {rendered}
            {message.streaming && !message.content ? (
              <span className="inline-flex gap-1 ml-1 align-middle">
                <span className="typing-dot w-1.5 h-1.5 rounded-full bg-muted inline-block" />
                <span className="typing-dot w-1.5 h-1.5 rounded-full bg-muted inline-block" style={{ animationDelay: '0.2s' }} />
                <span className="typing-dot w-1.5 h-1.5 rounded-full bg-muted inline-block" style={{ animationDelay: '0.4s' }} />
              </span>
            ) : null}
            {message.streaming && message.content ? <span className="stream-caret" /> : null}
          </div>
        ) : null}

        {message.reasoning && !isUser ? (
          <details className="mt-2 w-full group/reasoning">
            <summary className="inline-flex items-center gap-1.5 text-[11px] text-faint cursor-pointer hover:text-muted select-none transition-colors">
              <span className="spark-pulse text-signal">✦</span> {t('reasoning')}
            </summary>
            <div className="mt-1.5 rounded-xl border border-line bg-panel/70 px-3.5 py-2.5 text-[12px] text-muted whitespace-pre-wrap selectable">
              {message.reasoning}
            </div>
          </details>
        ) : null}

        {/* tool runs */}
        {toolRuns.length ? (
          <div className="mt-2 w-full flex flex-col gap-1">
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

        {/* turn tail — token usage (honest numbers or nothing) */}
        {usage && !message.streaming && (usage.inputTokens > 0 || usage.outputTokens > 0) ? (
          <div className="mt-2 text-[10.5px] text-faint font-mono flex items-center gap-2">
            <span>↑ {fmtTokens(usage.inputTokens)} tok</span>
            <span className="text-line2">·</span>
            <span>↓ {fmtTokens(usage.outputTokens)} tok</span>
          </div>
        ) : null}

        {message.error ? (
          <div className="mt-2 rounded-xl border border-red/25 bg-red/[0.06] px-3.5 py-2.5 text-[12px] text-red max-w-[640px] selectable">
            {message.error}
          </div>
        ) : null}
      </div>
    </div>
  )
}
