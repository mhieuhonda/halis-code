/**
 * x402 payment plumbing — mobile edition, same approach as the desktop app
 * and the official telegraphprotocol/Telegraph-MCP server: wrap a fetch so a
 * 402 challenge is answered with an EIP-3009 USDC transfer authorization and
 * retried transparently. The agent never sees the key or the payment flow.
 */
import { wrapFetchWithPayment, x402Client } from '@x402/fetch'
import { ExactEvmScheme, toClientEvmSigner } from '@x402/evm'
import { privateKeyToAccount } from 'viem/accounts'
import type { TelegraphNetworkConfig } from '@shared/types'
import { bytesToBase64, base64ToBytes } from '../keyvault'
import { nativeFetch } from '../native'

export type PaidFetch = (input: string, init?: RequestInit) => Promise<Response>

let cached: { key: string; paid: PaidFetch } | null = null

/**
 * Inside the WebView the paid flow rides the native HTTP stack (no CORS on
 * the engine/facilitator). The adapter rebuilds a standard Response — good
 * enough for the JSON bodies the engine returns, no streaming involved.
 */
const baseFetch: typeof fetch = (input, init) => {
  try {
    if ((window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()) {
      return nativeFetch(input, init) as Promise<Response>
    }
  } catch {
    /* fall through to plain fetch */
  }
  return fetch(input, init)
}

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
  const paid = wrapFetchWithPayment(baseFetch, client) as unknown as PaidFetch
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
    const decoded = JSON.parse(new TextDecoder().decode(base64ToBytes(header))) as Record<string, unknown>
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

/** UTF-8-safe base64 encode for challenge headers. */
export function b64encodeUtf8(text: string): string {
  return bytesToBase64(new TextEncoder().encode(text))
}
