/**
 * Telegraph Engine client — how Halis Code buys intelligence (mobile).
 * Same rules as desktop: paid requests route through the Engine, receipts
 * surface on-chain proof, response bodies are bounded.
 */
import type { TelegraphAskResult, TelegraphMiner, TelegraphNetworkConfig } from '@shared/types'
import { enginePaths } from './config'
import { extractReceipt, getPaidFetch } from './x402'
import { httpFetch } from '../native'
import { base64ToBytes } from '../keyvault'

export interface AskOptions {
  query: string
  context?: Record<string, unknown>
  privateKey: string
  network: TelegraphNetworkConfig
  signal?: AbortSignal
  minerId?: string
  method?: string
  endpoint?: string
  payload?: unknown
  onQuote?: (quote: { amountUsd: number; payTo: string; network: string }) => void | Promise<void>
}

const REQUEST_TIMEOUT_MS = 90_000

function withTimeout(signal?: AbortSignal, timeoutMs = REQUEST_TIMEOUT_MS): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  return signal ? anySignal([signal, timeout]) : timeout
}

/** AbortSignal.any polyfill — old WebViews (Android 7.x) miss it. */
export function anySignal(signals: AbortSignal[]): AbortSignal {
  const anySig = signals.find((s) => s.aborted)
  const controller = new AbortController()
  if (anySig) {
    controller.abort()
    return controller.signal
  }
  const onAbort = (reason: unknown) => () => {
    for (const s of signals) s.removeEventListener('abort', onAbortHandler as EventListener)
    controller.abort(reason)
  }
  const onAbortHandler = (event: Event) => {
    controller.abort((event.target as AbortSignal).reason)
    for (const s of signals) s.removeEventListener('abort', onAbortHandler)
  }
  for (const s of signals) s.addEventListener('abort', onAbortHandler)
  void onAbort
  return controller.signal
}

/** Decode a 402 challenge into a human-usable quote. */
export async function quoteAsk(opts: { network: TelegraphNetworkConfig; minerId?: string; query: string; method?: string; endpoint?: string; payload?: unknown; signal?: AbortSignal }): Promise<{ amountUsd: number; payTo: string; network: string }> {
  const paths = enginePaths(opts.network.nodeUrl)
  const url = opts.minerId ? paths.askDirect(opts.minerId) : paths.ask
  const body = opts.minerId
    ? JSON.stringify({ method: opts.method ?? 'POST', endpoint: opts.endpoint ?? '/chat', payload: opts.payload ?? {} })
    : JSON.stringify({ query: opts.query, ...(opts.payload ? { context: opts.payload } : {}) })
  const res = await httpFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: withTimeout(opts.signal),
  })
  const header = res.headers.get('payment-required') ?? res.headers.get('PAYMENT-REQUIRED')
  if (res.status === 402 && header) {
    // A 402 whose challenge cannot be decoded must NOT degrade to a $0.00
    // quote: the approval card and the daily budget would then vet a fake
    // zero price while the paid call settles the REAL (unknown) amount.
    let challenge: { accepts?: Array<{ network?: string; amount?: string; payTo?: string }> }
    try {
      challenge = JSON.parse(new TextDecoder().decode(base64ToBytes(header))) as { accepts?: Array<{ network?: string; amount?: string; payTo?: string }> }
    } catch {
      throw new TelegraphError('Unparseable 402 payment challenge — refusing to quote a price blind.', 'engine')
    }
    const accept = challenge.accepts?.find((a) => a.network?.startsWith('eip155')) ?? challenge.accepts?.[0]
    if (!accept || accept.amount === undefined) {
      throw new TelegraphError('402 challenge carries no payable accept entry — refusing to quote a price blind.', 'engine')
    }
    let amountUsd: number
    try {
      amountUsd = Number(BigInt(accept.amount)) / 1e6
    } catch {
      throw new TelegraphError(`402 challenge amount "${accept.amount}" is not an integer base unit — refusing to quote a price blind.`, 'engine')
    }
    return {
      amountUsd,
      payTo: accept.payTo ?? '',
      network: accept.network ?? opts.network.caip2,
    }
  }
  if (res.ok) {
    return { amountUsd: 0, payTo: '', network: opts.network.caip2 }
  }
  throw new TelegraphError(`Telegraph node returned ${res.status} while quoting — refusing to quote a price blind.`, 'engine')
}

