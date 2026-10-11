/** Task board view: kanban columns, claim buttons, agent assignments. */
import { useEffect, useState } from 'react'
import { ListChecks, Lock, Plus } from 'lucide-react'
import type { BoardTask, TaskStatus } from '@shared/types'
import { useT } from '../../i18n'
import { useChatStore } from '../../stores/chat'
import { useSwarmStore } from '../../stores/swarm'
import { Badge, Button, Input, Modal, SectionTitle, Textarea } from '../ui'

const COLUMNS: Array<{ status: TaskStatus; labelKey: 'status_todo' | 'status_in_progress' | 'status_blocked' | 'status_done' }> = [
  { status: 'todo', labelKey: 'status_todo' },
  { status: 'in_progress', labelKey: 'status_in_progress' },
  { status: 'blocked', labelKey: 'status_blocked' },
  { status: 'done', labelKey: 'status_done' },
]

function TaskCard({ task }: { task: BoardTask }) {
  const t = useT()
  const chat = useChatStore()
  const agents = useSwarmStore((s) => s.config.agents)
  const agent = agents.find((a) => a.id === task.assignee)
  return (
    <div className="rounded-xl border border-line bg-panel2 px-3 py-2.5 mb-2 group hover:border-line2 transition-colors">
      <div className="text-[12.5px] font-medium leading-snug mb-1.5">{task.title}</div>
      {task.description ? <div className="text-[11px] text-muted leading-relaxed mb-1.5">{task.description}</div> : null}
      <div className="flex items-center gap-1.5 flex-wrap">
        {agent ? (
          <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: agent.color }}>
            {agent.avatar} {agent.name}
          </span>
        ) : (
          <span className="text-[11px] text-faint">{t('unassigned')}</span>
        )}
        <span className="text-[10px] text-faint font-mono ml-auto">#{task.id.slice(-6)}</span>
      </div>
      <div className="flex gap-1.5 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
        {task.status !== 'done' ? (
          <Button size="sm" variant="ghost" className="!text-[11px] !py-0.5" onClick={() => void chat.updateTask(task.id, { status: task.status === 'todo' ? 'in_progress' : 'done' })}>
            {task.status === 'todo' ? '→ ' + t('status_in_progress') : '→ ' + t('status_done')}
          </Button>
        ) : null}
        {task.status === 'blocked' ? (
          <Button size="sm" variant="ghost" className="!text-[11px] !py-0.5" onClick={() => void chat.updateTask(task.id, { status: 'todo' })}>
            → {t('status_todo')}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

export function TaskBoardView() {
  const t = useT()
  const chat = useChatStore()
  const locks = chat.locks
  const [createOpen, setCreateOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')

  useEffect(() => {
    void chat.loadTasks()
  }, [])

  const create = async () => {
    if (!title.trim()) return
    await chat.createTask(title.trim(), description.trim() || undefined)
    setTitle('')
    setDescription('')
    setCreateOpen(false)
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between">
          <SectionTitle hint={`${chat.tasks.length}`}>{t('tasks_title')}</SectionTitle>
          <Button size="sm" variant="primary" onClick={() => setCreateOpen(true)}>
            <Plus size={13} /> {t('task_new')}
          </Button>
        </div>
        <p className="text-[13px] text-muted -mt-2 mb-5">{t('tasks_subtitle')}</p>

        {/* file locks */}
        {locks.length ? (
          <div className="rounded-xl border border-amber/30 bg-amber/5 px-4 py-2.5 mb-5 flex items-center gap-2 flex-wrap">
            <Lock size={13} className="text-amber" />
            <span className="text-[12px] text-amber/90 font-medium">{t('lock_title')}:</span>
            {locks.map((l) => (
              <Badge key={`${l.path}-${l.holderAgentId}`} color="#FBBF24">
                {l.path.split(/[\\/]/).pop()} — {t('lock_holder')} {l.holderName} ({l.mode})
              </Badge>
            ))}
          </div>
        ) : null}

        {chat.tasks.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line px-4 py-12 text-center text-muted text-[13px] flex flex-col items-center gap-2">
            <ListChecks size={22} className="text-faint" />
            {t('empty_board')}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {COLUMNS.map((col) => {
              const tasks = chat.tasks.filter((task) => task.status === col.status)
              return (
                <div key={col.status} className="rounded-2xl border border-line bg-panel/50 p-2.5 min-h-[140px]">
                  <div className="flex items-center justify-between px-1 mb-2">
                    <span className="text-[11.5px] font-semibold text-muted">{t(col.labelKey)}</span>
                    <span className="text-[10.5px] text-faint font-mono">{tasks.length}</span>
                  </div>
                  {tasks.map((task) => (
                    <TaskCard key={task.id} task={task} />
                  ))}
                </div>
              )
            })}
          </div>
        )}

        <Modal open={createOpen} onClose={() => setCreateOpen(false)} title={t('task_new')}>
          <div className="space-y-3">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('task_title')} autoFocus onKeyDown={(e) => { if (e.key === 'Enter') void create() }} />
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('task_desc')} rows={3} />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setCreateOpen(false)}>
                {t('cancel')}
              </Button>
              <Button variant="primary" onClick={() => void create()} disabled={!title.trim()}>
                {t('create')}
              </Button>
            </div>
          </div>
        </Modal>
      </div>
    </div>
  )
}
