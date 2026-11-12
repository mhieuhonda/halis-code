/**
 * Message row — desktop timeline anatomy: user messages as right-aligned
 * layer-02 bubbles, assistant messages under a slim identity header with
 * markdown, tool rows and receipts.
 */
import { memo, useState } from 'react'
import { Brain, ChevronDown } from 'lucide-react'
import type { ChatMessage } from '@shared/types'
import { Markdown } from '../Markdown'
import { ToolCard } from './ToolCard'
import { useT } from '../../i18n'

function roleInitial(message: ChatMessage): string {
  if (message.agentAvatar) return message.agentAvatar
  if (message.from === 'halis') return 'H'
  if (message.role === 'user') return 'Y'
  return 'A'
}

export const MessageBubble = memo(function MessageBubble({ message }: { message: ChatMessage }) {
  const t = useT()
  const [showReasoning, setShowReasoning] = useState(false)
  const time = new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  if (message.role === 'system') {
    return (
      <div className="msg">
        <div className="hint hint-faint" style={{ textAlign: 'center', padding: '2px 8px' }}>
          {message.fromName && message.fromName !== 'Halis' ? `${message.fromName}: ` : ''}
          {message.content}
        </div>
      </div>
    )
  }

  const isUser = message.role === 'user'
  const toolParts = (message.parts ?? []).filter((p) => p.type === 'tool')

  if (isUser) {
    return (
      <div className="msg msg-user">
        <div className={`bubble-user ${message.streaming ? 'pending' : ''}`}>{message.content}</div>
        <div className="msg-meta">
          {message.usage ? <span>{message.usage.inputTokens}↑ {message.usage.outputTokens}↓</span> : null}
          <span className="msg-time">{time}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="msg">
      <div className="agent-head">
        <span
          className="agent-avatar"
          style={{
            background: `linear-gradient(180deg, #ffffff29, #ffffff00), ${message.agentColor ?? 'var(--v2-avatar-agent-bg)'}`,
          }}
        >
          {roleInitial(message)}
        </span>
        <span className="agent-name">{message.fromName}</span>
        {message.to?.length ? (
          <span className="chip">→ {message.to.length > 2 ? `${message.to.length}` : message.to.join(', ')}</span>
        ) : null}
        <span className="msg-time">{time}</span>
        {message.usage ? (
          <span className="msg-time" style={{ marginLeft: 'auto' }}>
            {message.usage.inputTokens}↑ {message.usage.outputTokens}↓
          </span>
        ) : null}
      </div>

      {message.reasoning ? (
        <>
          <button className="reasoning-toggle" onClick={() => setShowReasoning(!showReasoning)}>
            <Brain size={12} />
            {t('reasoning')}
            <ChevronDown size={11} style={{ transform: showReasoning ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }} />
          </button>
          {showReasoning ? <div className="reasoning-body selectable">{message.reasoning}</div> : null}
        </>
      ) : null}

      {message.content ? (
        <div className="selectable">
          <Markdown>{message.content}</Markdown>
        </div>
      ) : null}
      {!message.content && message.streaming ? (
        <span className="typing-row">
          <span className="typing-dot" />
          <span className="typing-dot" />
          <span className="typing-dot" />
        </span>
      ) : null}
      {message.error ? (
        <div className="composer-error" style={{ margin: 0 }}>{message.error}</div>
      ) : null}

      {toolParts.length ? (
        <div style={{ marginTop: 4 }}>
          {toolParts.map((part) => (
            <ToolCard key={part.run.toolCallId} run={part.run} />
          ))}
        </div>
      ) : null}
    </div>
  )
})
