/**
 * HTTP adapter for the WebView runtime.
 *
 * Provider streaming (LLM SSE) must use the platform fetch — CORS on the
 * major provider APIs is supported (Anthropic needs the browser opt-in
 * header, which the client sets). Everything else (Telegraph engine,
 * facilitator, RPC, catalog refresh) goes through the native HTTP stack
 * when running inside Capacitor: no CORS, still all HTTPS.
 */
import { CapacitorHttp, Capacitor, type HttpOptions } from '@capacitor/core'

export const isNative = (): boolean => {
  try {
    return Capacitor.isNativePlatform()
  } catch {
    return false
  }
}

function headerGet(headers: Record<string, string>, name: string): string | null {
  const lower = name.toLowerCase()
  for (const [k, v] of Object.entries(headers ?? {})) {
    if (k.toLowerCase() === lower) return v
  }
  return null
}

/**
 * fetch()-shaped adapter over CapacitorHttp. Non-streaming only (engine
 * responses are JSON); the abort signal cannot cancel a native request, so
 * timeouts ride on readTimeout instead.
 */
export const nativeFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  const method = (init?.method ?? 'GET').toUpperCase()
  const headers: Record<string, string> = {}
  if (init?.headers) {
    const h = new Headers(init.headers as HeadersInit)
    h.forEach((v, k) => (headers[k] = v))
  }
  const options: HttpOptions = {
    url,
    method: method as HttpOptions['method'],
    headers,
    connectTimeout: 15_000,
    readTimeout: 90_000,
    responseType: 'text',
  }
  if (typeof init?.body === 'string') options.data = init.body
  try {
    const res = await CapacitorHttp.request(options)
    const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? '')
    return new Response(body, { status: res.status, headers: res.headers })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new TypeError(`native request failed: ${message}`)
  }
}

/** Fetch that prefers the native stack for non-streaming work. */
export const httpFetch: typeof fetch = (input, init) => {
  if (isNative() && (!init?.method || init.method.toUpperCase() !== 'GET_STREAM')) return nativeFetch(input, init) as Promise<Response>
  return fetch(input, init)
}

export { headerGet }