export class TelegraphError extends Error {
  constructor(
    message: string,
    public readonly code: 'no-wallet' | 'payment' | 'network' | 'engine' | 'validation',
  ) {
    super(message)
    this.name = 'TelegraphError'
  }
}

/** Read a response body with a hard byte cap. */
async function boundedText(res: Response, cap = 10 * 1024 * 1024): Promise<string> {
  if (!res.body) {
    // Native-stack Responses already carry the full text.
    return res.text()
  }
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > cap) {
        try {
          await reader.cancel()
        } catch {
          /* ignore */
        }
        throw new TelegraphError(`Response body exceeded ${(cap / 1048576).toFixed(0)} MB — aborted.`, 'network')
      }
      chunks.push(value)
    }
  } finally {
    try {
      await reader.cancel()
    } catch {
      /* already closed */
    }
  }
  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  let end = merged.length
  while (end > 0 && ((merged[end - 1] ?? 0) & 0xc0) === 0x80) end--
  return new TextDecoder().decode(merged.subarray(0, end))
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await httpFetch(url, { signal: signal ?? AbortSignal.timeout(20_000), headers: { Accept: 'application/json' } })
  if (!res.ok) throw new TelegraphError(`Telegraph node returned ${res.status} for ${url}`, 'network')
  return (await res.json()) as T
}

export async function listMiners(network: TelegraphNetworkConfig, signal?: AbortSignal): Promise<TelegraphMiner[]> {
  const raw = await getJson<Array<Record<string, unknown>>>(enginePaths(network.nodeUrl).miners, signal)
  return raw.map((m) => ({
    id: String(m.id ?? ''),
    slug: String(m.slug ?? m.id ?? ''),
    name: String(m.name ?? m.slug ?? 'unknown'),
    endpoints: Array.isArray(m.endpoints)
      ? (m.endpoints as Array<Record<string, unknown>>).map((e) => ({
          path: e.path ? String(e.path) : undefined,
          method: e.method ? String(e.method) : undefined,
          description: e.description ? String(e.description) : undefined,
        }))
      : undefined,
    supportedIntents: Array.isArray(m.supported_intents) ? (m.supported_intents as string[]) : [],
    minPriceUsdc: m.min_price_usdc !== undefined ? Number(m.min_price_usdc) / 1e6 : undefined,
    activationStatus: m.activation_status ? String(m.activation_status) : undefined,
  }))
}

export async function listIntents(network: TelegraphNetworkConfig, signal?: AbortSignal): Promise<Array<{ id: string; label?: string; minerCount?: number }>> {
  const raw = await getJson<unknown>(enginePaths(network.nodeUrl).intents, signal)
  const mapIntent = (i: unknown): { id: string; label?: string; minerCount?: number } => {
    if (typeof i === 'string') return { id: i }
    const obj = i as Record<string, unknown>
    const id = String(obj.intent_id ?? obj.id ?? obj.intent ?? obj.name ?? '')
    const label = obj.intent_name ? String(obj.intent_name) : obj.name ? String(obj.name) : obj.description ? String(obj.description) : undefined
    const minerCount = obj.miner_count !== undefined ? Number(obj.miner_count) : undefined
    return { id, label, minerCount: Number.isFinite(minerCount) ? minerCount : undefined }
  }
  if (Array.isArray(raw)) {
    return raw.map(mapIntent).filter((i) => i.id)
  }
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    if (Array.isArray(obj.intents)) return (obj.intents as Array<unknown>).map(mapIntent).filter((i) => i.id)
    return Object.keys(obj).map((k) => ({ id: k, label: String((obj[k] as Record<string, unknown>)?.name ?? k) }))
  }
  return []
}

