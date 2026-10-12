/**
 * HTML → Markdown/text conversion — modeled on opencode's html-markdown
 * but written against a dependency-free tolerant tokenizer. Handles
 * headings, lists (ul/ol), blockquotes, fenced code, Markdown tables,
 * links, images and inline styling, with a parse-depth guard and an
 * output budget so hostile pages can't blow up the harness.
 */

const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'iframe', 'object', 'embed', 'meta', 'link', 'template', 'head', 'svg', 'canvas'])
const BLOCK_TAGS = new Set(['p', 'div', 'section', 'article', 'header', 'footer', 'main', 'nav', 'aside', 'hr', 'figure', 'figcaption', 'address', 'form', 'fieldset', 'dl', 'dt', 'dd'])
const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'source', 'wbr', 'area', 'base', 'col', 'embed', 'track', 'meta', 'link'])
const MAX_DEPTH = 512
const MAX_OUTPUT_CHARS = 400_000

interface Token {
  kind: 'text' | 'open' | 'close' | 'void'
  tag: string
  attrs: Record<string, string>
  text: string
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const re = /([a-zA-Z_:@][-a-zA-Z0-9_:.]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw))) {
    attrs[m[1]!.toLowerCase()] = decodeEntities(m[3] ?? m[4] ?? m[5] ?? '')
  }
  return attrs
}

/** Very tolerant HTML tokenizer — never throws on malformed input. */
export function tokenizeHtml(html: string): Token[] {
  const tokens: Token[] = []
  const len = html.length
  let i = 0
  while (i < len) {
    const lt = html.indexOf('<', i)
    if (lt < 0) {
      tokens.push({ kind: 'text', tag: '', attrs: {}, text: html.slice(i) })
      break
    }
    if (lt > i) tokens.push({ kind: 'text', tag: '', attrs: {}, text: html.slice(i, lt) })
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4)
      i = end < 0 ? len : end + 3
      continue
    }
    if (html[lt + 1] === '!' || html[lt + 1] === '?') {
      const end = html.indexOf('>', lt)
      i = end < 0 ? len : end + 1
      continue
    }
    const close = html[lt + 1] === '/'
    const nameStart = lt + (close ? 2 : 1)
    let j = nameStart
    while (j < len && /[a-zA-Z0-9:-]/.test(html[j]!)) j++
    const tag = html.slice(nameStart, j).toLowerCase()
    if (!tag) {
      tokens.push({ kind: 'text', tag: '', attrs: {}, text: '<' })
      i = lt + 1
      continue
    }
    let k = j
    let quote: string | null = null
    while (k < len) {
      const c = html[k]
      if (quote) {
        if (c === quote) quote = null
      } else if (c === '"' || c === "'") {
        quote = c
      } else if (c === '>') {
        break
      }
      k++
    }
    const attrsRaw = html.slice(j, k)
    const selfClosing = html[k - 1] === '/'
    i = k < len ? k + 1 : len
    if (close) tokens.push({ kind: 'close', tag, attrs: {}, text: '' })
    else if (selfClosing || VOID_TAGS.has(tag)) tokens.push({ kind: 'void', tag, attrs: parseAttrs(attrsRaw), text: '' })
    else tokens.push({ kind: 'open', tag, attrs: parseAttrs(attrsRaw), text: '' })
  }
  return tokens
}

/* ------------------------------------------------------------------ */
/* Renderer                                                           */
/* ------------------------------------------------------------------ */

interface ListState {
  kind: 'ul' | 'ol' | 'quote'
  index: number
}

class MarkdownRenderer {
  private out = ''
  private depth = 0
  private listStack: ListState[] = []
  private skipDepth = 0
  private skipTag: string | null = null
  private table: { rows: string[][]; header: string[] | null; inRow: string[]; cell: string; thSeen: boolean } | null = null
  private inPre = false
  private preContent: string[] = []
  private preLang = ''
  private href: string | null = null
  private linkText = ''
  private quoteStart = -1

  private emit(s: string): void {
    if (this.out.length >= MAX_OUTPUT_CHARS) return
    this.out += s
  }

  private ensureBlankLine(): void {
    if (this.out && !this.out.endsWith('\n\n')) {
      if (this.out.endsWith('\n')) this.out += '\n'
      else this.out += '\n\n'
    }
  }

  private hidden(attrs: Record<string, string>): boolean {
    if (attrs['hidden'] !== undefined) return true
    if ((attrs['aria-hidden'] ?? '').toLowerCase() === 'true') return true
    const style = attrs['style'] ?? ''
    return /display\s*:\s*none/i.test(style) || /visibility\s*:\s*(hidden|collapse)/i.test(style)
  }

