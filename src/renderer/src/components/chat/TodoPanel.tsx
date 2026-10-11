/** Live agent checklist — the todo_write tool rendered as a checklist. */
import { Check, Circle, CircleDot, ListTodo } from 'lucide-react'
import type { TodoItem } from '@shared/types'
import { useT } from '../../i18n'

const STATUS_ICON = {
  pending: <Circle size={12} className="text-faint" />,
  in_progress: <CircleDot size={12} className="text-cyan spark-pulse inline-flex" />,
  completed: <Check size={12} className="text-good" />,
}

export function TodoPanel({ todos }: { todos: TodoItem[] }) {
  const t = useT()
  if (!todos.length) return null
  const done = todos.filter((x) => x.status === 'completed').length
  return (
    <div className="px-5 pb-1">
      <div className="max-w-[780px] mx-auto">
        <div className="rounded-xl border border-line bg-panel2/60 backdrop-blur px-3.5 py-2.5">
          <div className="flex items-center gap-2 mb-1.5">
            <ListTodo size={13} className="text-signal" />
            <span className="text-[11.5px] font-semibold tracking-tight text-muted">{t('todo_title')}</span>
            <span className="ml-auto text-[10.5px] text-faint font-mono">
              {done}/{todos.length}
            </span>
          </div>
          <div className="space-y-1">
            {todos.map((todo, i) => (
              <div key={`${todo.content}-${i}`} className="flex items-start gap-2 text-[12.5px]">
                <span className="mt-[3px] shrink-0">{STATUS_ICON[todo.status]}</span>
                <span className={todo.status === 'completed' ? 'text-faint line-through' : todo.status === 'in_progress' ? 'text-ink' : 'text-muted'}>{todo.content}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
