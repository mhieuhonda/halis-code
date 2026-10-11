/** Tool run card: collapsible, state-colored, shows args + result. */
import { useState } from 'react'
import { ChevronRight, FileText, TerminalSquare, Search, ListChecks, Zap, MessageSquare, FilePen, FolderOpen, ShieldQuestion } from 'lucide-react'
import type { ToolRun } from '@shared/types'
import { useT } from '../../i18n'
import { Badge, Spinner } from '../ui'

const TOOL_ICONS: Record<string, React.ReactNode> = {
  read_file: <FileText size={13} />,
  list_dir: <FolderOpen size={13} />,
  write_file: <FilePen size={13} />,
  edit_file: <FilePen size={13} />,
  glob: <Search size={13} />,
  grep: <Search size={13} />,
  run_command: <TerminalSquare size={13} />,
  telegraph_ask: <Zap size={13} />,
  telegraph_miners: <Zap size={13} />,
  telegraph_intents: <Zap size={13} />,
  telegraph_verify: <Zap size={13} />,
  send_message: <MessageSquare size={13} />,
  task_board_list: <ListChecks size={13} />,
  task_board_create: <ListChecks size={13} />,
  task_board_claim: <ListChecks size={13} />,
  task_board_update: <ListChecks size={13} />,
}

function summarizeArgs(tool: string, args: Record<string, unknown>): string {
  switch (tool) {
    case 'read_file':
      return String(args.path ?? '')
    case 'write_file':
      return `${String(args.path ?? '')} · ${String(args.content ?? '').length} chars`
    case 'edit_file':
      return String(args.path ?? '')
    case 'list_dir':
      return String(args.path ?? '.')
    case 'glob':
      return String(args.pattern ?? '')
    case 'grep':
      return String(args.pattern ?? '')
    case 'run_command':
      return String(args.command ?? '').slice(0, 120)
    case 'telegraph_ask':
      return String(args.query ?? '').slice(0, 120)
    case 'telegraph_verify':
      return String(args.signal_hash ?? '')
    case 'send_message':
      return `→ ${(Array.isArray(args.to) ? args.to : []).join(', ')}`
    case 'task_board_create':
      return String(args.title ?? '')
    case 'task_board_claim':
      return String(args.task ?? '')
    case 'task_board_update':
      return `${String(args.task ?? '')} ${args.status ? `→ ${String(args.status)}` : ''}`
    default:
      return Object.entries(args)
        .slice(0, 3)
        .map(([k, v]) => `${k}: ${String(v).slice(0, 40)}`)
        .join(' · ')
  }
}

const STATE_STYLES: Record<ToolRun['state'], string> = {
  pending: 'text-muted',
  running: 'text-cyan',
  'awaiting-approval': 'text-amber',
  completed: 'text-good',
  error: 'text-red',
  rejected: 'text-faint',
}

export function ToolCard({ run }: { run: ToolRun }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const icon = TOOL_ICONS[run.tool] ?? <ShieldQuestion size={13} />
  const result = typeof run.result === 'string' ? run.result : JSON.stringify(run.result ?? '')

  return (
    <div className="rounded-xl border border-line bg-panel2/70 overflow-hidden my-1.5 w-full max-w-[720px]">
      <button className="flex items-center gap-2 px-3 py-2 w-full text-left cursor-pointer hover:bg-panel3/60 transition-colors" onClick={() => setOpen(!open)}>
        <ChevronRight size={12} className={`text-faint transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className={`shrink-0 ${STATE_STYLES[run.state]}`}>{icon}</span>
        <span className="font-mono text-[11.5px] text-muted shrink-0">{run.tool}</span>
        <span className="text-[12px] text-ink/70 truncate flex-1">{summarizeArgs(run.tool, run.args)}</span>
        {run.state === 'running' ? <Spinner size={12} className="text-cyan shrink-0" /> : null}
        {run.state === 'awaiting-approval' ? <Badge color="#FBBF24">{t('approval_title')}</Badge> : null}
        {run.state === 'rejected' ? <Badge color="#5c6778">{t('reject')}</Badge> : null}
        {run.state === 'error' ? <Badge color="#F87171">error</Badge> : null}
      </button>
      {open ? (
        <div className="border-t border-line px-3.5 py-2.5 text-[12px]">
          <div className="font-mono text-[11px] text-faint mb-2">arguments</div>
          <pre className="font-mono text-[11px] text-muted whitespace-pre-wrap break-all mb-2.5 selectable">{JSON.stringify(run.args, null, 2).slice(0, 4000)}</pre>
          {run.error ? (
            <>
              <div className="font-mono text-[11px] text-red mb-1">error</div>
              <pre className="font-mono text-[11px] text-red/80 whitespace-pre-wrap break-all selectable">{run.error.slice(0, 2000)}</pre>
            </>
          ) : result ? (
            <>
              <div className="font-mono text-[11px] text-faint mb-1">{run.state === 'completed' ? 'output' : 'result'}</div>
              <pre className="font-mono text-[11px] text-muted whitespace-pre-wrap break-all max-h-72 overflow-y-auto selectable">{result.slice(0, 6000)}</pre>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
