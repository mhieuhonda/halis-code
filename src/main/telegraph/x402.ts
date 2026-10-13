/**
 * x402 payment plumbing — identical approach to the official
 * telegraphprotocol/Telegraph-MCP server: wrap fetch so a 402 challenge is
 * answered with an EIP-3009 USDC transfer authorization and retried
 * transparently.
 *
 * The agent (LLM) never sees the private key, the payment flow, or the
 * blockchain transaction; it only sees a tool that returns results.
 */
import { wrapFetchWithPayment, x402Client } from '@x402/fetch'
import { ExactEvmScheme, toClientEvmSigner } from '@x402/evm'
import { privateKeyToAccount } from 'viem/accounts'
import type { TelegraphNetworkConfig } from '@shared/types'

export type PaidFetch = (input: string, init?: RequestInit) => Promise<Response>

let cached: { key: string; paid: PaidFetch } | null = null

export function getPaidFetch(privateKey: string, network: TelegraphNetworkConfig): PaidFetch {
  const cacheKey = `${privateKey}:${network.caip2}`
  if (cached?.key === cacheKey) return cached.paid

  const account = privateKeyToAccount(privateKey.trim() as `0x${string}`)
  const signer = toClientEvmSigner(account)
  const client = x402Client.fromConfig({
    schemes: [
      {
        network: network.caip2 as `${string}:${string}`,
        client: new ExactEvmScheme(signer),
      },
    ],
  })
  const paid = wrapFetchWithPayment(fetch, client) as unknown as PaidFetch
  cached = { key: cacheKey, paid }
  return paid
}

export function clearPaidFetchCache(): void {
  cached = null
}

/** Extracts + decodes the Telegraph receipt from a 2xx response. */
export function extractReceipt(res: Response): import('@shared/types').TelegraphReceipt | undefined {
  const header = res.headers.get('x-telegraph-receipt')
  if (!header) return undefined
  try {
    const decoded = JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as Record<string, unknown>
    // uusdc base units fit well inside Number.MAX_SAFE_INTEGER for any
    // realistic spend; BigInt() threw on a decimal amount ("1500.5") and the
    // outer catch dropped the WHOLE receipt — money settled on-chain but the
    // local ledger undercounted it forever.
    const rawAmount = decoded.amount_uusdc
    const amountNum = typeof rawAmount === 'number' ? rawAmount : Number(String(rawAmount ?? 0))
    return {
      receiptHash: String(decoded.receipt_hash ?? ''),
      rail: String(decoded.rail ?? 'x402'),
      payer: String(decoded.payer ?? ''),
      miner: String(decoded.miner ?? ''),
      intent: String(decoded.intent ?? ''),
      amountUsd: Number.isFinite(amountNum) ? amountNum / 1e6 : 0,
      amountUusdc: String(rawAmount ?? '0'),
      epochId: Number(decoded.epoch_id ?? 0),
      settlement: String(decoded.settlement ?? 'onchain'),
      chain: String(decoded.chain ?? ''),
      txHash: String(decoded.tx_hash ?? ''),
      timestamp: Number(decoded.timestamp ?? Math.floor(Date.now() / 1000)),
    }
  } catch (err) {
    console.warn('[halis] receipt decode failed:', err)
    return undefined
  }
}
