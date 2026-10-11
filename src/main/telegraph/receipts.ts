/**
 * Receipt ledger + spend accounting. Every settled Telegraph request is
 * appended here with its on-chain proof; the spend panel in the UI reads
 * from this file. Keyed on receipt_hash — tx hashes batch, receipts don't.
 */
import type { TelegraphNetworkConfig, TelegraphReceipt } from '@shared/types'
import { readJson, writeJson } from '../util/json'

export class ReceiptLedger {
  constructor(private readonly file: string) {}

  all(): TelegraphReceipt[] {
    return readJson<TelegraphReceipt[]>(this.file, [])
  }

  append(receipt: TelegraphReceipt, network: TelegraphNetworkConfig, query?: string): TelegraphReceipt {
    const withExplorer: TelegraphReceipt = {
      ...receipt,
      explorerUrl: receipt.txHash ? `${network.explorerTxUrl}${receipt.txHash}` : undefined,
      query: receipt.query ?? query,
    }
    if (!withExplorer.receiptHash) {
      // No receipt header (e.g. a served request on a rail without one).
      withExplorer.receiptHash = `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    }
    const all = this.all().filter((r) => r.receiptHash !== withExplorer.receiptHash)
    all.unshift(withExplorer)
    writeJson(this.file, all.slice(0, 5000))
    return withExplorer
  }

  spentTodayUsd(): number {
    const startOfDay = new Date()
    startOfDay.setHours(0, 0, 0, 0)
    return this.all()
      .filter((r) => r.timestamp * 1000 >= startOfDay.getTime())
      .reduce((sum, r) => sum + (r.amountUsd || 0), 0)
  }

  spentTotalUsd(): number {
    return this.all().reduce((sum, r) => sum + (r.amountUsd || 0), 0)
  }

  count(): number {
    return this.all().length
  }

  clear(): void {
    writeJson(this.file, [])
  }
}
