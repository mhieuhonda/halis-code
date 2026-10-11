/** Message bubble: avatar, name, role badge, addressing arrow, markdown, tools, receipts. */
import { useMemo } from 'react'
import { ArrowRight, Bot, User as UserIcon } from 'lucide-react'
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

export function MessageBubble({ message, swarm, nameOf }: { message: ChatMessage; swarm: boolean; nameOf: (id: string) => string }) {
  const t = useT()
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system' || message.from === 'system'
  const color = isUser ? '#8b95ab' : message.agentColor ?? '#7C6CFF'

  const receipts = useMemo(() => findReceipts(message), [message])
  const toolRuns: ToolRun[] = useMemo(
    () => (message.parts ?? []).filter((p): p is { type: 'tool'; run: ToolRun } => p.type === 'tool').map((p) => p.run),
    [message],
  )

  // Highlight @mentions in swarm text.
  const rendered = useMemo(() => {
    if (!swarm || isSystem) return <Markdown>{message.content}</Markdown>
    const parts = message.content.split(/(@[A-Za-z0-9][A-Za-z0-9_.-]{0,31})/g)
    return (
      <div className="md-body selectable">
        {parts.map((part, i) =>
          part.startsWith('@') && part.length > 1 ? (
            <span key={i} className="text-accent font-medium">
              {part}
            </span>
          ) : (
            <span key={i}>
              <Markdown>{part}</Markdown>
            </span>
          ),
        )}
      </div>
    )
  }, [message.content, swarm, isSystem])

  if (isSystem && !message.content && !message.error) return null

  const recipients = message.to.filter((r) => r !== 'user')

  if (isSystem) {
    return (
      <div className="flex justify-center my-3 fade-up">
        <div className="rounded-lg border border-line bg-panel2/60 px-3.5 py-1.5 text-[12px] text-muted max-w-[640px] text-center selectable">
          {message.content || message.error}
        </div>
      </div>
    )
  }

  return (
    <div className={`flex gap-3 my-3 fade-up ${isUser ? 'flex-row-reverse' : ''}`}>
      {/* avatar */}
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center text-[15px] shrink-0 mt-0.5 border"
        style={{ backgroundColor: `${color}1a`, borderColor: `${color}45` }}
        title={message.fromName}
      >
        {isUser ? <UserIcon size={15} style={{ color }} /> : message.agentAvatar ? <span>{message.agentAvatar}</span> : <Bot size={15} style={{ color }} />}
      </div>

      <div className={`flex flex-col min-w-0 max-w-[760px] ${isUser ? 'items-end' : 'items-start'}`}>
        {/* header: name · role badge · addressing arrow */}
        <div className={`flex items-center gap-2 mb-1 flex-wrap ${isUser ? 'justify-end' : ''}`}>
          <span className="text-[12.5px] font-semibold" style={{ color }}>
            {isUser ? t('you') : message.fromName}
          </span>
          {swarm && !isUser && message.agentRole ? <Badge>{message.agentRole}</Badge> : null}
          {swarm && (recipients.length > 0 || (!isUser && message.to.includes('user'))) ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-faint">
              <ArrowRight size={11} />
              {recipients.length ? recipients.map(nameOf).join(', ') : t('to_user')}
            </span>
          ) : null}
          {message.streaming ? <span className="text-[11px] text-cyan">{t('thinking')}…</span> : null}
          {message.model && !isUser && !swarm ? (
            <span className="text-[10.5px] text-faint font-mono">{message.model.split('/').pop()}</span>
          ) : null}
        </div>

        {/* body */}
        {message.content || message.streaming ? (
          <div
            className={`rounded-2xl px-4 py-3 border ${isUser ? 'bg-accent-soft/60 border-accent/25 rounded-tr-md' : 'bg-panel2 border-line rounded-tl-md'}`}
          >
            {rendered}
            {message.streaming && !message.content ? (
              <span className="inline-flex gap-1 ml-1">
                <span className="typing-dot w-1.5 h-1.5 rounded-full bg-muted inline-block" />
                <span className="typing-dot w-1.5 h-1.5 rounded-full bg-muted inline-block" style={{ animationDelay: '0.2s' }} />
                <span className="typing-dot w-1.5 h-1.5 rounded-full bg-muted inline-block" style={{ animationDelay: '0.4s' }} />
              </span>
            ) : null}
          </div>
        ) : null}

        {message.reasoning && !isUser ? (
          <details className="mt-1 w-full">
            <summary className="text-[11px] text-faint cursor-pointer hover:text-muted select-none">✦ {t('reasoning')}</summary>
            <div className="mt-1 rounded-lg border border-line bg-panel/60 px-3 py-2 text-[12px] text-muted whitespace-pre-wrap selectable">{message.reasoning}</div>
          </details>
        ) : null}

        {/* tool runs */}
        {toolRuns.length ? (
          <div className="mt-1.5 w-full flex flex-col">
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

        {message.error ? (
          <div className="mt-1.5 rounded-lg border border-red/30 bg-red/5 px-3 py-2 text-[12px] text-red max-w-[640px] selectable">
            {message.error}
          </div>
        ) : null}
      </div>
    </div>
  )
}
