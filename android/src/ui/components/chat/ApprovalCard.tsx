/** Pinned approval + question cards — always visible above the composer. */
import { useState } from 'react'
import { ShieldQuestion } from 'lucide-react'
import type { ApprovalRequest, QuestionAnswer } from '@shared/types'
import { useChatStore } from '../../stores/chat'
import { useT } from '../../i18n'

const riskChip = (risk: string) =>
  risk === 'high' ? 'chip-red' : risk === 'medium' ? 'chip-amber' : 'chip-green'

export function ApprovalCard({ request }: { request: ApprovalRequest }) {
  const respondApproval = useChatStore((s) => s.respondApproval)
  const answerQuestions = useChatStore((s) => s.answerQuestions)
  const t = useT()

  if (request.kind === 'question' && request.questions?.length) {
    return <QuestionCard request={request} onAnswer={(answers) => answerQuestions(request.id, answers)} />
  }

  return (
    <div className="card" style={{ padding: 12, marginBottom: 8, borderColor: 'var(--hal-amber)' }}>
      <div className="row" style={{ gap: 7, marginBottom: 6 }}>
        <ShieldQuestion size={16} style={{ color: 'var(--hal-amber)' }} />
        <b style={{ fontSize: 14 }}>{request.title}</b>
        <span className={`chip ${riskChip(request.risk)}`} style={{ marginLeft: 'auto' }}>
          {request.risk === 'high' ? t('risk_high') : request.risk === 'medium' ? t('risk_medium') : t('risk_low')}
        </span>
      </div>
      {request.agentName ? (
        <div className="hint" style={{ marginBottom: 4 }}>
          @{request.agentName}
        </div>
      ) : null}
      <div style={{ fontSize: 13.5, color: 'var(--hal-ink-soft)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 140, overflowY: 'auto' }}>
        {request.detail}
      </div>
      {request.amountUsd !== undefined ? (
        <div style={{ fontWeight: 700, marginTop: 6 }}>${request.amountUsd.toFixed(2)} USDC</div>
      ) : null}
      <div className="row" style={{ gap: 8, marginTop: 10 }}>
        <button className="btn btn-danger btn-sm grow" onClick={() => void respondApproval(request.id, 'reject')}>
          {t('reject')}
        </button>
        <button className="btn btn-sm grow" onClick={() => void respondApproval(request.id, 'always')}>
          {t('approve_always')}
        </button>
        <button className="btn btn-primary btn-sm grow" onClick={() => void respondApproval(request.id, 'allow')}>
          {t('approve')}
        </button>
      </div>
    </div>
  )
}

function QuestionCard({ request, onAnswer }: { request: ApprovalRequest; onAnswer: (answers: QuestionAnswer[]) => void }) {
  const t = useT()
  const [picks, setPicks] = useState<Record<string, string[]>>({})
  const [customs, setCustoms] = useState<Record<string, string>>({})
  const questions = request.questions ?? []

  const toggle = (qid: string, label: string, multi: boolean) => {
    setPicks((prev) => {
      const current = prev[qid] ?? []
      if (multi) {
        return { ...prev, [qid]: current.includes(label) ? current.filter((l) => l !== label) : [...current, label] }
      }
      return { ...prev, [qid]: current[0] === label ? [] : [label] }
    })
  }

  const submit = () => {
    const answers: QuestionAnswer[] = questions.map((q) => ({
      id: q.id,
      selected: picks[q.id] ?? [],
      custom: customs[q.id]?.trim() || undefined,
    }))
    onAnswer(answers)
  }

  return (
    <div className="card" style={{ padding: 12, marginBottom: 8, borderColor: 'var(--hal-accent)' }}>
      <div className="row" style={{ gap: 7, marginBottom: 8 }}>
        <ShieldQuestion size={16} style={{ color: 'var(--hal-accent)' }} />
        <b style={{ fontSize: 14 }}>{t('question_title')}</b>
        {request.agentName ? <span className="hint" style={{ marginLeft: 'auto' }}>@{request.agentName}</span> : null}
      </div>
      {questions.map((q, qi) => (
        <div key={q.id} style={{ marginBottom: qi < questions.length - 1 ? 12 : 0 }}>
          <div style={{ fontWeight: 650, fontSize: 13.5, marginBottom: 6 }}>
            {q.header ? <span className="chip chip-accent" style={{ marginRight: 6 }}>{q.header}</span> : null}
            {q.question}
          </div>
          {q.options?.length ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {q.options.map((o) => {
                const active = (picks[q.id] ?? []).includes(o.label)
                return (
                  <button
                    key={o.label}
                    className={`chip ${active ? 'chip-accent' : ''}`}
                    style={{ padding: '8px 12px', fontSize: 13, cursor: 'pointer' }}
                    onClick={() => toggle(q.id, o.label, !!q.multiSelect)}
                  >
                    {o.label}
                  </button>
                )
              })}
            </div>
          ) : null}
          <input
            className="field"
            style={{ marginTop: 8, minHeight: 40, fontSize: 13.5 }}
            placeholder={t('question_custom')}
            value={customs[q.id] ?? ''}
            onChange={(e) => setCustoms((prev) => ({ ...prev, [q.id]: e.target.value }))}
          />
        </div>
      ))}
      <div className="row" style={{ gap: 8, marginTop: 10 }}>
        <button className="btn btn-sm grow" onClick={() => onAnswer(questions.map((q) => ({ id: q.id, selected: [] })))}>
          {t('question_skip')}
        </button>
        <button className="btn btn-primary btn-sm grow" onClick={submit}>
          {t('question_send')}
        </button>
      </div>
    </div>
  )
}
