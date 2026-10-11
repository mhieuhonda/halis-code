/** Approval cards — pinned above the composer, glowing until answered. */
import { BadgeCheck, Check, ShieldAlert, X, Zap } from 'lucide-react'
import type { ApprovalRequest } from '@shared/types'
import { useT } from '../../i18n'
import { Badge, Button } from '../ui'

const KIND_LABELS: Record<ApprovalRequest['kind'], 'approval_file' | 'approval_shell' | 'approval_usdc' | 'approval_other'> = {
  'file-write': 'approval_file',
  shell: 'approval_shell',
  'usdc-spend': 'approval_usdc',
  other: 'approval_other',
}

export function ApprovalCard({ request, onRespond }: { request: ApprovalRequest; onRespond: (response: 'allow' | 'always' | 'reject') => void }) {
  const t = useT()
  const riskColor = request.risk === 'high' ? '#FF6B7A' : request.risk === 'medium' ? '#FFB454' : '#3ED598'
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
