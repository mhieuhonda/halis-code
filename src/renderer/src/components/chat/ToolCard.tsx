/** Tool run row — DSH disclosure row: 24px header, chevron, status dot,
 *  summary; expanded IN/OUT cards on the markdown-code-block surface. */
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
  Globe,
  ListTodo,
  MessageCircleQuestion,
  SquareActivity,
  SquareX,
  AlarmClock,
  AlarmClockOff,
  GitBranch,
  GitCompare,
  GitCommitHorizontal,
  History,
  Split,
  BookOpen,
} from 'lucide-react'
import type { ToolRun } from '@shared/types'
import { useT } from '../../i18n'
import { Spinner } from '../ui'
import { DiffView, diffForTool } from './DiffView'

const TOOL_ICONS: Record<string, React.ReactNode> = {
  read_file: <FileText size={13} />,
  list_dir: <FolderOpen size={13} />,
  write_file: <FilePen size={13} />,
  edit_file: <FilePen size={13} />,
  multi_edit: <FilePen size={13} />,
  delete_file: <FilePen size={13} />,
  read_image: <FileText size={13} />,
  apply_patch: <FilePen size={13} />,
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
  /* extended tools */
  web_fetch: <Globe size={13} />,
  web_search: <Search size={13} />,
  todo_write: <ListTodo size={13} />,
  ask_user: <MessageCircleQuestion size={13} />,
  job_list: <SquareActivity size={13} />,
  job_output: <SquareActivity size={13} />,
  job_kill: <SquareX size={13} />,
  schedule_create: <AlarmClock size={13} />,
  schedule_list: <AlarmClock size={13} />,
  schedule_delete: <AlarmClockOff size={13} />,
  git_status: <GitBranch size={13} />,
  git_diff: <GitCompare size={13} />,
  git_log: <History size={13} />,
  git_commit: <GitCommitHorizontal size={13} />,
  delegate_task: <Split size={13} />,
  skill: <BookOpen size={13} />,
}

const TOOL_VERBS: Record<string, string> = {
  read_file: 'Read',
  list_dir: 'List',
  write_file: 'Write',
  edit_file: 'Edit',
  multi_edit: 'Multi-edit',
  delete_file: 'Delete',
  read_image: 'Image',
  apply_patch: 'Patch',
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
  web_fetch: 'Fetch',
  web_search: 'Search',
  todo_write: 'Todos',
  ask_user: 'Ask you',
  job_list: 'Jobs',
  job_output: 'Job out',
  job_kill: 'Job kill',
  schedule_create: 'Remind',
  schedule_list: 'Reminders',
  schedule_delete: 'Unremind',
  git_status: 'Git status',
  git_diff: 'Git diff',
  git_log: 'Git log',
  git_commit: 'Commit',
  delegate_task: 'Delegate',
  skill: 'Skill',
}

