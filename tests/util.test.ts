import { describe, expect, it } from 'vitest'
import { diffStats, fuzzyReplace, unifiedDiff } from '../src/main/harness/util/edit-match'
import { htmlToMarkdown, extractTextFromHtml } from '../src/main/harness/util/html-markdown'
import { truncateToolOutput, setToolOutputSpillDir } from '../src/main/harness/util/truncate'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('fuzzyReplace', () => {
  const source = `function greet(name) {\r\n  console.log("Hello, " + name)\r\n}\r\n`

  it('replaces exactly', () => {
    const result = fuzzyReplace(source, 'console.log("Hello, " + name)', 'console.log(`Hi, ${name}`)', false)
    expect(result.strategy).toBe('exact')
    expect(result.content).toContain('`Hi, ${name}`')
  })

  it('normalizes unicode look-alikes', () => {
    const weird = 'const s = \u201Cquoted\u201D\n'
    const result = fuzzyReplace(weird, 'const s = "quoted"', 'const s = "plain"', false)
    expect(result.strategy).toBe('normalized')
    expect(result.content).toContain('"plain"')
  })

  it('matches line-based with CRLF tolerance', () => {
    // Old string uses \n while the file uses \r\n — tier 3 must still match.
    const result = fuzzyReplace(source, 'function greet(name) {\n  console.log("Hello, " + name)\n}', 'export default function greet(name) {\n  return name\n}', false)
    expect(result.strategy).toBe('line-based')
    expect(result.content).toContain('return name')
    expect(result.content).toContain('\r\n')
  })

  it('reports ambiguous matches instead of guessing', () => {
    const dup = 'x\nx\n'
    const result = fuzzyReplace(dup, 'x', 'y', false)
    expect(result.content).toBeNull()
    expect(result.occurrences).toBe(2)
  })

  it('replace_all hits every occurrence', () => {
    const result = fuzzyReplace('x\nx\n', 'x', 'y', true)
    expect(result.content).toBe('y\ny\n')
    expect(result.occurrences).toBe(2)
  })
})

describe('diffStats + unifiedDiff', () => {
  it('counts additions and deletions', () => {
    const stats = diffStats('a\nb\nc\n', 'a\nB\nc\nd\n')
    expect(stats).toEqual({ additions: 2, deletions: 1 })
  })
  it('renders +/- lines', () => {
    const diff = unifiedDiff('a\n', 'b\n')
    expect(diff).toContain('-a')
    expect(diff).toContain('+b')
  })
})

describe('htmlToMarkdown', () => {
  it('converts headings, paragraphs and links', () => {
    const html = '<html><head><title>t</title></head><body><h1>Title</h1><p>See <a href="https://x.io">this</a>.</p></body></html>'
    const md = htmlToMarkdown(html)
    expect(md).toContain('# Title')
    expect(md).toContain('[this](https://x.io)')
    expect(md).not.toContain('<title>')
  })

  it('renders fenced code with language', () => {
    const md = htmlToMarkdown('<pre><code class="language-ts">const x = 1</code></pre>')
    expect(md).toContain('```ts')
    expect(md).toContain('const x = 1')
  })

  it('renders Markdown tables', () => {
    const html = '<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>'
    const md = htmlToMarkdown(html)
    expect(md).toContain('| A | B |')
    expect(md).toContain('| 1 | 2 |')
  })

  it('drops scripts and hidden elements', () => {
    const html = '<body><script>alert(1)</script><div style="display:none">hidden</div><p>visible</p><span aria-hidden="true">ghost</span></body>'
    const md = htmlToMarkdown(html)
    expect(md).toContain('visible')
    expect(md).not.toContain('alert(1)')
    expect(md).not.toContain('hidden')
    expect(md).not.toContain('ghost')
  })

  it('extracts plain text', () => {
    expect(extractTextFromHtml('<p>Hello <b>world</b></p>')).toContain('Hello world')
  })
})

describe('truncateToolOutput', () => {
  it('passes short output through untouched', () => {
    const result = truncateToolOutput('short', 'id1')
    expect(result.truncated).toBe(false)
    expect(result.text).toBe('short')
  })

  it('clips long output and spills the full text', () => {
    const dir = mkdtempSync(join(tmpdir(), 'halis-toolout-'))
    setToolOutputSpillDir(dir)
    const big = Array.from({ length: 5000 }, (_, i) => `line ${i}: ${'x'.repeat(60)}`).join('\n')
    const result = truncateToolOutput(big, 'id2')
    expect(result.truncated).toBe(true)
    expect(result.text).toContain('[Output truncated')
    expect(result.spillPath).toBeTruthy()
    // The spill file holds the full content.
    const spilled = readFileSync(result.spillPath!, 'utf8')
    expect(spilled).toBe(big)
  })
})
