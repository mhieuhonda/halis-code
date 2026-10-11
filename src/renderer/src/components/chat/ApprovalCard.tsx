/** Approval cards — pinned above the composer, glowing until answered.
 *  Question cards (ask_user) render interactive option pickers instead. */
import { useState } from 'react'
import { BadgeCheck, Check, HelpCircle, Send, ShieldAlert, X, Zap } from 'lucide-react'
import type { ApprovalRequest, QuestionAnswer } from '@shared/types'
import { useT } from '../../i18n'
import { Badge, Button } from '../ui'

const KIND_LABELS: Record<ApprovalRequest['kind'], 'approval_file' | 'approval_shell' | 'approval_usdc' | 'approval_other' | 'question_title'> = {
  'file-write': 'approval_file',
  shell: 'approval_shell',
  'usdc-spend': 'approval_usdc',
  other: 'approval_other',
  question: 'question_title',
}

export function ApprovalCard({
  request,
  onRespond,
  onAnswer,
}: {
  request: ApprovalRequest
  onRespond: (response: 'allow' | 'always' | 'reject') => void
  onAnswer: (answers: QuestionAnswer[]) => void
}) {
  const t = useT()
  const riskColor = request.risk === 'high' ? '#FF6B7A' : request.risk === 'medium' ? '#FFB454' : '#3ED598'
  if (request.kind === 'question' && request.questions?.length) {
    return <QuestionCard request={request} onAnswer={onAnswer} onDismiss={() => onRespond('reject')} />
  }
  return (
    <div className="rounded-2xl border border-amber/35 bg-amber/[0.05] backdrop-blur p-3.5 glow-pulse pop">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className="text-amber spark-pulse inline-flex">{request.kind === 'usdc-spend' ? <Zap size={14} /> : <ShieldAlert size={14} />}</span>
        <span className="text-[13px] font-semibold tracking-tight">{t('approval_title')}</span>
        <span className="text-[11.5px] text-faint">· {t(KIND_LABELS[request.kind])}</span>
        {request.amountUsd !== undefined ? <Badge color="#45C4FF">${request.amountUsd.toFixed(2)} USDC</Badge> : null}
        <Badge color={riskColor}>{t(`risk_${request.risk}` as 'risk_low')}</Badge>
      </div>
      <div className="text-[12.5px] text-muted mb-0.5">{request.title}</div>
      {request.detail && request.detail !== request.title ? (
        <pre className="font-mono text-[11.5px] text-ink/70 whitespace-pre-wrap break-all mb-3 max-h-32 overflow-y-auto selectable rounded-lg bg-black/25 border border-line px-3 py-2">{request.detail.slice(0, 1500)}</pre>
      ) : (
        <div className="mb-3" />
      )}
      <div className="flex items-center gap-2 flex-wrap">
        <Button variant="good" size="sm" onClick={() => onRespond('allow')}>
          <Check size={13} /> {t('approve')}
        </Button>
        <Button variant="default" size="sm" onClick={() => onRespond('always')}>
          <BadgeCheck size={13} /> {t('approve_always')}
        </Button>
        <Button variant="danger" size="sm" onClick={() => onRespond('reject')}>
          <X size={13} /> {t('reject')}
        </Button>
        <span className="ml-auto text-[11px] text-faint">
          {request.agentName} · <span className="font-mono">{request.tool}</span>
        </span>
      </div>
    </div>
  )
}

function QuestionCard({ request, onAnswer, onDismiss }: { request: ApprovalRequest; onAnswer: (answers: QuestionAnswer[]) => void; onDismiss: () => void }) {
  const t = useT()
  const questions = request.questions ?? []
  const [selections, setSelections] = useState<Record<string, string[]>>({})
  const [customs, setCustoms] = useState<Record<string, string>>({})

  const toggle = (id: string, label: string, multi: boolean) => {
    setSelections((prev) => {
      const current = prev[id] ?? []
      if (multi) {
        return { ...prev, [id]: current.includes(label) ? current.filter((l) => l !== label) : [...current, label] }
      }
      return { ...prev, [id]: current.includes(label) ? [] : [label] }
    })
  }

  const submit = () => {
    const answers: QuestionAnswer[] = questions.map((q) => ({
      id: q.id,
      selected: selections[q.id] ?? [],
      custom: customs[q.id]?.trim() || undefined,
    }))
    onAnswer(answers)
  }

  const hasAnswer = questions.every((q) => (selections[q.id]?.length ?? 0) > 0 || !!customs[q.id]?.trim())

  return (
    <div className="rounded-2xl border border-signal/35 bg-signal/[0.05] backdrop-blur p-3.5 pop max-w-[780px]">
      <div className="flex items-center gap-2 mb-2.5">
        <span className="text-signal inline-flex">
          <HelpCircle size={14} />
        </span>
        <span className="text-[13px] font-semibold tracking-tight">{t('question_title')}</span>
        <span className="ml-auto text-[11px] text-faint">
          {request.agentName} · <span className="font-mono">ask_user</span>
        </span>
      </div>
      <div className="space-y-3">
        {questions.map((q) => (
          <div key={q.id} className="rounded-xl border border-line bg-panel2/50 p-3">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              {q.header ? <Badge color="#45C4FF">{q.header}</Badge> : null}
              <span className="text-[12.5px] text-ink">{q.question}</span>
            </div>
            {q.options?.length ? (
              <div className="grid gap-1.5 sm:grid-cols-2">
                {q.options.map((option) => {
                  const selected = (selections[q.id] ?? []).includes(option.label)
                  return (
                    <button
                      key={option.label}
                      onClick={() => toggle(q.id, option.label, !!q.multiSelect)}
                      className={`text-left rounded-lg border px-2.5 py-1.5 transition-colors cursor-pointer ${selected ? 'border-signal/60 bg-signal/10' : 'border-line bg-panel/60 hover:border-line2'}`}
                    >
                      <div className="text-[12px] text-ink">{option.label}</div>
                      {option.description ? <div className="text-[11px] text-faint leading-snug">{option.description}</div> : null}
                    </button>
                  )
                })}
              </div>
            ) : null}
            <input
              value={customs[q.id] ?? ''}
              onChange={(e) => setCustoms((prev) => ({ ...prev, [q.id]: e.target.value }))}
              placeholder={t('question_custom')}
              className="mt-2 w-full rounded-lg border border-line bg-panel/70 px-2.5 py-1.5 text-[12px] text-ink placeholder:text-faint focus:outline-none focus:border-signal/50"
            />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 mt-3">
        <Button variant="good" size="sm" onClick={submit} disabled={!hasAnswer}>
          <Send size={13} /> {t('question_send')}
        </Button>
        <Button variant="default" size="sm" onClick={() => onAnswer(questions.map((q) => ({ id: q.id, selected: [], custom: customs[q.id]?.trim() || undefined })))}>
          {t('question_skip')}
        </Button>
        <Button variant="danger" size="sm" onClick={onDismiss}>
          <X size={13} /> {t('reject')}
        </Button>
      </div>
    </div>
  )
}
