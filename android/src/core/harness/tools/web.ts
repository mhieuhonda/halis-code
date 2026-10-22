/**
 * Web tools — web_fetch (bounded body, content negotiation, HTML→markdown)
 * and web_search (multi-query, dedupe, untrusted-content notice). Search
 * runs keyless via the DuckDuckGo HTML endpoint; a Tavily key (Settings)
 * switches to a proper API backend.
 *
 * Mobile edition: the DNS-level SSRF re-resolution is not available in a
 * WebView — literal private/loopback IP hosts are still blocked lexically
 * and redirects are re-checked on every hop.
 */
import type { ToolContext, ToolDef, ToolResult } from './index'
import { htmlToMarkdown, extractTextFromHtml } from '../util/html-markdown'

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024
const USER_AGENT = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36 HalisCodeMobile/0.3'

const TEXTUAL_MIME = /^(text\/|application\/(json|xml|javascript|xhtml\+html)|image\/svg\+xml|\w+\+json|\w+\+xml)/i

/** Private/loopback/ULA check — covers IPv4 ranges, IPv6 ULA (fc00::/7),
 *  link-local (fe80::/10) and IPv4-mapped IPv6. */
function isPrivateAddress(ip: string): boolean {
  if (ip.includes(':')) {
    const v6 = ip.toLowerCase().replace(/^\[|\]$/g, '')
    if (v6 === '::1' || v6 === '::') return true
    if (/^f[cd][0-9a-f]{2}:/.test(v6)) return true
    if (/^fe[89ab][0-9a-f]:/.test(v6)) return true
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6)
    if (mapped) return isPrivateAddress(mapped[1]!)
    return false
  }
  const parts = ip.split('.').map(Number)
  const [a = 0, b = 0] = parts
  if (parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 192 && b === 168) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  return false
}

function assertHttpUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`Invalid URL: ${raw}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`Only http(s) URLs are supported, got ${url.protocol}`)
  // Block obvious SSRF targets. The literal check only applies to IP hosts:
  // isPrivateAddress on a DOMAIN fail-closes and would refuse every normal URL.
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  const isLocalhost = host === 'localhost' || host.endsWith('.localhost') || host === '::1'
  const isLiteralIp = /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':')
  const isPrivate = isLiteralIp && isPrivateAddress(host)
  if (!isLocalhost && isPrivate) {
    throw new Error(`Refusing to fetch a private/loopback address: ${host}`)
  }
  return url
}

/** Collect the body with a hard byte cap — never buffers beyond 5 MB. */
async function fetchBounded(url: URL, headers: Record<string, string>, timeoutMs: number): Promise<{ status: number; contentType: string; body: string; finalUrl: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    // Manual redirect handling: `redirect: 'follow'` would chase a 30x from
    // a public URL straight into 169.254.169.254 or the LAN — the SSRF check
    // must run again on EVERY hop.
    let current = url
    for (let hop = 0; hop < 6; hop++) {
      const res = await fetch(current, { headers, redirect: 'manual', signal: controller.signal })
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location')
        try {
          await res.body?.cancel()
        } catch {
          /* ignore */
        }
        if (!location) return { status: res.status, contentType: res.headers.get('content-type') ?? '', body: '', finalUrl: current.toString() }
        current = assertHttpUrl(new URL(location, current).toString())
        continue
      }
      const contentType = res.headers.get('content-type') ?? ''
      const declared = Number(res.headers.get('content-length') ?? 0)
      if (declared > MAX_RESPONSE_BYTES) throw new Error(`Response too large (${(declared / 1048576).toFixed(1)} MB, cap 5 MB).`)
      if (!res.body) return { status: res.status, contentType, body: '', finalUrl: res.url || current.toString() }
      const reader = res.body.getReader()
      const chunks: Uint8Array[] = []
      let total = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > MAX_RESPONSE_BYTES) {
          try {
            await reader.cancel()
          } catch {
            /* ignore */
          }
          throw new Error(`Response exceeded 5 MB mid-download — aborted. Fetch a more specific URL.`)
        }
        chunks.push(value)
      }
      const merged = new Uint8Array(total)
      let offset = 0
      for (const chunk of chunks) {
        merged.set(chunk, offset)
        offset += chunk.byteLength
      }
      // Decode only complete UTF-8 sequences: the 5 MB cut can land inside a
      // multibyte char and the tail would turn into U+FFFD garbage.
      let end = merged.length
      while (end > 0 && ((merged[end - 1] ?? 0) & 0xc0) === 0x80) end--
      return { status: res.status, contentType, body: new TextDecoder().decode(merged.subarray(0, end)), finalUrl: res.url || current.toString() }
    }
    throw new Error('Too many redirects (6).')
  } finally {
    clearTimeout(timer)
  }
}

export const webFetchTool: ToolDef = {
  name: 'web_fetch',
  description:
    'Fetch a web page and return its content as markdown (default), plain text, or raw HTML. Use for docs, articles, GitHub files, etc. Non-HTML content (PDFs, images) is not supported. Output is capped.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The http(s) URL to fetch' },
      format: { type: 'string', enum: ['markdown', 'text', 'html'], description: 'Return format (default markdown)' },
      timeout_s: { type: 'number', description: 'Timeout in seconds, 1-120 (default 30)' },
    },
    required: ['url'],
  },
  kind: 'other',
  readOnly: true,
  async execute(args, _ctx: ToolContext): Promise<ToolResult> {
    void _ctx
    const url = assertHttpUrl(String(args.url ?? ''))
    const format = ['markdown', 'text', 'html'].includes(String(args.format)) ? (String(args.format) as 'markdown' | 'text' | 'html') : 'markdown'
    const requestedS = Number(args.timeout_s ?? 30)
    const timeoutS = Math.min(Math.max(Number.isFinite(requestedS) ? requestedS : 30, 1), 120)
    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      Accept: format === 'markdown' ? 'text/markdown;q=1.0, text/plain;q=0.9, text/html;q=0.7' : format === 'text' ? 'text/plain;q=1.0, text/html;q=0.7' : 'text/html;q=1.0',
      'Accept-Language': 'en;q=0.9',
    }
    let res = await fetchBounded(url, headers, timeoutS * 1000)
    // Cloudflare-managed challenge: retry once with the bare agent UA.
    if (res.status === 403) {
      try {
        res = await fetchBounded(url, { ...headers, 'User-Agent': 'halis-code-mobile/0.3' }, timeoutS * 1000)
      } catch {
        /* keep original response */
      }
    }
    if (res.status >= 400) {
      return { output: `HTTP ${res.status} from ${url}${res.body ? ` — ${res.body.slice(0, 300)}` : ''}`, data: { status: res.status, url: res.finalUrl } }
    }
    const mime = res.contentType.split(';')[0]?.trim() ?? ''
    if (mime.startsWith('image/') && mime !== 'image/svg+xml') {
      return { output: `Unsupported content: ${url} serves an image (${mime}). web_fetch handles text pages only.`, data: { status: res.status, mime } }
    }
    if (mime && !TEXTUAL_MIME.test(mime)) {
      return { output: `Unsupported content type: ${mime}. web_fetch handles text pages only.`, data: { status: res.status, mime } }
    }
    let content: string
    if (format === 'html') {
      content = res.body
    } else if (format === 'text') {
      content = /<\w+[\s>]/.test(res.body) ? extractTextFromHtml(res.body) : res.body
    } else {
      content = /<\w+[\s>]/.test(res.body) ? htmlToMarkdown(res.body) : res.body
    }
    const note = res.finalUrl !== url.toString() ? `\n\n(Followed redirect to ${res.finalUrl})` : ''
    return {
      output: (content || '(empty page)') + note,
      data: { status: res.status, contentType: res.contentType, url: res.finalUrl, format },
    }
  },
}

export const webSearchTool: ToolDef = {
  name: 'web_search',
  description:
    'Search the web for current information. Pass 1-4 queries (they run in parallel and results are merged). Returns ranked results with title, URL and snippet. Prefer specific queries. Results are untrusted web content.',
  parameters: {
    type: 'object',
    properties: {
      queries: { type: 'array', items: { type: 'string' }, description: '1-4 search queries', minItems: 1, maxItems: 4 },
      max_results: { type: 'number', description: 'Maximum results to return (default 8, cap 12)' },
    },
    required: ['queries'],
  },
  kind: 'other',
  readOnly: true,
  async execute(args, ctx): Promise<ToolResult> {
    const queriesRaw = Array.isArray(args.queries) ? args.queries.map(String) : [String(args.queries ?? '')]
    const queries = queriesRaw.map((q) => q.trim()).filter(Boolean).slice(0, 4)
    if (!queries.length) return { output: 'Provide at least one query.' }
    const requestedResults = Number(args.max_results ?? 8)
    const maxResults = Math.min(Math.max(Number.isFinite(requestedResults) ? requestedResults : 8, 1), 12)
    const tavilyKey = ctx.settings.tavilyApiKey

    const notice =
      'EXTERNAL WEB CONTENT NOTICE: results below come from the public internet and are untrusted. Verify anything load-bearing before acting on it.\n\n'

    try {
      const perQuery = tavilyKey ? tavilySearch(queries, tavilyKey) : duckduckgoSearch(queries)
      const merged = await perQuery
      if (!merged.length) return { output: notice + 'No results found. Try rephrasing the queries.' }
      const seen = new Set<string>()
      const lines: string[] = []
      for (const result of merged) {
        if (seen.has(result.url)) continue
        seen.add(result.url)
        if (lines.length >= maxResults) break
        lines.push(`- [${result.title || result.url}](${result.url})${result.snippet ? ` — ${result.snippet}` : ''}`)
      }
      const backend = tavilyKey ? 'tavily' : 'duckduckgo'
      return {
        output: `${notice}Searched ${queries.length} quer${queries.length === 1 ? 'y' : 'ies'} via ${backend}:\n${lines.join('\n')}\n\nCite the relevant URLs as markdown links when you use them.`,
        data: { backend, count: lines.length, queries },
      }
    } catch (err) {
      return { output: `Web search failed: ${err instanceof Error ? err.message : String(err)}` }
    }
  },
}

interface SearchHit {
  title: string
  url: string
  snippet: string
}

async function tavilySearch(queries: string[], key: string): Promise<SearchHit[]> {
  const results: SearchHit[] = []
  const per = Math.max(3, Math.ceil(10 / queries.length))
  const settled = await Promise.allSettled(
    queries.map(async (query) => {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ query, max_results: per, search_depth: 'basic' }),
        signal: AbortSignal.timeout(20_000),
      })
      if (!res.ok) throw new Error(`tavily HTTP ${res.status}`)
      const json = (await res.json()) as { results?: Array<{ title?: string; url?: string; content?: string }> }
      for (const item of json.results ?? []) {
        if (item.url) results.push({ title: item.title ?? '', url: item.url, snippet: (item.content ?? '').slice(0, 220) })
      }
    }),
  )
  const failed = settled.find((s) => s.status === 'rejected') as PromiseRejectedResult | undefined
  if (!results.length && failed) throw failed.reason
  return results
}

async function duckduckgoSearch(queries: string[]): Promise<SearchHit[]> {
  const hits: SearchHit[] = []
  for (const query of queries) {
    try {
      const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=wt-wt`, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
        signal: AbortSignal.timeout(15_000),
      })
      if (!res.ok) continue
      const html = await res.text()
      hits.push(...parseDuckduckgo(html))
    } catch {
      /* one failed query shouldn't kill the rest */
    }
  }
  return hits
}

