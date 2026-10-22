/**
 * Receipt ledger + spend accounting (mobile). Every settled Telegraph
 * request is appended here with its on-chain proof; the spend panel reads
 * from this store. Keyed on receipt_hash — tx hashes batch, receipts don't.
 */
import type { TelegraphNetworkConfig, TelegraphReceipt } from '@shared/types'
import { readJson, writeJson } from '../storage'

const STORE_KEY = 'receipts'

export class ReceiptLedger {
  private cache: TelegraphReceipt[] | null = null

  async all(): Promise<TelegraphReceipt[]> {
    if (this.cache) return this.cache
    const parsed = await readJson<TelegraphReceipt[]>(STORE_KEY, [])
    this.cache = Array.isArray(parsed) ? parsed : []
    return this.cache
  }

  async append(receipt: TelegraphReceipt, network: TelegraphNetworkConfig, query?: string): Promise<TelegraphReceipt> {
    const withExplorer: TelegraphReceipt = {
      ...receipt,
      explorerUrl: receipt.txHash ? `${network.explorerTxUrl}${receipt.txHash}` : undefined,
      query: receipt.query ?? query,
    }
    if (!withExplorer.receiptHash) {
      withExplorer.receiptHash = `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    }
    const all = (await this.all()).filter((r) => r.receiptHash !== withExplorer.receiptHash)
    all.unshift(withExplorer)
    this.cache = all.slice(0, 5000)
    await writeJson(STORE_KEY, this.cache)
    return withExplorer
  }

  async spentTodayUsd(): Promise<number> {
    const startOfDay = new Date()
    startOfDay.setHours(0, 0, 0, 0)
    return (await this.all())
      .filter((r) => {
        // Header timestamps are epoch-seconds; a node emitting ms must not
        // multiply again (the receipt would match "today" forever).
        const ms = r.timestamp > 1e12 ? r.timestamp : r.timestamp * 1000
        return ms >= startOfDay.getTime()
      })
      .reduce((sum, r) => sum + (r.amountUsd || 0), 0)
  }

  async spentTotalUsd(): Promise<number> {
    return (await this.all()).reduce((sum, r) => sum + (r.amountUsd || 0), 0)
  }

  async count(): Promise<number> {
    return (await this.all()).length
  }

  async clear(): Promise<void> {
    this.cache = []
    await writeJson(STORE_KEY, [])
  }
}
