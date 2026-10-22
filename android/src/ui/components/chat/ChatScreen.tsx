/**
 * Chat screen — the primary surface. Handles both Agent and Swarm modes
 * (segmented switch, like the desktop sidebar), sessions drawer, pinned
 * approval / question cards, todo panel, reminders and the composer.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ListTodo, Menu, MessageSquarePlus, Clock } from 'lucide-react'
import { useChatStore } from '../../stores/chat'
import { useAppStore } from '../../stores/app'
import { useT } from '../../i18n'
import { MessageBubble } from './MessageBubble'
import { ApprovalCard } from './ApprovalCard'
import { Composer } from './Composer'
import { SessionsDrawer } from '../SessionsDrawer'
import { ModelPicker } from '../ModelPicker'
import { bridge } from '../../lib/bridge'
import type { ScheduleView } from '@shared/types'
import { pushToast } from '../ui'

export function ChatScreen() {
  const t = useT()
  const activeMode = useChatStore((s) => s.activeMode)
  const messages = useChatStore((s) => s.messages)
  const sessions = useChatStore((s) => s.sessions)
  const activeSessionId = useChatStore((s) => s.activeSessionId)
  const activeSession = useMemo(() => sessions.find((s) => s.id === activeSessionId), [sessions, activeSessionId])
  const openSession = useChatStore((s) => s.openSession)
  const newSession = useChatStore((s) => s.newSession)
  const loadSessions = useChatStore((s) => s.loadSessions)
  const approvals = useChatStore((s) => s.approvals)
  const todos = useChatStore((s) => s.todos)
  const typing = useChatStore((s) => s.typing)
  const swarmRound = useChatStore((s) => s.swarmRound)
  const loadTasks = useChatStore((s) => s.loadTasks)
  const settings = useAppStore((s) => s.settings)
  const catalog = useAppStore((s) => s.catalog)

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [todosOpen, setTodosOpen] = useState(false)
  const [reminders, setReminders] = useState<ScheduleView[]>([])

  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  // A session of the active mode is always on screen: after boot or a mode
  // switch, auto-open the newest session or create one.
  useEffect(() => {
    void (async () => {
      await loadSessions()
      const list = useChatStore.getState().sessions.filter((s) => s.mode === activeMode)
      const current = useChatStore.getState().activeSessionId
      const currentMode = useChatStore.getState().sessions.find((s) => s.id === current)?.mode
      if (current && currentMode === activeMode) return
      if (list.length) await openSession(list[0]!.id)
      else await newSession(activeMode)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMode])

  useEffect(() => {
    void loadTasks()
  }, [loadTasks])

  // Load reminders for the open session + refresh on session change.
  useEffect(() => {
    if (!activeSessionId) return
    void bridge
      .scheduleList(activeSessionId)
      .then(setReminders)
      .catch(() => setReminders([]))
  }, [activeSessionId, messages.length])

  // Keep the view pinned to the newest message unless the user scrolled up.
  useEffect(() => {
    const el = scrollRef.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [messages, typing, swarmRound])

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  const modeSessions = sessions.filter((s) => s.mode === activeMode)
  const sessionApprovals = approvals.filter((a) => !a.sessionId || a.sessionId === activeSessionId)
  const doneTodos = todos.filter((td) => td.status === 'completed').length
  const defaultModelName = catalog?.models.find((m) => m.id === settings?.defaultModelId)?.name

  const pickModel = (modelId: string) => {
    if (!activeSessionId) return
    // Update the in-memory session meta so the chip reflects immediately;
    // the id rides with the next chatSend (same contract as desktop).
    useChatStore.setState((state) => ({
      sessions: state.sessions.map((s) => (s.id === activeSessionId ? { ...s, modelId } : s)),
    }))
  }

  return (
    <>
      <div className="topbar safe-top">
        <button className="icon-btn" onClick={() => setDrawerOpen(true)} aria-label="sessions">
          <Menu size={21} />
        </button>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="topbar-title">{activeSession?.title ?? (activeMode === 'swarm' ? t('new_swarm_session') : t('new_chat'))}</div>
          {swarmRound ? (
            <div className="hint">
              {t('round_label')} {swarmRound.round}/{swarmRound.maxRounds}
            </div>
          ) : null}
        </div>
        <div className="segmented">
          <button className={activeMode === 'agent' ? 'active' : ''} onClick={() => useChatStore.setState({ activeMode: 'agent' })}>
            {t('mode_agent')}
          </button>
          <button className={activeMode === 'swarm' ? 'active' : ''} onClick={() => useChatStore.setState({ activeMode: 'swarm' })}>
            {t('mode_swarm')}
          </button>
        </div>
        <button
          className="icon-btn"
          onClick={() => {
            stickToBottom.current = true
            void newSession(activeMode)
          }}
          aria-label="new"
        >
          <MessageSquarePlus size={21} />
        </button>
      </div>

      <div className="chat-scroll" ref={scrollRef} onScroll={onScroll}>
        {!messages.length ? (
          <div style={{ padding: '56px 18px', textAlign: 'center' }}>
            <div style={{ fontSize: 21, fontWeight: 700, marginBottom: 8 }}>{activeMode === 'swarm' ? t('greeting_swarm') : t('empty_chat_title')}</div>
            <div className="hint" style={{ maxWidth: 320, margin: '0 auto 18px' }}>
              {activeMode === 'swarm' ? t('chief_banner') : t('empty_chat_sub')}
            </div>
            {activeMode === 'agent' && defaultModelName ? <div className="chip chip-accent">{defaultModelName}</div> : null}
          </div>
        ) : (
          messages.map((m) => <MessageBubble key={m.id} message={m} />)
        )}

        {Object.entries(typing).map(([agentId, info]) => (
          <div key={agentId} className="hint" style={{ padding: '2px 4px 8px' }}>
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="typing-dot" /> {info.name} {t('typing')}
          </div>
        ))}
      </div>

      {sessionApprovals.length ? (
        <div style={{ maxHeight: '42dvh', overflowY: 'auto', padding: '8px 12px 0', borderTop: '1px solid var(--hal-border)', background: 'var(--hal-bg-soft)' }}>
          {sessionApprovals.map((a) => (
            <ApprovalCard key={a.id} request={a} />
          ))}
        </div>
      ) : null}

      {todos.length ? (
        <div className="panel" style={{ padding: '0 12px' }}>
          <button className="row" style={{ width: '100%', border: 'none', background: 'transparent', padding: '9px 0', cursor: 'pointer' }} onClick={() => setTodosOpen(!todosOpen)}>
            <ListTodo size={15} style={{ color: 'var(--hal-accent)' }} />
            <b style={{ fontSize: 13 }}>
              {t('todo_title')} · {doneTodos}/{todos.length}
            </b>
            <ChevronDown size={15} style={{ marginLeft: 'auto', transform: todosOpen ? 'rotate(180deg)' : undefined, transition: 'transform .15s', color: 'var(--hal-ink-muted)' }} />
          </button>
          {todosOpen ? (
            <div style={{ paddingBottom: 8 }}>
              {todos.map((td, i) => (
                <div key={i} className="row" style={{ gap: 8, padding: '3px 0', fontSize: 13.5 }}>
                  <span
                    style={{
                      width: 15,
                      height: 15,
                      borderRadius: '50%',
                      border: td.status === 'completed' ? 'none' : '2px solid var(--hal-border-strong)',
                      background: td.status === 'completed' ? 'var(--hal-green)' : td.status === 'in_progress' ? 'var(--hal-accent)' : 'transparent',
                      flex: '0 0 auto',
                    }}
                  />
                  <span style={{ textDecoration: td.status === 'completed' ? 'line-through' : undefined, color: td.status === 'pending' ? 'var(--hal-ink-soft)' : undefined }}>{td.content}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {reminders.length ? (
        <div className="panel" style={{ padding: '8px 12px', display: 'flex', gap: 6, overflowX: 'auto' }}>
          {reminders.map((r) => (
            <span key={r.id} className="chip" style={{ flex: '0 0 auto' }}>
              <Clock size={11} />
              {r.title} · {new Date(r.nextFireAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          ))}
        </div>
      ) : null}

      <Composer mode={activeMode} />

      <SessionsDrawer
        open={drawerOpen}
        mode={activeMode}
        onClose={() => setDrawerOpen(false)}
        onNew={() => {
          setDrawerOpen(false)
          stickToBottom.current = true
          void newSession(activeMode)
        }}
      />

      <ModelPicker open={pickerOpen} onClose={() => setPickerOpen(false)} currentId={activeSession?.modelId} onPick={(m) => pickModel(m.id)} />
    </>
  )
}
