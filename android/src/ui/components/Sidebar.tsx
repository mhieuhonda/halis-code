/**
 * Sidebar — the desktop sidebar as a slide-in drawer. Deep chrome, 36px
 * session rows with 16px avatars, sessions grouped by day, footer rows for
 * the other panels. Long-press-free: the active row exposes rename/delete.
 */
import { useMemo, useState } from 'react'
import {
  ListTodo,
  Pencil,
  Settings as SettingsIcon,
  SquarePen,
  Trash2,
  Users,
  Wallet,
  X,
} from 'lucide-react'
import logoUrl from '../../assets/logo.png'
import type { SessionMeta } from '@shared/types'
import { useChatStore } from '../stores/chat'
import { useT } from '../i18n'
import type { Route } from '../../App'

type Group = { label: 'today' | 'yesterday' | 'this_week' | 'older'; sessions: SessionMeta[] }

/** Bucket sessions into Today / Yesterday / This week / Older. */
function groupSessions(sessions: SessionMeta[]): Group[] {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfYesterday = startOfToday - 86_400_000
  const startOfWeek = startOfToday - 6 * 86_400_000
  const groups: Group[] = [
    { label: 'today', sessions: [] },
    { label: 'yesterday', sessions: [] },
    { label: 'this_week', sessions: [] },
    { label: 'older', sessions: [] },
  ]
  for (const session of sessions) {
    const ts = session.updatedAt || session.createdAt
    if (ts >= startOfToday) groups[0]!.sessions.push(session)
    else if (ts >= startOfYesterday) groups[1]!.sessions.push(session)
    else if (ts >= startOfWeek) groups[2]!.sessions.push(session)
    else groups[3]!.sessions.push(session)
  }
  return groups.filter((g) => g.sessions.length > 0)
}

export function Sidebar({
  open,
  route,
  onClose,
  onNavigate,
  approvals,
  running,
}: {
  open: boolean
  route: Route
  onClose: () => void
  onNavigate: (route: Route) => void
  approvals: boolean
  running: boolean
}) {
  const t = useT()
  const sessions = useChatStore((s) => s.sessions)
  const activeSessionId = useChatStore((s) => s.activeSessionId)
  const openSession = useChatStore((s) => s.openSession)
  const deleteSession = useChatStore((s) => s.deleteSession)
  const renameSession = useChatStore((s) => s.renameSession)
  const newSession = useChatStore((s) => s.newSession)
  const [query, setQuery] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameText, setRenameText] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = [...sessions].sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt))
    if (!q) return list
    return list.filter((s) => s.title.toLowerCase().includes(q))
  }, [sessions, query])

  const groups = useMemo(() => groupSessions(filtered), [filtered])

  const openOne = async (session: SessionMeta) => {
    onClose()
    if (useChatStore.getState().activeMode !== session.mode) {
      useChatStore.setState({ activeMode: session.mode })
    }
    await openSession(session.id)
    onNavigate('chat')
  }

  const startNew = async () => {
    onClose()
    onNavigate('chat')
    await newSession(useChatStore.getState().activeMode)
  }

  if (!open) return null

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer">
        <div className="sb-head">
          <img src={logoUrl} alt="" className="brand-mark" draggable={false} />
          <span className="t">Halis Code</span>
          {approvals ? <span className="chip chip-amber">{t('approval_title')}</span> : null}
          <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={onClose} aria-label="close">
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: '0 10px' }}>
          <button className="sb-new" onClick={() => void startNew()}>
            <SquarePen size={14} />
            {t('new_chat')}
          </button>
        </div>

        <div style={{ padding: '8px 10px 0' }}>
          <input className="field" style={{ minHeight: 32, padding: '4px 10px' }} placeholder={t('search')} value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>

        <div className="sb-spacer" />

        <div className="sb-body">
          {groups.map((group) => (
            <div key={group.label}>
              <div className="sb-group">{t(group.label === 'today' ? 'group_today' : group.label === 'yesterday' ? 'group_yesterday' : group.label === 'this_week' ? 'group_this_week' : 'group_older')}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1, paddingBottom: 8 }}>
                {group.sessions.map((session) => {
                  const active = session.id === activeSessionId
                  return (
                    <div key={session.id} className={`sb-row ${active ? 'active' : ''}`} onClick={() => void openOne(session)}>
                      <span
                        className="sb-avatar"
                        style={{
                          background: `linear-gradient(180deg, #ffffff29, #ffffff00), ${session.mode === 'swarm' ? 'var(--v2-avatar-swarm-bg)' : 'var(--v2-avatar-agent-bg)'}`,
                        }}
                      >
                        {session.mode === 'swarm' ? 'S' : 'A'}
                      </span>
                      {renaming === session.id ? (
                        <input
                          className="field"
                          style={{ minHeight: 26, padding: '2px 8px', flex: 1 }}
                          autoFocus
                          value={renameText}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => setRenameText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              void renameSession(session.id, renameText)
                              setRenaming(null)
                            }
                          }}
                        />
                      ) : (
                        <span className="t">{session.title}</span>
                      )}
                      {running && active ? <span className="spinner" style={{ width: 12, height: 12 }} /> : null}
                      {active ? (
                        <span className="sb-row-actions">
                          <button
                            className="icon-btn"
                            style={{ width: 24, height: 24 }}
                            onClick={(e) => {
                              e.stopPropagation()
                              setRenaming(session.id)
                              setRenameText(session.title)
                            }}
                            aria-label="rename"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            className="icon-btn"
                            style={{ width: 24, height: 24 }}
                            onClick={(e) => {
                              e.stopPropagation()
                              if (confirm(`${t('delete_session')}: ${session.title}?`)) void deleteSession(session.id)
                            }}
                            aria-label="delete"
                          >
                            <Trash2 size={13} />
                          </button>
                        </span>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
          {!groups.length ? <div className="hint" style={{ padding: '12px 8px' }}>{t('no_sessions')}</div> : null}
        </div>

        <div className="sb-footer">
          <button className={`sb-footer-row ${route === 'chat' ? 'active' : ''}`} onClick={() => onNavigate('chat')}>
            <SquarePen size={15} />
            {t('nav_chat')}
          </button>
          <button className={`sb-footer-row ${route === 'swarm' ? 'active' : ''}`} onClick={() => onNavigate('swarm')}>
            <Users size={15} />
            {t('nav_swarm_setup')}
          </button>
          <button className={`sb-footer-row ${route === 'telegraph' ? 'active' : ''}`} onClick={() => onNavigate('telegraph')}>
            <Wallet size={15} />
            {t('nav_telegraph')}
          </button>
          <button className={`sb-footer-row ${route === 'board' ? 'active' : ''}`} onClick={() => onNavigate('board')}>
            <ListTodo size={15} />
            {t('nav_tasks')}
          </button>
          <button className={`sb-footer-row ${route === 'settings' ? 'active' : ''}`} onClick={() => onNavigate('settings')}>
            <SettingsIcon size={15} />
            {t('nav_settings')}
          </button>
        </div>
      </aside>
    </>
  )
}