function summarizeArgs(tool: string, args: Record<string, unknown>): string {
  switch (tool) {
    case 'read_file':
      return String(args.path ?? '')
    case 'write_file':
      return `${String(args.path ?? '')} · ${String(args.content ?? '').length} chars`
    case 'edit_file':
      return String(args.path ?? '')
    case 'multi_edit':
      return `${String(args.path ?? '')} · ${Array.isArray(args.edits) ? args.edits.length : '?'} edit(s)`
    case 'delete_file':
      return String(args.path ?? '')
    case 'read_image':
      return String(args.path ?? '')
    case 'apply_patch':
      return extractPatchFiles(String(args.patch ?? ''))
    case 'list_dir':
      return String(args.path ?? '.')
    case 'glob':
      return String(args.pattern ?? '')
    case 'grep':
      return String(args.pattern ?? '')
    case 'run_command':
      return String(args.command ?? '').slice(0, 120)
    case 'web_fetch':
      return String(args.url ?? '')
    case 'web_search':
      return (Array.isArray(args.queries) ? (args.queries as string[]).join(' | ') : String(args.queries ?? '')).slice(0, 120)
    case 'todo_write':
      return `${Array.isArray(args.todos) ? args.todos.length : 0} item(s)`
    case 'ask_user':
      return Array.isArray(args.questions) ? (args.questions as Array<{ question?: string }>).map((q) => q.question).filter(Boolean).slice(0, 2).join(' · ') : ''
    case 'job_output':
    case 'job_kill':
      return String(args.job_id ?? '')
    case 'schedule_create':
      return `${String(args.title ?? '')} · ${scheduleSelectorLabel(args)}`
    case 'schedule_delete':
      return String(args.id ?? '')
    case 'git_commit':
      return String(args.message ?? '').split('\n')[0] ?? ''
    case 'delegate_task':
      return String(args.description ?? '')
    case 'skill':
      return String(args.id ?? '')
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

function extractPatchFiles(patch: string): string {
  const files = [...patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].map((m) => m[1]!.trim())
  return files.slice(0, 4).join(', ') + (files.length > 4 ? ` +${files.length - 4}` : '')
}

function scheduleSelectorLabel(args: Record<string, unknown>): string {
  if (args.after_seconds !== undefined) return `in ${args.after_seconds}s`
  if (args.at !== undefined) return `at ${args.at}`
  if (args.every_seconds !== undefined) return `every ${args.every_seconds}s`
  if (args.daily !== undefined) return `daily ${typeof args.daily === 'object' ? (args.daily as { time?: string }).time : args.daily}`
  if (args.weekly !== undefined) return `weekly`
  if (args.cron !== undefined) return typeof args.cron === 'object' ? (args.cron as { expression?: string }).expression ?? 'cron' : String(args.cron)
  return ''
}

/** 2×2 status dot colors (DSH tool rows) */
const STATE_DOT: Record<ToolRun['state'], string> = {
  pending: 'var(--hal-alias-label-dimmed)',
  running: 'var(--hal-alias-state-business-primary)',
  'awaiting-approval': 'var(--hal-alias-state-warn-primary)',
  completed: 'var(--hal-alias-state-success-primary)',
  error: 'var(--hal-alias-state-error-primary)',
  rejected: 'var(--hal-alias-label-dimmed)',
}

export function ToolCard({ run }: { run: ToolRun }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const icon = TOOL_ICONS[run.tool] ?? <ShieldQuestion size={13} />
  const verb = TOOL_VERBS[run.tool]
  const result = typeof run.result === 'string' ? run.result : JSON.stringify(run.result ?? '')
  const diff = open ? diffForTool(run.tool, run.args) : null
  const duration = run.endedAt && run.startedAt ? ((run.endedAt - run.startedAt) / 1000).toFixed(1) : null

  return (
    <div className="w-full">
      <button
        className="group flex items-center gap-2 min-h-6 w-full py-0.5 text-left cursor-pointer bg-transparent border-none rounded-sm hover:bg-[var(--hal-alias-interactive-bg-hover)] transition-colors duration-100 px-1 -mx-1"
        onClick={() => setOpen(!open)}
      >
        <ChevronRight
          size={12}
          className={`shrink-0 text-[color:var(--hal-alias-label-tertiary)] transition-transform duration-100 ${open ? 'rotate-90' : ''}`}
        />
        <span className="shrink-0 text-[color:var(--hal-alias-label-tertiary)]">{icon}</span>
        {verb ? (
          <span className="text-[13px] leading-6 text-ink shrink-0">{verb}</span>
        ) : (
          <span className="font-mono text-[12px] text-ink shrink-0">{run.tool}</span>
        )}
        <span className="text-[13px] leading-6 text-[color:var(--hal-alias-label-tertiary)] group-hover:text-[color:var(--hal-alias-label-secondary)] truncate flex-1 transition-colors duration-100">
          {summarizeArgs(run.tool, run.args)}
        </span>
        {run.state === 'running' ? <Spinner size={11} className="shrink-0 text-[color:var(--hal-alias-state-business-primary)]" /> : null}
        {run.state === 'awaiting-approval' ? <span className="text-[11px] text-[color:var(--hal-alias-state-warn-label)] shrink-0">{t('approval_title')}</span> : null}
        {run.state === 'rejected' ? <span className="text-[11px] text-[color:var(--hal-alias-label-tertiary)] shrink-0">{t('reject')}</span> : null}
        {run.state === 'error' ? <span className="text-[11px] text-[color:var(--hal-alias-state-error-secondary)] shrink-0">error</span> : null}
        {run.state === 'completed' && duration ? <span className="text-[10px] text-[color:var(--hal-alias-label-caption)] font-mono shrink-0">{duration}s</span> : null}
        {/* status dot */}
        {run.state !== 'running' ? (
          <span
            className="shrink-0 w-[5px] h-[5px] rounded-full"
            style={{ background: STATE_DOT[run.state], opacity: run.state === 'pending' || run.state === 'rejected' ? 0.6 : 1 }}
          />
        ) : null}
      </button>
      {open ? (
        <div className="ml-4 mt-1 mb-1.5 flex flex-col gap-1.5 fade-in" style={{ maxHeight: 280, overflowY: 'auto' }}>
          {diff ? <DiffView diff={diff} /> : null}
          <div
            className="rounded-lg border-[0.5px] border-[color:var(--hal-alias-border-l1)] overflow-hidden"
            style={{ background: 'var(--hal-alias-markdown-code-block)' }}
          >
            <div className="flex items-center px-3 pt-2 pb-1 text-[11px] font-mono text-[color:var(--hal-alias-label-caption)]">input</div>
            <pre className="px-3 pb-2.5 font-mono text-[11px] leading-[16px] text-[color:var(--hal-alias-label-secondary)] whitespace-pre-wrap break-all selectable m-0">
              {JSON.stringify(run.args, null, 2).slice(0, 4000)}
            </pre>
          </div>
          {run.error ? (
            <div
              className="rounded-lg border-[0.5px] border-[color:var(--hal-alias-border-l1)] overflow-hidden"
              style={{ background: 'var(--hal-alias-markdown-code-block)' }}
            >
              <div className="flex items-center px-3 pt-2 pb-1 text-[11px] font-mono text-[color:var(--hal-alias-state-error-secondary)]">error</div>
              <pre className="px-3 pb-2.5 font-mono text-[11px] leading-[16px] text-[color:var(--hal-alias-state-error-secondary)] whitespace-pre-wrap break-all selectable m-0">
                {run.error.slice(0, 2000)}
              </pre>
            </div>
          ) : result ? (
            <div
              className="rounded-lg border-[0.5px] border-[color:var(--hal-alias-border-l1)] overflow-hidden"
              style={{ background: 'var(--hal-alias-markdown-code-block)' }}
            >
              <div className="flex items-center px-3 pt-2 pb-1 text-[11px] font-mono text-[color:var(--hal-alias-label-caption)]">
                {run.state === 'completed' ? 'output' : 'result'}
              </div>
              <pre className="px-3 pb-2.5 font-mono text-[11px] leading-[16px] text-[color:var(--hal-alias-label-secondary)] whitespace-pre-wrap break-all selectable m-0">
                {result.slice(0, 6000)}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
