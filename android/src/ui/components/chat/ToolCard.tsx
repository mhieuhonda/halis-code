/**
 * Tool row — desktop recipe: a 16px status icon, 13px/530 tool name, muted
 * argument subtitle, tabular duration, and an expandable body hanging off a
 * 0.5px vertical guide line.
 */
import { memo, useState } from 'react'
import { Check, ChevronDown, CircleDashed, X, ShieldQuestion } from 'lucide-react'
import type { ToolRun } from '@shared/types'
import { useT } from '../../i18n'

const stateIcon = (state: ToolRun['state']) => {
  switch (state) {
    case 'completed':
      return <Check size={13} style={{ color: 'var(--v2-state-success-fg)' }} />
    case 'error':
    case 'rejected':
      return <X size={13} style={{ color: 'var(--v2-state-danger-fg)' }} />
    case 'awaiting-approval':
      return <ShieldQuestion size={13} style={{ color: 'var(--v2-state-warning-fg)' }} />
    case 'running':
      return <span className="spinner" style={{ width: 12, height: 12 }} />
    case 'pending':
    default:
      return <CircleDashed size={13} style={{ color: 'var(--v2-icon-faint)' }} />
  }
}

function argSummary(run: ToolRun): string {
  const a = run.args ?? {}
  const keys = Object.keys(a).filter((k) => k !== '_raw')
  if (!keys.length) return ''
  const parts: string[] = []
  for (const key of keys.slice(0, 2)) {
    const value = typeof a[key] === 'string' ? (a[key] as string).slice(0, 40) : JSON.stringify(a[key])?.slice(0, 40)
    parts.push(value ?? '')
  }
  return parts.filter(Boolean).join(' · ')
}

export const ToolCard = memo(function ToolCard({ run }: { run: ToolRun }) {
  const [open, setOpen] = useState(false)
  const t = useT()
  const failed = run.state === 'error' || run.state === 'rejected'
  const stateLabel =
    run.state === 'completed'
      ? t('connected')
      : run.state === 'error'
        ? t('error')
        : run.state === 'awaiting-approval'
          ? t('approval_title')
          : run.state === 'rejected'
            ? t('stopped')
            : undefined
  const duration = run.endedAt ? Math.max(1, Math.round((run.endedAt - run.startedAt) / 100) / 10) : undefined
  const output = typeof run.result === 'string' ? run.result : run.result ? JSON.stringify(run.result, null, 2) : run.error ?? ''

  return (
    <div className="tool-row">
      <button className="tool-trigger" onClick={() => setOpen(!open)}>
        <span className="tool-icon">{stateIcon(run.state)}</span>
        <span className="tool-title">{run.tool}</span>
        <span className={`tool-sub ${failed ? 'error' : ''}`}>{argSummary(run)}</span>
        {stateLabel ? <span className="tool-status">{stateLabel}</span> : null}
        {duration !== undefined ? <span className="tool-status">{duration}s</span> : null}
        <ChevronDown size={13} style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .15s', color: 'var(--v2-icon-faint)', flex: '0 0 auto' }} />
      </button>
      {open ? (
        <div className="tool-body">
          <div className="tool-output selectable">{output || '—'}</div>
        </div>
      ) : null}
    </div>
  )
})
