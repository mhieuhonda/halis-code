/** The chat screen — shared by Agent mode and Swarm mode. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, FolderOpen, Radio, Sparkles, Users } from 'lucide-react'
import { useT } from '../../i18n'
import { useAppStore } from '../../stores/app'
import { useChatStore } from '../../stores/chat'
import { useSwarmStore } from '../../stores/swarm'
import { MessageBubble } from '../chat/MessageBubble'
import { ApprovalCard } from '../chat/ApprovalCard'
import { Composer } from '../chat/Composer'
import { Badge, Button } from '../ui'
import logoUrl from '../../assets/logo-64.png'

export function ChatView({ mode }: { mode: 'agent' | 'swarm' }) {
  const t = useT()
  const chat = useChatStore()
  const workspace = useAppStore((s) => s.workspace)
  const swarm = useSwarmStore()
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const [atBottom, setAtBottom] = useState(true)

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const onScroll = () => {
      const near = el.scrollHeight - el.scrollTop - el.clientHeight < 120
      stick.current = near
      setAtBottom(near)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
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
  const enabledSwarmAgents = swarm.config.agents.filter((a) => a.enabled)

  const jumpToLatest = () => {
    const el = scroller.current
    if (!el) return
    stick.current = true
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }

  return (
    <div className="flex flex-col h-full min-w-0 flex-1">
      {/* header */}
      <div className="flex items-center gap-3 pl-5 pr-4 py-2.5 border-b border-line bg-panel/60 backdrop-blur-md">
        <span className={mode === 'agent' ? 'text-ember' : 'text-signal'}>
          {mode === 'agent' ? <Sparkles size={14} /> : <Users size={14} />}
        </span>
        <span className="text-[13.5px] font-semibold tracking-tight">{mode === 'agent' ? t('mode_agent') : t('mode_swarm')}</span>
        <span className="text-[12px] text-faint truncate max-w-[260px]">{activeSession?.title}</span>
        {mode === 'swarm' && enabledSwarmAgents.length ? (
          <span className="hidden md:flex items-center -space-x-1.5 ml-1">
            {enabledSwarmAgents.slice(0, 6).map((a) => (
              <span
                key={a.id}
                className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] border-2 border-panel"
                style={{ backgroundColor: `${a.color}22`, color: a.color }}
                title={a.name}
              >
                {a.avatar}
              </span>
            ))}
            {enabledSwarmAgents.length > 6 ? (
              <span className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] bg-panel3 border-2 border-panel text-faint">
                +{enabledSwarmAgents.length - 6}
              </span>
            ) : null}
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-2.5">
          <span
            className="hidden md:inline-flex items-center gap-1.5 text-[11px] text-faint max-w-[200px] truncate"
            title={workspace.workspace || t('no_workspace')}
          >
            <FolderOpen size={12} className="shrink-0" />
            {workspace.workspace ? workspace.workspace.split(/[\\/]/).pop() : t('workspace_none_short')}
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
        <div className="px-5 py-1.5 border-b border-line bg-signal/[0.05] text-[11px] text-muted">{t('planner_banner')}</div>
      ) : null}

      {/* messages */}
      <div className="relative flex-1 min-h-0">
        <div ref={scroller} className="absolute inset-0 overflow-y-auto px-5 py-5">
          {chat.messages.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <div className="halis-aurora relative max-w-lg text-center px-4">
                <img
                  src={logoUrl}
                  alt=""
                  className="float-slow w-20 h-20 mx-auto mb-5 rounded-[20px] shadow-[0_18px_50px_-10px_rgba(69,165,255,0.45)]"
                  draggable={false}
                />
                <div className="text-[24px] font-semibold tracking-tight mb-2.5">
                  <span className="brand-gradient-text">{mode === 'agent' ? t('greeting_agent') : t('greeting_swarm')}</span>
                </div>
                <div className="text-muted text-[13px] leading-relaxed mb-6">
                  {mode === 'agent' ? t('placeholder_agent') : t('placeholder_swarm')}
                </div>
                {mode === 'agent' ? (
                  <div className="flex flex-wrap justify-center gap-2">
                    {['explain', 'build', 'fix', 'refactor'].map((verb) => (
                      <span
                        key={verb}
                        className="rounded-full border border-line bg-panel2/70 px-3 py-1.5 text-[11.5px] text-faint"
                      >
                        {t(`suggest_${verb}` as 'suggest_explain')}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="max-w-[780px] mx-auto pb-2">
              {chat.messages.map((m) => (
                <MessageBubble key={m.id} message={m} swarm={mode === 'swarm'} nameOf={nameOf} />
              ))}
            </div>
          )}
        </div>

        {/* jump to latest */}
        {!atBottom && chat.messages.length ? (
          <button
            onClick={jumpToLatest}
            className="bounce-in absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 rounded-full border border-line2 bg-panel2/95 backdrop-blur px-3.5 py-1.5 text-[11.5px] text-muted hover:text-ink shadow-[0_8px_28px_-6px_rgba(0,0,0,0.7)] cursor-pointer transition-colors"
          >
            <ArrowDown size={12} /> {t('jump_latest')}
          </button>
        ) : null}
      </div>

      {/* pinned approvals — they take over the flow above the composer */}
      {chat.approvals.length ? (
        <div className="px-5 pt-2 space-y-2 max-h-[300px] overflow-y-auto">
          {chat.approvals.map((a) => (
            <ApprovalCard key={a.id} request={a} onRespond={(r) => void chat.respondApproval(a.id, r)} />
          ))}
        </div>
      ) : null}

      <Composer />
    </div>
  )
}