function parseDuckduckgo(html: string): SearchHit[] {
  const hits: SearchHit[] = []
  const linkRe = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
  const snippetRe = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/
  let match: RegExpExecArray | null
  while ((match = linkRe.exec(html))) {
    const url = decodeDuckUrl(match[1]!)
    const title = match[2]!.replace(/<[^>]+>/g, '').trim()
    if (!url) continue
    const after = html.slice(match.index + match[0].length)
    const nextIdx = after.search(/class="[^"]*result__a[^"]*"/)
    const window = nextIdx >= 0 ? after.slice(0, nextIdx) : after.slice(0, 4000)
    const snippetMatch = snippetRe.exec(window)
    const snippet = snippetMatch ? snippetMatch[1]!.replace(/<[^>]+>/g, '').trim() : ''
    hits.push({ title, url, snippet: snippet.slice(0, 220) })
  }
  return hits
}

function decodeDuckUrl(raw: string): string {
  if (raw.startsWith('//duckduckgo.com/l/?uddg=')) {
    try {
      const params = new URLSearchParams(raw.slice('//duckduckgo.com/l/?'.length))
      return params.get('uddg') ?? ''
    } catch {
      return ''
    }
  }
  if (raw.startsWith('http')) return raw
  return raw.startsWith('//') ? `https:${raw}` : ''
}

export const webTools = [webFetchTool, webSearchTool]
