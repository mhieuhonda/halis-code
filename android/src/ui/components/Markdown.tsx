/** Markdown rendering with code highlighting + copy buttons. */
import { memo, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import hljs from 'highlight.js/lib/common'
import { Check, Copy } from 'lucide-react'

/** Above this size highlightAuto is skipped (it tries ~40 grammars over the
 * full text — O(grammars × size) per render while streaming a long block). */
const AUTO_HIGHLIGHT_CAP = 4096
/** Language guessing only looks at a prefix — cheap and good enough. */
const GUESS_PREFIX = 2048

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const CodeBlock = memo(function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false)
  let html = code
  try {
    if (lang && hljs.getLanguage(lang)) {
      html = hljs.highlight(code, { language: lang }).value
    } else if (code.length <= AUTO_HIGHLIGHT_CAP) {
      html = hljs.highlightAuto(code).value
    } else {
      // Guess the language from a prefix, then highlight the FULL text once
      // with that single grammar — still linear, no 40-grammar sweep.
      const guess = hljs.highlightAuto(code.slice(0, GUESS_PREFIX)).language
      html = guess && hljs.getLanguage(guess) ? hljs.highlight(code, { language: guess }).value : escapeHtml(code)
    }
  } catch {
    html = escapeHtml(code)
  }
  return (
    <div className="code-block group relative my-4">
      <div className="flex items-center justify-between px-3.5 py-[7px] bg-[var(--hal-alias-markdown-code-block-banner)]">
        <span className="text-[11px] leading-[18px] font-mono uppercase text-[color:var(--hal-alias-label-tertiary)]">{lang || 'code'}</span>
        <button
          className="opacity-0 group-hover:opacity-100 transition-opacity duration-100 text-[color:var(--hal-alias-label-tertiary)] hover:text-ink cursor-pointer flex items-center gap-1 text-[11px] bg-transparent border-none p-0"
          onClick={() => {
            void navigator.clipboard.writeText(code)
            setCopied(true)
            setTimeout(() => setCopied(false), 1400)
          }}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'copied' : 'copy'}
        </button>
      </div>
      <pre>
        <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    </div>
  )
})

/**
 * Hoisted to module scope: an inline `components` object creates NEW component
 * types on every render, so react-markdown remounts (not reconciles) every
 * code block on each streaming delta — resetting copy state and forcing a full
 * re-highlight of the growing text on every token.
 */
const markdownComponents = {
  code({ className, children, ...props }: { className?: string; children?: ReactNode }) {
    const match = /language-(\w+)/.exec(className || '')
    const text = String(children ?? '').replace(/\n$/, '')
    // Fenced block vs inline: react-markdown renders fenced code
    // without a wrapping <p>; inline code arrives inside <p>.
    if (!match && !text.includes('\n')) {
      // react-markdown (passNode) injects the hast `node` object into props —
      // spreading it onto the DOM printed node="[object Object]" on every
      // inline code and tripped React's unknown-prop warning.
      const { node: _node, ...rest } = props as typeof props & { node?: unknown }
      return (
        <code className={className} {...rest}>
          {children}
        </code>
      )
    }
    return <CodeBlock code={text} lang={match?.[1]} />
  },
  a({ href, children }: { href?: string; children?: ReactNode }) {
    return (
      <a
        href={href}
        onClick={(e) => {
          e.preventDefault()
          if (href) void window.open(href, '_blank', 'noopener')
        }}
      >
        {children}
      </a>
    )
  },
}

export const Markdown = memo(function Markdown({ children }: { children: string }) {
  return (
    <div className="md-body selectable">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {children}
      </ReactMarkdown>
    </div>
  )
})
