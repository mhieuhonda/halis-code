/** Sessions drawer — per-mode list, rename/delete. */
import { useState } from 'react'
import { MessageSquarePlus, Pencil, Trash2, X } from 'lucide-react'
import type { SessionMeta } from '@shared/types'
import { useChatStore } from '../stores/chat'
import { useT } from '../i18n'

export function SessionsDrawer({
  open,
  mode,
  onClose,
  onNew,
}: {
  open: boolean
  mode: 'agent' | 'swarm'
  onClose: () => void
  onNew: () => void
}) {
  const t = useT()
  const sessions = useChatStore((s) => s.sessions)
  const activeSessionId = useChatStore((s) => s.activeSessionId)
  const openSession = useChatStore((s) => s.openSession)
  const deleteSession = useChatStore((s) => s.deleteSession)
  const renameSession = useChatStore((s) => s.renameSession)
  const [renaming, setRenaming] = useState<SessionMeta | null>(null)
  const [renameText, setRenameText] = useState('')

  if (!open) return null
  const filtered = sessions.filter((s) => s.mode === mode)

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="drawer">
        <div className="topbar" style={{ borderTop: 'none' }}>
          <b className="grow">{t('sessions')}</b>
          <button className="icon-btn" onClick={onClose} aria-label="close">
            <X size={19} />
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filtered.map((s) => (
            <div key={s.id} className={`session-row ${s.id === activeSessionId ? 'active' : ''}`} style={{ display: 'flex' }} onClick={() => void openSession(s.id)}>
              <div className="grow" style={{ minWidth: 0 }}>
                {renaming?.id === s.id ? (
                  <input
                    className="field"
                    style={{ minHeight: 34, padding: '4px 10px', fontSize: 14 }}
                    autoFocus
                    value={renameText}
                    onChange={(e) => setRenameText(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        void renameSession(s.id, renameText)
                        setRenaming(null)
                      }
                    }}
                  />
                ) : (
                  <>
                    <div className="t">{s.title}</div>
                    <div className="s">
                      {s.messageCount} · {new Date(s.updatedAt).toLocaleDateString()}
                    </div>
                  </>
                )}
              </div>
              <button
                className="icon-btn"
                style={{ width: 34, height: 34 }}
                onClick={(e) => {
                  e.stopPropagation()
                  setRenaming(s)
                  setRenameText(s.title)
                }}
                aria-label="rename"
              >
                <Pencil size={15} />
              </button>
              <button
                className="icon-btn"
                style={{ width: 34, height: 34 }}
                onClick={(e) => {
                  e.stopPropagation()
                  if (confirm(`${t('delete_session')}: ${s.title}?`)) void deleteSession(s.id)
                }}
                aria-label="delete"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          {!filtered.length ? <div className="hint" style={{ padding: 24, textAlign: 'center' }}>{t('no_sessions')}</div> : null}
        </div>
        <div className="panel" style={{ padding: 10 }}>
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={onNew}>
            <MessageSquarePlus size={17} />
            {mode === 'swarm' ? t('new_swarm_session') : t('new_chat')}
          </button>
        </div>
      </div>
    </>
  )
}
