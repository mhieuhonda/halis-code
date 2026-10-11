/** The chat screen — shared by Agent mode and Swarm mode. */
import { useEffect, useMemo, useRef } from 'react'
import { Sparkles, Users, FolderOpen, Radio } from 'lucide-react'
import { useT } from '../../i18n'
import { useAppStore } from '../../stores/app'
import { useChatStore } from '../../stores/chat'
import { useSwarmStore } from '../../stores/swarm'
import { MessageBubble } from '../chat/MessageBubble'
import { ApprovalCard } from '../chat/ApprovalCard'
import { Composer } from '../chat/Composer'
import { Button, EmptyState } from '../ui'

export function ChatView({ mode }: { mode: 'agent' | 'swarm' }) {
  const t = useT()
  const chat = useChatStore()
  const workspace = useAppStore((s) => s.workspace)
  const swarm = useSwarmStore()
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const onScroll = () => {
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    }
    el.addEventListener('scroll', onScroll)
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [chat.messages, chat.typing])

  useEffect(() => {
    if (chat.activeMode !== mode && (!chat.activeSessionId || chat.sessions.every((s) => s.id !== chat.activeSessionId))) {
      // Mode switched with no matching session: open or create one.
      const existing = chat.sessions.find((s) => s.mode === mode)
      if (existing) void chat.openSession(existing.id)
      else void chat.newSession(mode)
    }
  }, [mode])

  const nameOf = useMemo(() => {
    const map = new Map(swarm.config.agents.map((a) => [a.id, a.name]))
    return (id: string) => {
      if (id === 'user') return t('you')
      if (id.startsWith('name:')) return id.slice(5)
      return map.get(id) ?? id
    }
  }, [swarm.config.agents, t])

  const activeSession = chat.sessions.find((s) => s.id === chat.activeSessionId)

  return (
    <div className="flex flex-col h-full min-w-0 flex-1">
      {/* header */}
      <div className="flex items-center gap-3 px-5 py-2.5 border-b border-line bg-panel/40 backdrop-blur">
        <span className={mode === 'agent' ? 'text-accent' : 'text-cyan'}>
          {mode === 'agent' ? <Sparkles size={15} /> : <Users size={15} />}
        </span>
        <span className="text-[13.5px] font-semibold">
          {mode === 'agent' ? t('mode_agent') : t('mode_swarm')}
        </span>
        <span className="text-[12px] text-faint truncate max-w-[280px]">{activeSession?.title}</span>
        <div className="ml-auto flex items-center gap-2.5">
          <span className="hidden md:inline-flex items-center gap-1.5 text-[11px] text-faint" title={workspace.workspace}>
            <FolderOpen size={12} />
            {workspace.workspace ? workspace.workspace.split(/[\\/]/).pop() : t('no_workspace')}
          </span>
          {mode === 'swarm' ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                const existing = chat.sessions.find((s) => s.mode === 'swarm')
                if (existing && existing.id === chat.activeSessionId) void chat.newSession('swarm')
                else if (existing) void chat.openSession(existing.id)
                else void chat.newSession('swarm')
              }}
            >
              <Radio size={12} /> {t('new_swarm_session')}
            </Button>
          ) : null}
        </div>
      </div>

      {/* swarm planner banner */}
      {mode === 'swarm' && swarm.config.plannerCoordination ? (
        <div className="px-5 py-1.5 border-b border-line bg-accent-soft/25 text-[11px] text-muted">{t('planner_banner')}</div>
      ) : null}

      {/* messages */}
      <div ref={scroller} className="flex-1 overflow-y-auto px-5 py-4">
        {chat.messages.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="max-w-md text-center">
              <div className="text-4xl mb-4">{mode === 'agent' ? '✦' : '🐝'}</div>
              <div className="text-lg font-semibold mb-2">{mode === 'agent' ? t('app_name') : t('mode_swarm')}</div>
              <div className="text-muted text-[13px] leading-relaxed">
                {mode === 'agent'
                  ? t('placeholder_agent')
                  : t('placeholder_swarm')}
              </div>
            </div>
          </div>
        ) : (
          chat.messages.map((m) => <MessageBubble key={m.id} message={m} swarm={mode === 'swarm'} nameOf={nameOf} />)
        )}
        {/* inline approval cards */}
        {chat.approvals.length ? (
          <div className="mt-4 space-y-2">
            {chat.approvals.map((a) => (
              <ApprovalCard key={a.id} request={a} onRespond={(r) => void chat.respondApproval(a.id, r)} />
            ))}
          </div>
        ) : null}
      </div>

      <Composer />
    </div>
  )
}
