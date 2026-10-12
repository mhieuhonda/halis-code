/** Approval panels — pinned above the composer, DSH ApprovalPanel skin:
 *  warn border card with a warning strip; question cards use the blue accent. */
import { useState } from 'react'
import { BadgeCheck, Check, HelpCircle, Send, ShieldAlert, X, Zap } from 'lucide-react'
import type { ApprovalRequest, QuestionAnswer } from '@shared/types'
import { useT } from '../../i18n'
import { Button } from '../ui'

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
  if (request.kind === 'question' && request.questions?.length) {
    return <QuestionCard request={request} onAnswer={onAnswer} onDismiss={() => onRespond('reject')} />
  }
  return (
    <div
      className="rounded-xl overflow-hidden border border-[color:var(--dsw-alias-state-warn-secondary)] pop"
      style={{ background: 'var(--dsw-specific-input-major)', boxShadow: 'var(--dsw-shadow-lv2)' }}
    >
      {/* warning strip */}
      <div className="flex items-center gap-2 px-4 py-2.5 bg-[var(--dsw-alias-state-warn-tertiary)] text-[13px] text-[color:var(--dsw-alias-state-warn-label)]">
        <span className="inline-flex pending-dot">
          {request.kind === 'usdc-spend' ? <Zap size={14} /> : <ShieldAlert size={14} />}
        </span>
        <span className="font-medium">{t('approval_title')}</span>
        <span className="opacity-80">· {t(KIND_LABELS[request.kind])}</span>
        {request.amountUsd !== undefined ? (
          <span
            className="rounded-md px-1.5 py-0.5 text-[10.5px] font-medium leading-none"
            style={{ background: 'color-mix(in srgb, var(--dsw-alias-state-warn-primary) 12%, transparent)', color: 'var(--dsw-alias-state-warn-label)' }}
          >
            ${request.amountUsd.toFixed(2)} USDC
          </span>
        ) : null}
        <span className="ml-auto text-[11px] opacity-80">
          {request.agentName} · <span className="font-mono">{request.tool}</span>
        </span>
      </div>
      <div className="px-4 py-3">
        <div className="text-[13px] text-ink mb-1">{request.title}</div>
        {request.detail && request.detail !== request.title ? (
          <pre
            className="font-mono text-[11px] leading-5 text-[color:var(--dsw-alias-label-secondary)] whitespace-pre-wrap break-all mb-3 max-h-32 overflow-y-auto selectable rounded-md m-0 px-3 py-2"
            style={{ background: 'var(--dsw-alias-markdown-code-block)' }}
          >
            {request.detail.slice(0, 1500)}
          </pre>
        ) : null}
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="primary" size="sm" onClick={() => onRespond('allow')}>
            <Check size={13} /> {t('approve')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => onRespond('always')}>
            <BadgeCheck size={13} /> {t('approve_always')}
          </Button>
          <Button variant="danger" size="sm" onClick={() => onRespond('reject')}>
            <X size={13} /> {t('reject')}
          </Button>
          {request.risk !== 'low' ? (
            <span
              className="rounded-md px-1.5 py-0.5 text-[10.5px] font-medium leading-none ml-auto"
              style={{
                background: 'color-mix(in srgb, var(--dsw-alias-state-warn-primary) 10%, transparent)',
                color: request.risk === 'high' ? 'var(--dsw-alias-state-error-secondary)' : 'var(--dsw-alias-state-warn-label)',
              }}
            >
              {t(`risk_${request.risk}` as 'risk_low')}
            </span>
          ) : null}
        </div>
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
    <div
      className="rounded-xl border border-[color:var(--dsw-alias-state-business-primary)] overflow-hidden pop"
      style={{ background: 'var(--dsw-specific-input-major)', boxShadow: 'var(--dsw-shadow-lv2)' }}
    >
      <div className="flex items-center gap-2 px-4 py-2.5 border-b-[0.5px] border-[color:var(--dsw-alias-border-l1)]">
        <span className="text-[color:var(--dsw-alias-state-business-primary)] inline-flex">
          <HelpCircle size={14} />
        </span>
        <span className="text-[13px] font-medium text-ink">{t('question_title')}</span>
        <span className="ml-auto text-[11px] text-[color:var(--dsw-alias-label-tertiary)]">
          {request.agentName} · <span className="font-mono">ask_user</span>
        </span>
      </div>
      <div className="px-4 py-3 space-y-3">
        {questions.map((q) => (
          <div key={q.id} className="rounded-lg border-[0.5px] border-[color:var(--dsw-alias-border-l2)] p-3" style={{ background: 'var(--dsw-alias-bg-layer-1)' }}>
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              {q.header ? (
                <span
                  className="rounded-md px-1.5 py-0.5 text-[10.5px] font-medium leading-none"
                  style={{ background: 'var(--dsw-alias-state-business-tertiary)', color: 'var(--dsw-alias-state-business-primary)' }}
                >
                  {q.header}
                </span>
              ) : null}
              <span className="text-[13px] text-ink">{q.question}</span>
            </div>
            {q.options?.length ? (
              <div className="grid gap-1.5 sm:grid-cols-2">
                {q.options.map((option) => {
                  const selected = (selections[q.id] ?? []).includes(option.label)
                  return (
                    <button
                      key={option.label}
                      onClick={() => toggle(q.id, option.label, !!q.multiSelect)}
                      className={`text-left rounded-md border px-2.5 py-1.5 transition-colors duration-100 cursor-pointer ${
                        selected
                          ? 'border-[color:var(--dsw-alias-state-business-primary)] bg-[var(--dsw-alias-state-business-tertiary)]'
                          : 'border-[color:var(--dsw-alias-border-l3)] hover:bg-[var(--dsw-alias-interactive-bg-hover)]'
                      }`}
                      style={{ background: selected ? undefined : 'var(--dsw-specific-input-major)' }}
                    >
                      <div className="text-[12.5px] text-ink">{option.label}</div>
                      {option.description ? <div className="text-[11px] text-[color:var(--dsw-alias-label-tertiary)] leading-snug">{option.description}</div> : null}
                    </button>
                  )
                })}
              </div>
            ) : null}
            <input
              value={customs[q.id] ?? ''}
              onChange={(e) => setCustoms((prev) => ({ ...prev, [q.id]: e.target.value }))}
              placeholder={t('question_custom')}
              className="mt-2 w-full h-8 rounded-md border-[0.5px] border-[color:var(--dsw-alias-border-l4)] px-2.5 text-[12.5px] text-ink placeholder:text-[color:var(--dsw-alias-label-dimmed)] outline-none focus:border-[color:var(--dsw-alias-state-business-primary)] transition-colors duration-100"
              style={{ background: 'var(--dsw-alias-bg-layer-1)' }}
            />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 px-4 pb-3.5">
        <Button variant="primary" size="sm" onClick={submit} disabled={!hasAnswer}>
          <Send size={13} /> {t('question_send')}
        </Button>
        <Button variant="outline" size="sm" onClick={() => onAnswer(questions.map((q) => ({ id: q.id, selected: [], custom: customs[q.id]?.trim() || undefined })))}>
          {t('question_skip')}
        </Button>
        <Button variant="danger" size="sm" onClick={onDismiss}>
          <X size={13} /> {t('reject')}
        </Button>
      </div>
    </div>
  )
}