export async function verifySignal(
  network: TelegraphNetworkConfig,
  signalHash: string,
  signal?: AbortSignal,
): Promise<{ found: boolean; detail: string }> {
  try {
    const json = await getJson<Record<string, unknown>>(enginePaths(network.nodeUrl).signal(signalHash), signal)
    return { found: true, detail: JSON.stringify(json).slice(0, 2000) }
  } catch (err) {
    return { found: false, detail: err instanceof Error ? err.message : String(err) }
  }
}

interface EngineAskResponse {
  miner_id?: string | number
  miner_name?: string
  intent?: string
  reasoning?: string
  result?: unknown
  cost_usd?: number
  duration_ms?: number
  signal_hash?: string
  warnings?: string[]
  error?: string
}

/** Auto-routed ask: the Engine's LLM router classifies the query into an Intent and picks the best-ranked miner. */
export async function askTelegraph(opts: AskOptions): Promise<TelegraphAskResult> {
  if (!opts.privateKey) throw new TelegraphError('No Telegraph wallet configured. Create or import a burner wallet first.', 'no-wallet')

  if (opts.onQuote) {
    const quote = await quoteAsk({ network: opts.network, minerId: opts.minerId, query: opts.query, method: opts.method, endpoint: opts.endpoint, payload: opts.payload, signal: opts.signal })
    await opts.onQuote(quote)
  }

  const paidFetch = getPaidFetch(opts.privateKey, opts.network)
  const paths = enginePaths(opts.network.nodeUrl)

  const url = opts.minerId ? paths.askDirect(opts.minerId) : paths.ask
  const body = opts.minerId
    ? JSON.stringify({
        method: opts.method ?? 'POST',
        endpoint: opts.endpoint ?? '/chat',
        payload: opts.payload ?? {},
      })
    : JSON.stringify({ query: opts.query, ...(opts.context ? { context: opts.context } : {}) })

  let res: Response
  try {
    res = await paidFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: withTimeout(opts.signal),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new TelegraphError(`x402 payment or network failure: ${message}`, 'payment')
  }

  const text = await boundedText(res)
  let json: EngineAskResponse = {}
  try {
    json = JSON.parse(text) as EngineAskResponse
  } catch {
    /* non-JSON body */
  }

  if (!res.ok) {
    const detail = json.error ?? text.slice(0, 300)
    if (res.status === 402) throw new TelegraphError(`Payment declined (402): ${detail}`, 'payment')
    if (res.status === 422) throw new TelegraphError(`Request predicted to fail (422): ${detail}`, 'validation')
    throw new TelegraphError(`Engine error ${res.status}: ${detail}`, 'engine')
  }

  const receipt = extractReceipt(res)
  return {
    minerId: String(json.miner_id ?? ''),
    minerName: json.miner_name ?? 'unknown',
    intent: json.intent,
    reasoning: json.reasoning,
    result: json.result ?? json,
    costUsd: json.cost_usd ?? receipt?.amountUsd ?? 0,
    durationMs: json.duration_ms ?? 0,
    signalHash: json.signal_hash,
    receipt: receipt
      ? {
          ...receipt,
          explorerUrl: receipt.txHash ? `${opts.network.explorerTxUrl}${receipt.txHash}` : undefined,
        }
      : undefined,
  }
}

/** Fetch one signal's full record by hash (verify flow). */
export async function getSignal(
  network: TelegraphNetworkConfig,
  signalHash: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown> | undefined> {
  try {
    return await getJson<Record<string, unknown>>(enginePaths(network.nodeUrl).signal(signalHash), signal)
  } catch {
    return undefined
  }
}

/** Free discovery ping — used for the status panel without spending anything. */
export async function pingNode(network: TelegraphNetworkConfig): Promise<{ reachable: boolean; miners: number }> {
  try {
    const miners = await listMiners(network)
    return { reachable: true, miners: miners.length }
  } catch {
    return { reachable: false, miners: 0 }
  }
}
