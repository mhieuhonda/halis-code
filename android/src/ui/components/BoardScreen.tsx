/** Task board tab — shared kanban, compact for phones. */
import { useEffect, useState } from 'react'
import { Plus, RefreshCw } from 'lucide-react'
import type { BoardTask, TaskStatus } from '@shared/types'
import { useChatStore } from '../stores/chat'
import { useT } from '../i18n'
import { Sheet } from './ui'

const COLUMNS: Array<{ status: TaskStatus; key: 'status_todo' | 'status_in_progress' | 'status_blocked' | 'status_done'; color: string }> = [
  { status: 'todo', key: 'status_todo', color: 'var(--hal-ink-muted)' },
  { status: 'in_progress', key: 'status_in_progress', color: 'var(--hal-accent)' },
  { status: 'blocked', key: 'status_blocked', color: 'var(--hal-amber)' },
  { status: 'done', key: 'status_done', color: 'var(--hal-green)' },
]

export function BoardScreen() {
  const t = useT()
  const tasks = useChatStore((s) => s.tasks)
  const loadTasks = useChatStore((s) => s.loadTasks)
  const createTask = useChatStore((s) => s.createTask)
  const updateTask = useChatStore((s) => s.updateTask)
  const [createOpen, setCreateOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [selected, setSelected] = useState<BoardTask | null>(null)

  useEffect(() => {
    void loadTasks()
  }, [loadTasks])

  return (
    <>
      <div className="topbar safe-top">
        <b className="grow">{t('tasks_title')}</b>
        <button className="icon-btn" onClick={() => void loadTasks()} aria-label="refresh">
          <RefreshCw size={18} />
        </button>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => {
            setTitle('')
            setDesc('')
            setCreateOpen(true)
          }}
        >
          <Plus size={15} /> {t('task_new')}
        </button>
      </div>

      <div className="screen">
        {COLUMNS.map((col) => {
          const list = tasks.filter((task) => task.status === col.status)
          return (
            <div key={col.status} className="kanban-col">
              <div className="row" style={{ gap: 7, marginBottom: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: 4, background: col.color }} />
                <b style={{ fontSize: 13.5 }}>{t(col.key)}</b>
                <span className="chip">{list.length}</span>
              </div>
              {list.map((task) => (
                <button
                  key={task.id}
                  className="card kanban-card"
                  style={{ width: '100%', textAlign: 'left', cursor: 'pointer' }}
                  onClick={() => setSelected(task)}
                >
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{task.title}</div>
                  {task.description ? <div className="hint" style={{ marginTop: 2 }}>{task.description}</div> : null}
                  <div className="row" style={{ marginTop: 6, gap: 6 }}>
                    <span className="chip" style={{ fontSize: 10.5 }}>#{task.id.slice(-6)}</span>
                    {task.assigneeName ? <span className="chip chip-accent" style={{ fontSize: 10.5 }}>{task.assigneeName}</span> : <span className="chip" style={{ fontSize: 10.5 }}>{t('unassigned')}</span>}
                    {task.blockedReason ? <span className="chip chip-amber" style={{ fontSize: 10.5 }}>{task.blockedReason}</span> : null}
                  </div>
                </button>
              ))}
              {!list.length ? <div className="hint" style={{ padding: '2px 0 6px' }}>—</div> : null}
            </div>
          )
        })}
        {!tasks.length ? <div className="hint" style={{ textAlign: 'center', padding: 30 }}>{t('empty_board')}</div> : null}
      </div>

      <Sheet open={createOpen} onClose={() => setCreateOpen(false)} title={t('task_new')}>
        <input className="field" placeholder={t('task_title')} value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea className="field" style={{ marginTop: 8 }} rows={3} placeholder={t('task_desc')} value={desc} onChange={(e) => setDesc(e.target.value)} />
        <button
          className="btn btn-primary"
          style={{ width: '100%', marginTop: 10 }}
          disabled={!title.trim()}
          onClick={() => {
            void createTask(title.trim(), desc.trim() || undefined)
            setCreateOpen(false)
          }}
        >
          {t('create')}
        </button>
      </Sheet>

      <Sheet open={!!selected} onClose={() => setSelected(null)} title={selected?.title}>
        {selected ? (
          <>
            {selected.description ? <div className="hint" style={{ marginBottom: 10 }}>{selected.description}</div> : null}
            <div className="hint" style={{ marginBottom: 10 }}>
              #{selected.id.slice(-6)} · {selected.assigneeName ?? t('unassigned')}
              {selected.blockedReason ? ` · ${selected.blockedReason}` : ''}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {COLUMNS.map((col) => (
                <button
                  key={col.status}
                  className={`btn btn-sm ${selected.status === col.status ? 'btn-primary' : ''}`}
                  onClick={() => {
                    void updateTask(selected.id, { status: col.status, blockedReason: col.status === 'blocked' ? selected.blockedReason ?? 'blocked' : undefined })
                    setSelected(null)
                  }}
                >
                  {t(col.key)}
                </button>
              ))}
            </div>
            {selected.status === 'blocked' ? (
              <button
                className="btn"
                style={{ width: '100%', marginTop: 8 }}
                onClick={() => {
                  void updateTask(selected.id, { status: 'todo', blockedReason: '' })
                  setSelected(null)
                }}
              >
                {t('status_todo')} (unblock)
              </button>
            ) : null}
          </>
        ) : null}
      </Sheet>
    </>
  )
}
