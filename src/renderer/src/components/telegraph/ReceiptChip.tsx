/** Receipt chip: the money is visible — miner, intent, amount, tx → explorer. */
import { ExternalLink, Zap } from 'lucide-react'
import type { ReceiptRef, TelegraphReceipt } from '@shared/types'

type ReceiptLike = Pick<ReceiptRef, 'receiptHash' | 'txHash' | 'miner' | 'intent' | 'amountUsd' | 'explorerUrl'>

export function ReceiptChip({ receipt }: { receipt: ReceiptLike }) {
  const url = receipt.explorerUrl ?? (receipt.txHash ? undefined : undefined)
  return (
    <a
      href={url ?? '#'}
      onClick={(e) => {
        e.preventDefault()
        if (url) window.open(url, '_blank', 'noopener')
      }}
      className={`inline-flex items-center gap-1.5 rounded-lg border border-cyan/30 bg-cyan/5 px-2 py-1 text-[11px] text-cyan hover:bg-cyan/10 transition-colors fade-up ${url ? 'cursor-pointer' : 'cursor-default'}`}
      title={receipt.receiptHash}
    >
      <Zap size={11} />
      <span className="font-mono">{receipt.miner ? `miner ${receipt.miner}` : 'telegraph'}</span>
      {receipt.intent ? <span className="text-cyan/60">· {receipt.intent}</span> : null}
      <span className="font-mono font-medium">${Number(receipt.amountUsd).toFixed(2)}</span>
      {receipt.txHash ? (
        <span className="inline-flex items-center gap-0.5 text-cyan/70">
          tx {receipt.txHash.slice(0, 8)}…
          <ExternalLink size={10} />
        </span>
      ) : null}
    </a>
  )
}

export function receiptFromLedger(r: TelegraphReceipt): ReceiptLike {
  return {
    receiptHash: r.receiptHash,
    txHash: r.txHash,
    miner: r.miner,
    intent: r.intent,
    amountUsd: r.amountUsd,
    explorerUrl: r.explorerUrl,
  }
}
