/**
 * Retry policy — ported from opencode's session retry schedule:
 * exponential with jitter (≈2s → 4s → 8s, capped 10s), honors Retry-After
 * (≤ 15 min), retries only transient failures (408/429/5xx, network),
 * caps timeout retries at 3.
 */
import { LlmError } from './types'

const RETRY_MAX_ATTEMPTS = 4
const RETRY_AFTER_MAX_MS = 15 * 60 * 1000

/** Retry only what's plausibly transient: 408/429/5xx and network errors. */
function isRetryable(status: number | undefined): boolean {
  if (status === undefined) return true // network failure (fetch TypeError)
  return status === 408 || status === 429 || (status >= 500 && status !== 501)
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'))
    const timer = setTimeout(resolve, ms)
    if (typeof timer.unref === 'function') timer.unref()
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new DOMException('Aborted', 'AbortError'))
      },
      { once: true },
    )
  })
}

/** Exponential with jitter, capped at 10 s: ~2s, ~4s, ~8s. */
export function retryDelay(attempt: number, retryAfterHeader?: string | null): number {
  if (retryAfterHeader) {
    const seconds = Number(retryAfterHeader)
    if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, RETRY_AFTER_MAX_MS)
    const date = Date.parse(retryAfterHeader)
    if (!Number.isNaN(date)) return Math.min(Math.max(date - Date.now(), 1000), RETRY_AFTER_MAX_MS)
  }
  const base = Math.min(2000 * 2 ** attempt, 10_000)
  return Math.round(base * (0.7 + Math.random() * 0.6))
}

export async function withRetry<T>(fn: (attempt: number) => Promise<T>, signal?: AbortSignal): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < RETRY_MAX_ATTEMPTS; attempt++) {
    try {
      return await fn(attempt)
    } catch (err) {
      lastError = err
      if (signal?.aborted) throw err
      if (err instanceof DOMException && err.name === 'AbortError') throw err
      const status = err instanceof LlmError ? err.status : undefined
      // Timeouts already burned seconds of wall clock — cap their retries.
      const message = err instanceof Error ? err.message : String(err)
      const isTimeout = /timed?\s?out|ETIMEDOUT|ECONNRESET|socket hang up/i.test(message)
      const attemptsAllowed = isTimeout ? Math.min(RETRY_MAX_ATTEMPTS, 3) : RETRY_MAX_ATTEMPTS
      if (attempt + 1 >= attemptsAllowed || !isRetryable(status)) throw err
      const retryAfter = err instanceof LlmError ? err.retryAfter ?? null : null
      await sleep(retryDelay(attempt, retryAfter), signal)
    }
  }
  throw lastError
}
