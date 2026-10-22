/** Tool run card — collapsible, state-colored. */
import { memo, useState } from 'react'
import { CheckCircle2, ChevronDown, CircleDashed, Clock, XCircle, ShieldQuestion } from 'lucide-react'
import type { ToolRun } from '@shared/types'
import { useT } from '../../i18n'

const stateIcon = (state: ToolRun['state']) => {
  switch (state) {
    case 'completed':
      return <CheckCircle2 size={14} style={{ color: 'var(--hal-green)' }} />
    case 'error':
    case 'rejected':
      return <XCircle size={14} style={{ color: 'var(--hal-red)' }} />
    case 'awaiting-approval':
      return <ShieldQuestion size={14} style={{ color: 'var(--hal-amber)' }} />
    case 'running':
      return <span className="spinner" style={{ width: 12, height: 12 }} />
    case 'pending':
    default:
      return <CircleDashed size={14} style={{ color: 'var(--hal-ink-muted)' }} />
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
  const stateLabel =
    run.state === 'completed'
      ? t('connected')
      : run.state === 'error'
        ? t('error')
        : run.state === 'awaiting-approval'
          ? t('approval_title')
          : run.state === 'rejected'
            ? t('stopped')
            : run.state === 'running'
              ? t('working')
              : ''
  const duration = run.endedAt ? Math.max(1, Math.round((run.endedAt - run.startedAt) / 100) / 10) : undefined
  const output = typeof run.result === 'string' ? run.result : run.result ? JSON.stringify(run.result, null, 2) : run.error ?? ''

  return (
    <div className="tool-card">
      <button className="tool-head" onClick={() => setOpen(!open)} style={{ width: '100%', border: 'none', background: 'transparent' }}>
        {stateIcon(run.state)}
        <span style={{ fontWeight: 650, color: 'var(--hal-ink)' }}>{run.tool}</span>
        <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 450 }}>
          {argSummary(run)}
        </span>
        {duration !== undefined ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: 'var(--hal-ink-muted)', fontSize: 11 }}>
            <Clock size={11} />
            {duration}s
          </span>
        ) : null}
        <ChevronDown size={13} style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .15s', color: 'var(--hal-ink-muted)' }} />
      </button>
      {open ? (
        <div className="tool-output">
          {stateLabel ? <div style={{ marginBottom: 4, fontWeight: 600 }}>{stateLabel}</div> : null}
          {output || '—'}
        </div>
      ) : null}
    </div>
  )
})