  render(tokens: Token[]): string {
    for (const token of tokens) {
      if (this.out.length >= MAX_OUTPUT_CHARS) break
      if (token.kind === 'text') {
        this.text(token.text)
      } else if (token.kind === 'open') {
        this.open(token)
      } else if (token.kind === 'close') {
        this.close(token.tag)
      } else {
        this.void(token)
      }
    }
    return this.out.replace(/\n{3,}/g, '\n\n').trim()
  }

  private text(raw: string): void {
    if (this.skipDepth > 0) return
    const t = decodeEntities(raw)
    if (this.inPre) {
      this.preContent.push(t)
      return
    }
    if (this.table) {
      if (/\S/.test(t)) this.table.cell += t.replace(/\s+/g, ' ')
      return
    }
    if (this.href !== null) {
      this.linkText += t.replace(/\s+/g, ' ')
      return
    }
    this.emit(t.replace(/[ \t\r]*\n[ \t\r]*/g, '\n').replace(/[ \t]{2,}/g, ' '))
  }

  private open(token: Token): void {
    const { tag, attrs } = token
    if (this.skipDepth > 0) {
      if (tag === this.skipTag && !VOID_TAGS.has(tag)) this.skipDepth++
      return
    }
    if ((SKIP_TAGS.has(tag) || tag === 'head' || this.hidden(attrs)) && !VOID_TAGS.has(tag)) {
      this.skipDepth = 1
      this.skipTag = tag
      return
    }
    this.depth++
    if (this.depth > MAX_DEPTH) {
      this.skipDepth = 1
      this.emit('\n[HTML content omitted: document nesting too deep to convert safely.]\n')
      return
    }
    switch (tag) {
      case 'pre': {
        this.inPre = true
        this.preContent = []
        const codeClass = /language-([\w+-]+)/.exec(attrs['class'] ?? '')
        this.preLang = codeClass?.[1] ?? ''
        return
      }
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6':
        this.ensureBlankLine()
        this.emit('#'.repeat(Number(tag[1])) + ' ')
        return
      case 'blockquote':
        this.ensureBlankLine()
        this.listStack.push({ kind: 'quote', index: 0 })
        this.quoteStart = this.out.length
        return
      case 'ul':
        this.ensureBlankLine()
        this.listStack.push({ kind: 'ul', index: 0 })
        return
      case 'ol': {
        this.ensureBlankLine()
        const start = Math.max(1, Number(attrs['start'] ?? 1) || 1)
        this.listStack.push({ kind: 'ol', index: start })
        return
      }
      case 'li': {
        const top = this.listStack[this.listStack.length - 1]
        if (top && top.kind !== 'quote') {
          const indent = '  '.repeat(Math.max(0, this.listStack.length - 1))
          if (top.kind === 'ol') {
            this.emit(`${indent}${top.index}. `)
            top.index++
          } else {
            this.emit(`${indent}- `)
          }
        }
        return
      }
      case 'p':
        this.ensureBlankLine()
        return
      case 'br':
        this.emit('  \n')
        return
      case 'hr':
        this.ensureBlankLine()
        this.emit('---\n\n')
        return
      case 'a':
        if (attrs['href'] !== undefined) {
          this.href = attrs['href']
          this.linkText = ''
        }
        return
      case 'img': {
        const src = attrs['src'] ?? ''
        const alt = (attrs['alt'] ?? 'image').replace(/[\]()]/g, '')
        if (src) this.emit(`![${alt}](${src})`)
        return
      }
      case 'strong':
      case 'b':
        this.emit('**')
        return
      case 'em':
      case 'i':
        this.emit('*')
        return
      case 'code': {
        if (this.inPre && !this.preLang) {
          const codeClass = /language-([\w+-]+)/.exec(attrs['class'] ?? '')
          if (codeClass) this.preLang = codeClass[1] ?? ''
          return
        }
        if (!this.inPre) this.emit('`')
        return
      }
      case 'del':
      case 's':
        this.emit('~~')
        return
      case 'table':
        this.table = { rows: [], header: null, inRow: [], cell: '', thSeen: false }
        return
      case 'tr':
        if (this.table) this.table.inRow = []
        return
      case 'th':
      case 'td':
        if (this.table) this.table.cell = ''
        return
      case 'summary':
        this.ensureBlankLine()
        this.emit('**')
        return
      default:
        if (BLOCK_TAGS.has(tag)) this.ensureBlankLine()
        return
    }
  }

  private close(tag: string): void {
    if (this.skipDepth > 0) {
      if (tag === this.skipTag && !VOID_TAGS.has(tag)) {
        this.skipDepth--
        if (this.skipDepth === 0) this.skipTag = null
      }
      return
    }
    if (SKIP_TAGS.has(tag) || tag === 'head') return
    this.depth = Math.max(0, this.depth - 1)
    switch (tag) {
      case 'pre': {
        this.inPre = false
        const raw = this.preContent.join('').replace(/^\n+|\n+$/g, '')
        const runs = [...raw.matchAll(/`{3,}/g)].map((m) => m[0].length)
        const longest = runs.length ? Math.max(...runs) : 2
        const fence = '`'.repeat(Math.max(3, longest + 1))
        this.ensureBlankLine()
        this.emit(`${fence}${this.preLang}\n${raw}\n${fence}\n\n`)
        return
      }
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6':
        this.emit('\n\n')
        return
      case 'blockquote': {
        if (this.quoteStart >= 0) {
          const chunk = this.out.slice(this.quoteStart)
          this.out = this.out.slice(0, this.quoteStart)
          const quoted = chunk
            .replace(/\n+$/, '')
            .split('\n')
            .map((line) => (line.trim() ? `> ${line}` : '>'))
            .join('\n')
          this.out += quoted + '\n\n'
        }
        this.quoteStart = -1
        const top = this.listStack[this.listStack.length - 1]
        if (top?.kind === 'quote') this.listStack.pop()
        return
      }
      case 'ul':
      case 'ol':
        this.listStack.pop()
        this.ensureBlankLine()
        return
      case 'li':
        if (this.listStack.length) this.emit('\n')
        return
      case 'p':
        this.ensureBlankLine()
        return
      case 'a': {
        if (this.href !== null) {
          const text = this.linkText.trim()
          const href = this.href
          this.href = null
          this.linkText = ''
          if (text) this.emit(`[${text}](${href})`)
          else if (href.startsWith('http')) this.emit(`<${href}>`)
        }
        return
      }
      case 'strong':
      case 'b':
        this.emit('**')
        return
      case 'em':
      case 'i':
        this.emit('*')
        return
      case 'code':
        if (!this.inPre) this.emit('`')
        return
      case 'del':
      case 's':
        this.emit('~~')
        return
      case 'tr': {
        if (this.table) {
          if (this.table.header === null && this.table.thSeen) this.table.header = this.table.inRow
          else this.table.rows.push(this.table.inRow)
          this.table.thSeen = false
        }
        return
      }
      case 'th':
        if (this.table) {
          this.table.inRow.push(this.table.cell.trim())
          this.table.thSeen = true
        }
        return
      case 'td':
        if (this.table) this.table.inRow.push(this.table.cell.trim())
        return
      case 'table': {
        const t = this.table
        this.table = null
        if (t) {
          this.ensureBlankLine()
          const header = t.header ?? t.rows.shift()
          if (header?.length) {
            const width = Math.max(header.length, ...t.rows.map((r) => r.length), 1)
            const pad = (cells: string[]) => [...cells, ...Array<string>(width - cells.length).fill('')].map((c) => c.replace(/\|/g, '\\|'))
            this.emit(`| ${pad(header).join(' | ')} |\n`)
            this.emit(`| ${Array<string>(width).fill('---').join(' | ')} |\n`)
            for (const row of t.rows) this.emit(`| ${pad(row).join(' | ')} |\n`)
            this.emit('\n')
          }
        }
        return
      }
      case 'summary':
        this.emit('**\n\n')
        return
      default:
        if (BLOCK_TAGS.has(tag)) this.ensureBlankLine()
        return
    }
  }

  private void(token: Token): void {
    if (this.skipDepth > 0) return
    if (token.tag === 'img') {
      this.open(token)
      return
    }
    if (token.tag === 'br') this.emit('  \n')
    if (token.tag === 'hr') {
      this.ensureBlankLine()
      this.emit('---\n\n')
    }
  }
}

export function htmlToMarkdown(html: string): string {
  try {
    const renderer = new MarkdownRenderer()
    return renderer.render(tokenizeHtml(html))
  } catch {
    return extractTextFromHtml(html)
  }
}

/** Plain-text extraction — the "text" format of web_fetch. */
export function extractTextFromHtml(html: string): string {
  try {
    let text = ''
    for (const token of tokenizeHtml(html)) {
      if (token.kind === 'text') text += ` ${decodeEntities(token.text)} `
      else if (token.kind === 'void' && token.tag === 'br') text += '\n'
    }
    return text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_OUTPUT_CHARS)
  } catch {
    return ''
  }
}
