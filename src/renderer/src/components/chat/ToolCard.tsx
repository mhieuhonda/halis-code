/** Tool run row: one quiet line while closed, full detail when expanded. */
import { useState } from 'react'
import {
  ChevronRight,
  FileText,
  TerminalSquare,
  Search,
  ListChecks,
  Zap,
  MessageSquare,
  FilePen,
  FolderOpen,
  ShieldQuestion,
} from 'lucide-react'
import type { ToolRun } from '@shared/types'
import { useT } from '../../i18n'
import { Badge, Spinner } from '../ui'
import { DiffView, diffForTool } from './DiffView'

const TOOL_ICONS: Record<string, React.ReactNode> = {
  read_file: <FileText size={12} />,
  list_dir: <FolderOpen size={12} />,
  write_file: <FilePen size={12} />,
  edit_file: <FilePen size={12} />,
  glob: <Search size={12} />,
  grep: <Search size={12} />,
  run_command: <TerminalSquare size={12} />,
  telegraph_ask: <Zap size={12} />,
  telegraph_miners: <Zap size={12} />,
  telegraph_intents: <Zap size={12} />,
  telegraph_verify: <Zap size={12} />,
  send_message: <MessageSquare size={12} />,
  task_board_list: <ListChecks size={12} />,
  task_board_create: <ListChecks size={12} />,
  task_board_claim: <ListChecks size={12} />,
  task_board_update: <ListChecks size={12} />,
}

const TOOL_VERBS: Record<string, string> = {
  read_file: 'Read',
  list_dir: 'List',
  write_file: 'Write',
  edit_file: 'Edit',
  glob: 'Glob',
  grep: 'Grep',
  run_command: 'Shell',
  telegraph_ask: 'Ask',
  telegraph_miners: 'Miners',
  telegraph_intents: 'Intents',
  telegraph_verify: 'Verify',
  send_message: 'Message',
  task_board_list: 'Board',
  task_board_create: 'Task',
  task_board_claim: 'Claim',
  task_board_update: 'Task',
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

const STATE_ICON: Record<ToolRun['state'], string> = {
  pending: 'text-faint',
  running: 'text-cyan',
  'awaiting-approval': 'text-amber',
  completed: 'text-good',
  error: 'text-red',
  rejected: 'text-faint',
}

export function ToolCard({ run }: { run: ToolRun }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const icon = TOOL_ICONS[run.tool] ?? <ShieldQuestion size={12} />
  const verb = TOOL_VERBS[run.tool]
  const result = typeof run.result === 'string' ? run.result : JSON.stringify(run.result ?? '')
  const diff = open ? diffForTool(run.tool, run.args) : null
  const duration = run.endedAt && run.startedAt ? ((run.endedAt - run.startedAt) / 1000).toFixed(1) : null

  return (
    <div className={`rounded-xl border overflow-hidden transition-colors duration-200 ${open ? 'border-line2 bg-panel2/80' : 'border-line bg-panel2/50 hover:bg-panel2/80'}`}>
      <button className="flex items-center gap-2 px-3 py-[7px] w-full text-left cursor-pointer group" onClick={() => setOpen(!open)}>
        <ChevronRight size={11} className={`text-faint transition-transform duration-200 shrink-0 ${open ? 'rotate-90' : ''}`} />
        <span className={`shrink-0 ${STATE_ICON[run.state]}`}>{icon}</span>
        {verb ? <span className="text-[11.5px] text-muted shrink-0">{verb}</span> : <span className="font-mono text-[11.5px] text-muted shrink-0">{run.tool}</span>}
        <span className="text-[12px] text-ink/75 truncate flex-1 font-mono">{summarizeArgs(run.tool, run.args)}</span>
        {run.state === 'running' ? <Spinner size={11} className="text-cyan shrink-0" /> : null}
        {run.state === 'awaiting-approval' ? <Badge color="#FFB454">{t('approval_title')}</Badge> : null}
        {run.state === 'rejected' ? <Badge color="#59637a">{t('reject')}</Badge> : null}
        {run.state === 'error' ? <Badge color="#FF6B7A">error</Badge> : null}
        {run.state === 'completed' && duration ? <span className="text-[10px] text-faint font-mono shrink-0">{duration}s</span> : null}
      </button>
      {open ? (
        <div className="border-t border-line px-3.5 py-2.5 text-[12px] fade-in">
          {diff ? <DiffView diff={diff} /> : null}
          <details className="mt-1">
            <summary className="font-mono text-[10.5px] text-faint cursor-pointer hover:text-muted select-none">arguments</summary>
            <pre className="font-mono text-[11px] text-muted whitespace-pre-wrap break-all mt-1.5 mb-2 selectable">{JSON.stringify(run.args, null, 2).slice(0, 4000)}</pre>
          </details>
          {run.error ? (
            <>
              <div className="font-mono text-[11px] text-red mb-1">error</div>
              <pre className="font-mono text-[11px] text-red/80 whitespace-pre-wrap break-all selectable">{run.error.slice(0, 2000)}</pre>
            </>
          ) : result ? (
            <>
              <div className="font-mono text-[11px] text-faint mb-1 mt-1">{run.state === 'completed' ? 'output' : 'result'}</div>
              <pre className="font-mono text-[11px] text-muted whitespace-pre-wrap break-all max-h-72 overflow-y-auto selectable">{result.slice(0, 6000)}</pre>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
