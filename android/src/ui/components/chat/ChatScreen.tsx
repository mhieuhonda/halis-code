/**
 * Chat screen — the session panel. OpenCode-style 48px session header
 * (workspace trigger + title + actions), the message timeline, docked
 * approval/question cards, the todo pill and the composer.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Clock, FolderOpen, ListTodo, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { useChatStore } from '../../stores/chat'
import { useAppStore } from '../../stores/app'
import { useT } from '../../i18n'
import { MessageBubble } from './MessageBubble'
import { ApprovalCard } from './ApprovalCard'
import { Composer } from './Composer'
import { ModelPicker } from '../ModelPicker'
import { bridge } from '../../lib/bridge'
import logoUrl from '../../../assets/logo.png'
import type { ScheduleView } from '@shared/types'

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
  const deleteSession = useChatStore((s) => s.deleteSession)
  const renameSession = useChatStore((s) => s.renameSession)
  const approvals = useChatStore((s) => s.approvals)
  const todos = useChatStore((s) => s.todos)
  const typing = useChatStore((s) => s.typing)
  const swarmRound = useChatStore((s) => s.swarmRound)
  const loadTasks = useChatStore((s) => s.loadTasks)
  const settings = useAppStore((s) => s.settings)
  const workspace = useAppStore((s) => s.workspace)

  const [pickerOpen, setPickerOpen] = useState(false)
  const [todosOpen, setTodosOpen] = useState(false)
  const [headerMenu, setHeaderMenu] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameText, setRenameText] = useState('')
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

  const sessionApprovals = approvals.filter((a) => !a.sessionId || a.sessionId === activeSessionId)
  const doneTodos = todos.filter((td) => td.status === 'completed').length
  const running = Object.keys(typing).length > 0 || (swarmRound?.round ?? 0) > 0
  const workspaceName = workspace.workspace ? workspace.workspace.split(/[\\/]/).filter(Boolean).pop() : undefined
  const title = activeSession?.title ?? (activeMode === 'swarm' ? t('new_swarm_session') : t('new_chat'))

  return (
    <>
      <div className="session-header">
        <div className="sh-trigger" onClick={() => setPickerOpen(false)} style={{ cursor: 'default' }}>
          <FolderOpen size={14} style={{ color: 'var(--v2-icon-muted)' }} />
          <span style={{ maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {workspaceName || t('workspace_label')}
          </span>
          <span style={{ color: 'var(--v2-text-faint)' }}>/</span>
          {renaming ? (
            <input
              className="field"
              style={{ minHeight: 26, padding: '2px 8px', width: 150 }}
              autoFocus
              value={renameText}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && activeSessionId) {
                  void renameSession(activeSessionId, renameText)
                  setRenaming(false)
                }
              }}
              onBlur={() => setRenaming(false)}
            />
          ) : (
            <span className="sh-title">{title}</span>
          )}
        </div>

        {running ? <span className="working-shimmer">{t('working')}…</span> : null}
        {swarmRound ? (
          <span className="chip chip-purple">
            {t('round_label')} {swarmRound.round}/{swarmRound.maxRounds}
          </span>
        ) : null}

        <div className="sh-actions">
          <button className="icon-btn" onClick={() => setHeaderMenu(!headerMenu)} aria-label="session menu">
            <MoreHorizontal size={16} />
          </button>
        </div>

        {headerMenu ? (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 29 }} onClick={() => setHeaderMenu(false)} />
            <div className="menu" style={{ top: 46, bottom: 'auto', right: 10, left: 'auto' }}>
              <button
                className="menu-item"
                onClick={() => {
                  setHeaderMenu(false)
                  setRenameText(activeSession?.title ?? '')
                  setRenaming(true)
                }}
              >
                <Pencil size={14} />
                {t('edit')}
              </button>
              <button
                className="menu-item"
                onClick={() => {
                  setHeaderMenu(false)
                  if (activeSessionId && confirm(`${t('delete_session')}: ${title}?`)) void deleteSession(activeSessionId)
                }}
              >
                <Trash2 size={14} />
                {t('delete')}
              </button>
            </div>
          </>
        ) : null}
      </div>

      <div className="timeline" ref={scrollRef} onScroll={onScroll}>
        {!messages.length ? (
          <div className="empty-state">
            <img src={logoUrl} alt="" className="logo" draggable={false} />
            <div style={{ fontSize: 20, fontWeight: 670, letterSpacing: '-0.32px' }}>
              {activeMode === 'swarm' ? t('greeting_swarm') : t('empty_chat_title')}
            </div>
            <div className="hint">{activeMode === 'swarm' ? t('chief_banner') : t('empty_chat_sub')}</div>
          </div>
        ) : (
          messages.map((m) => <MessageBubble key={m.id} message={m} />)
        )}

        {Object.entries(typing).map(([agentId, info]) => (
          <div key={agentId} className="typing-row" style={{ padding: '2px 0 8px' }}>
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="typing-dot" />
            {info.name} {t('typing')}
          </div>
        ))}
      </div>

      {todos.length ? (
        <div className="composer-dock" style={{ paddingTop: 6 }}>
          <button className="todo-pill" onClick={() => setTodosOpen(!todosOpen)}>
            <ListTodo size={14} style={{ color: 'var(--v2-icon-accent)' }} />
            <span style={{ flex: 1 }}>
              {t('todo_title')} · {doneTodos}/{todos.length}
            </span>
            <ChevronDown size={14} style={{ transform: todosOpen ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }} />
          </button>
          {todosOpen ? (
            <div className="dock-card" style={{ marginBottom: 6 }}>
              {todos.map((td, i) => (
                <div key={i} className="row" style={{ gap: 8, padding: '3px 0', fontSize: 13 }}>
                  <span
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: 4,
                      flex: '0 0 auto',
                      background: td.status === 'completed' ? 'var(--v2-state-success-fg)' : td.status === 'in_progress' ? 'var(--v2-bg-accent)' : 'transparent',
                      boxShadow: td.status === 'completed' || td.status === 'in_progress' ? 'none' : 'inset 0 0 0 0.5px var(--v2-border-strong)',
                    }}
                  />
                  <span
                    style={{
                      color: td.status === 'completed' ? 'var(--v2-text-faint)' : td.status === 'in_progress' ? 'var(--v2-text-base)' : 'var(--v2-text-muted)',
                      textDecoration: td.status === 'completed' ? 'line-through' : undefined,
                    }}
                  >
                    {td.content}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {reminders.length ? (
        <div className="composer-dock" style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingTop: 6, paddingBottom: 0 }}>
          {reminders.map((r) => (
            <span key={r.id} className="chip" style={{ flex: '0 0 auto' }}>
              <Clock size={11} />
              {r.title} · {new Date(r.nextFireAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          ))}
        </div>
      ) : null}

      <div className="composer-dock" style={{ paddingTop: 8 }}>
        {sessionApprovals.length ? (
          <div style={{ maxHeight: '42dvh', overflowY: 'auto' }}>
            {sessionApprovals.map((a) => (
              <ApprovalCard key={a.id} request={a} />
            ))}
          </div>
        ) : null}
        <Composer mode={activeMode} onOpenPicker={() => setPickerOpen(true)} />
      </div>

      <ModelPicker open={pickerOpen} onClose={() => setPickerOpen(false)} currentId={activeSession?.modelId ?? settings?.defaultModelId} onPick={(m) => {
        if (!activeSessionId) return
        // Update the in-memory session meta so the chip reflects immediately;
        // the id rides with the next chatSend (same contract as desktop).
        useChatStore.setState((state) => ({
          sessions: state.sessions.map((s) => (s.id === activeSessionId ? { ...s, modelId: m.id } : s)),
        }))
      }} />
    </>
  )
}
