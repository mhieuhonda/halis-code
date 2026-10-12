/**
 * Race a pending promise against an abort signal.
 *
 * Resolves `null` when the signal fires (or was already aborted) and the
 * wrapped promise is still pending; otherwise resolves the promise's value
 * (a rejection counts as "lost" and resolves null too — callers treat null
 * as "cancelled / no answer"). The signal listener is always removed once
 * the race settles, so repeated calls never accumulate listeners on the
 * shared turn signal.
 */
export function raceWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T | null> {
  if (!signal) {
    // No signal to lose to: surface values, swallow rejections as null.
    return promise.catch(() => null) as Promise<T | null>
  }
  if (signal.aborted) return Promise.resolve(null)
  return new Promise<T | null>((resolve) => {
    let settled = false
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    const done = (value: T | null) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(value)
    }
    const onAbort = () => done(null)
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then((value) => done(value), () => done(null))
  })
}
