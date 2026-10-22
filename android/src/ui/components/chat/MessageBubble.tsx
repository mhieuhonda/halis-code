/** Message bubble — user / agent / system, with markdown, tools, receipts. */
import { memo, useState } from 'react'
import { Brain, ChevronDown } from 'lucide-react'
import type { ChatMessage } from '@shared/types'
import { Markdown } from '../Markdown'
import { ToolCard } from './ToolCard'
import { useT } from '../../i18n'

function roleEmoji(message: ChatMessage): string {
  if (message.agentAvatar) return message.agentAvatar
  if (message.from === 'halis') return '🤖'
  if (message.role === 'user') return '👤'
  return '✦'
}

export const MessageBubble = memo(function MessageBubble({ message }: { message: ChatMessage }) {
  const t = useT()
  const [showReasoning, setShowReasoning] = useState(false)
  const time = new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  if (message.role === 'system') {
    return (
      <div className="bubble bubble-system">
        {message.fromName && message.fromName !== 'Halis' ? <b>{message.fromName}: </b> : null}
        {message.content}
      </div>
    )
  }

  const isUser = message.role === 'user'
  const toolParts = (message.parts ?? []).filter((p) => p.type === 'tool')

  return (
    <div style={{ marginBottom: 10 }}>
      {!isUser ? (
        <div className="row" style={{ gap: 6, marginBottom: 4 }}>
          <span
            style={{
              width: 22,
              height: 22,
              borderRadius: 8,
              background: message.agentColor ?? 'var(--hal-accent-soft)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 12,
              flex: '0 0 auto',
            }}
          >
            {roleEmoji(message)}
          </span>
          <b style={{ fontSize: 13 }}>{message.fromName}</b>
          {message.to?.length ? (
            <span className="chip" style={{ fontSize: 10, padding: '1px 7px' }}>
              → {message.to.length > 2 ? `${message.to.length}` : message.to.join(', ')}
            </span>
          ) : null}
          <span className="hint" style={{ fontSize: 10.5 }}>
            {time}
          </span>
          {message.usage ? (
            <span className="hint" style={{ fontSize: 10.5, marginLeft: 'auto' }}>
              {message.usage.inputTokens}↑ {message.usage.outputTokens}↓
            </span>
          ) : null}
        </div>
      ) : null}

      <div className={`bubble ${isUser ? 'bubble-user' : 'bubble-agent'} ${message.error ? 'bubble-error' : ''}`} style={isUser ? { marginBottom: 2 } : undefined}>
        {message.reasoning ? (
          <button
            onClick={() => setShowReasoning(!showReasoning)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'transparent', border: 'none', padding: 0, color: isUser ? 'rgba(255,255,255,.8)' : 'var(--hal-ink-muted)', fontSize: 12, fontWeight: 600, marginBottom: 4 }}
          >
            <Brain size={12} />
            {t('reasoning')}
            <ChevronDown size={11} style={{ transform: showReasoning ? 'rotate(180deg)' : undefined }} />
          </button>
        ) : null}
        {showReasoning && message.reasoning ? (
          <div
            style={{
              fontSize: 12.5,
              color: isUser ? 'rgba(255,255,255,.75)' : 'var(--hal-ink-muted)',
              borderLeft: '2px solid currentColor',
              paddingLeft: 8,
              margin: '4px 0 8px',
              whiteSpace: 'pre-wrap',
              maxHeight: 180,
              overflowY: 'auto',
            }}
          >
            {message.reasoning}
          </div>
        ) : null}

        {message.content ? <Markdown>{message.content}</Markdown> : null}
        {!message.content && message.streaming ? (
          <span style={{ display: 'inline-flex' }}>
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="typing-dot" />
          </span>
        ) : null}
        {message.error ? <div style={{ fontWeight: 600 }}>{message.error}</div> : null}
      </div>

      {toolParts.length ? (
        <div style={{ marginTop: 2 }}>
          {toolParts.map((part) => (
            <ToolCard key={part.run.toolCallId} run={part.run} />
          ))}
        </div>
      ) : null}
    </div>
  )
})
