/** The chat screen — DSH conversation shell: crumb header, centered flow
 *  column, hero empty state, sticky composer seat. Shared by both modes. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, FolderOpen, Radio, Users } from 'lucide-react'
import { useT } from '../../i18n'
import { useAppStore } from '../../stores/app'
import { useChatStore } from '../../stores/chat'
import { useSwarmStore } from '../../stores/swarm'
import { MessageBubble } from '../chat/MessageBubble'
import { ApprovalCard } from '../chat/ApprovalCard'
import { TodoPanel } from '../chat/TodoPanel'
import { Composer } from '../chat/Composer'
import logoUrl from '../../assets/logo.png'
import nameUrl from '../../assets/name.png'

export const CHAT_WIDTH_VAR = 'clamp(680px, 64%, 920px)'

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

  const empty = chat.messages.length === 0

  return (
    <div className="flex flex-col h-full min-w-0 flex-1 bg-[var(--dsw-alias-bg-base)]" style={{ ['--dsh-chat-content-width' as string]: CHAT_WIDTH_VAR }}>
      {/* header — crumbs row */}
      <div
        className="flex-none flex items-center gap-1 pl-5 pr-5 min-h-[64px] border-b-[0.5px] border-[color:var(--dsw-alias-border-l3)]"
        style={{ paddingTop: 10 }}
      >
        <span className="inline-flex items-center gap-1.5 text-[14px] font-medium text-ink max-w-[280px] truncate">
          {mode === 'agent' ? null : <Users size={14} className="text-[color:var(--dsw-alias-label-tertiary)] shrink-0" />}
          <span className="truncate">{activeSession?.title ?? (mode === 'agent' ? t('mode_agent') : t('mode_swarm'))}</span>
        </span>
        {mode === 'swarm' && enabledSwarmAgents.length ? (
          <span className="hidden md:flex items-center -space-x-1.5 ml-1">
            {enabledSwarmAgents.slice(0, 6).map((a) => (
              <span
                key={a.id}
                className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] border-2 border-[var(--dsw-alias-bg-base)]"
                style={{ backgroundColor: `${a.color}22`, color: a.color }}
                title={a.name}
              >
                {a.avatar}
              </span>
            ))}
            {enabledSwarmAgents.length > 6 ? (
              <span className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] bg-[var(--dsw-alias-bg-layer-3)] border-2 border-[var(--dsw-alias-bg-base)] text-[color:var(--dsw-alias-label-tertiary)]">
                +{enabledSwarmAgents.length - 6}
              </span>
            ) : null}
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-2.5">
          <span
            className="hidden md:inline-flex items-center gap-1.5 h-7 px-2 rounded-sm text-[12px] text-[color:var(--dsw-alias-label-tertiary)] max-w-[220px] truncate hover:bg-[var(--dsw-alias-interactive-bg-hover)] cursor-default transition-colors duration-100"
            title={workspace.workspace || t('no_workspace')}
          >
            <FolderOpen size={12} className="shrink-0" />
            {workspace.workspace ? workspace.workspace.split(/[\\/]/).pop() : t('workspace_none_short')}
          </span>
          {mode === 'swarm' ? (
            <button
              className="inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-[12px] text-[color:var(--dsw-alias-label-secondary)] hover:bg-[var(--dsw-alias-interactive-bg-hover)] hover:text-ink cursor-pointer bg-transparent border-none transition-colors duration-100"
              onClick={() => {
                const existing = chat.sessions.find((s) => s.mode === 'swarm')
                if (existing && existing.id === chat.activeSessionId) void chat.newSession('swarm')
                else if (existing) void chat.openSession(existing.id)
                else void chat.newSession('swarm')
              }}
            >
              <Radio size={12} /> {t('new_swarm_session')}
            </button>
          ) : null}
        </div>
      </div>

      {/* swarm planner banner */}
      {mode === 'swarm' && swarm.config.plannerCoordination ? (
        <div className="flex-none px-6 py-1.5 border-b-[0.5px] border-[color:var(--dsw-alias-border-l1)] bg-[color-mix(in_srgb,var(--dsw-alias-state-business-primary)_4%,transparent)] text-[11px] text-[color:var(--dsw-alias-label-secondary)]">
          {t('planner_banner')}
        </div>
      ) : null}

      {/* messages */}
      <div className="relative flex-1 min-h-0">
        <div
          ref={scroller}
          className="absolute inset-0 overflow-y-auto"
          style={{ padding: '16px 32px', scrollbarGutter: 'stable' }}
        >
          {empty ? (
            <div className="h-full flex items-center justify-center">
              <div className="max-w-xl text-center px-4 -mt-8">
                <div className="flex items-center justify-center gap-2.5 mb-5">
                  <img src={logoUrl} alt="" className="brand-img hero-sway w-9 h-9" draggable={false} />
                  <img src={nameUrl} alt="Halis Code" className="brand-img h-8 w-auto" draggable={false} />
                </div>
                <div className="text-[26px] leading-8 font-medium text-ink mb-2.5">
                  {mode === 'agent' ? t('greeting_agent') : t('greeting_swarm')}
                </div>
                <div className="text-[color:var(--dsw-alias-label-secondary)] text-[14px] leading-[22px] mb-7">
                  {mode === 'agent' ? t('placeholder_agent') : t('placeholder_swarm')}
                </div>
                {mode === 'agent' ? (
                  <div className="flex flex-wrap justify-center gap-2">
                    {['explain', 'build', 'fix', 'refactor'].map((verb) => (
                      <span
                        key={verb}
                        className="rounded-full bg-[var(--dsw-alias-interactive-bg-hover)] px-3 py-1.5 text-[12px] text-[color:var(--dsw-alias-label-secondary)]"
                      >
                        {t(`suggest_${verb}` as 'suggest_explain')}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="mx-auto flex flex-col" style={{ maxWidth: 'var(--dsh-chat-content-width)' }}>
              {chat.messages.map((m) => (
                <MessageBubble key={m.id} message={m} swarm={mode === 'swarm'} nameOf={nameOf} />
              ))}
              <div className="pb-1" />
            </div>
          )}
        </div>

        {/* jump to latest — DSH floating pill */}
        {!atBottom && !empty ? (
          <button
            onClick={jumpToLatest}
            className="bounce-in absolute bottom-4 right-8 flex items-center justify-center w-[34px] h-[34px] rounded-full bg-[var(--dsw-alias-button-floating-fill)] hover:bg-[var(--dsw-alias-button-floating-hover)] text-ink cursor-pointer border-none transition-colors duration-100"
            style={{ boxShadow: 'var(--dsw-elevation-panel)' }}
            aria-label={t('jump_latest')}
          >
            <ArrowDown size={15} />
          </button>
        ) : null}
      </div>

      {/* composer seat — sticky fade mask from the base background */}
      <div
        className="flex-none relative z-[7]"
        style={{
          background: 'linear-gradient(180deg, color-mix(in srgb, var(--dsw-alias-bg-base) 0%, transparent) 0px, var(--dsw-alias-bg-base) 36px)',
          paddingTop: 8,
        }}
      >
        <div className="mx-auto" style={{ maxWidth: 'calc(var(--dsh-chat-content-width) + 32px)' }}>
          {/* live agent checklist */}
          {chat.todos.length ? <TodoPanel todos={chat.todos} /> : null}

          {/* pinned approvals */}
          {chat.approvals.length ? (
            <div className="px-4 pt-1 space-y-2 max-h-[300px] overflow-y-auto">
              {chat.approvals.map((a) => (
                <ApprovalCard
                  key={a.id}
                  request={a}
                  onRespond={(r) => void chat.respondApproval(a.id, r)}
                  onAnswer={(answers) => void chat.answerQuestions(a.id, answers)}
                />
              ))}
            </div>
          ) : null}

          <Composer />
        </div>
      </div>
    </div>
  )
}
