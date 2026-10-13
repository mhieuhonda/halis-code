/** Live agent checklist — the todo_write tool rendered as a quiet card
 *  in the composer seat. */
import { Check, Circle, CircleDot, ListTodo } from 'lucide-react'
import type { TodoItem } from '@shared/types'
import { useT } from '../../i18n'

const STATUS_ICON = {
  pending: <Circle size={12} className="text-[color:var(--hal-alias-label-dimmed)]" />,
  in_progress: <CircleDot size={12} className="text-[color:var(--hal-alias-state-business-primary)] pending-dot inline-flex" />,
  completed: <Check size={12} className="text-[color:var(--hal-alias-state-success-primary)]" />,
}

export function TodoPanel({ todos }: { todos: TodoItem[] }) {
  const t = useT()
  if (!todos.length) return null
  const done = todos.filter((x) => x.status === 'completed').length
  return (
    <div className="px-4 pb-1.5">
      <div className="rounded-lg border-[0.5px] border-[color:var(--hal-alias-border-l2)] px-3.5 py-2.5" style={{ background: 'var(--hal-specific-input-major)' }}>
        <div className="flex items-center gap-2 mb-1.5">
          <ListTodo size={13} className="text-[color:var(--hal-alias-state-business-primary)]" />
          <span className="text-[12px] font-medium text-[color:var(--hal-alias-label-secondary)]">{t('todo_title')}</span>
          <span className="ml-auto text-[10.5px] text-[color:var(--hal-alias-label-caption)] font-mono">
            {done}/{todos.length}
          </span>
        </div>
        <div className="space-y-1">
          {todos.map((todo, i) => (
            <div key={`${todo.content}-${i}`} className="flex items-start gap-2 text-[12.5px] leading-5">
              <span className="mt-[2px] shrink-0">{STATUS_ICON[todo.status]}</span>
              <span
                className={
                  todo.status === 'completed'
                    ? 'text-[color:var(--hal-alias-label-tertiary)] line-through'
                    : todo.status === 'in_progress'
                      ? 'text-ink'
                      : 'text-[color:var(--hal-alias-label-secondary)]'
                }
              >
                {todo.content}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
