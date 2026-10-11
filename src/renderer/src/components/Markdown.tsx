/** Markdown rendering with code highlighting + copy buttons. */
import { memo, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import hljs from 'highlight.js/lib/common'
import { Check, Copy } from 'lucide-react'

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false)
  let html = code
  try {
    if (lang && hljs.getLanguage(lang)) {
      html = hljs.highlight(code, { language: lang }).value
    } else {
      html = hljs.highlightAuto(code).value
    }
  } catch {
    html = code.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  }
  return (
    <div className="group relative">
      <div className="flex items-center justify-between px-3.5 py-1.5 border-b border-line bg-[#10151f]">
        <span className="text-[10.5px] font-mono uppercase tracking-wider text-faint">{lang || 'code'}</span>
        <button
          className="opacity-0 group-hover:opacity-100 transition-opacity text-muted hover:text-ink cursor-pointer flex items-center gap-1 text-[11px]"
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
}

export const Markdown = memo(function Markdown({ children }: { children: string }) {
  return (
    <div className="md-body selectable">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children, ...props }: { className?: string; children?: ReactNode }) {
            const match = /language-(\w+)/.exec(className || '')
            const text = String(children ?? '').replace(/\n$/, '')
            // Fenced block vs inline: react-markdown renders fenced code
            // without a wrapping <p>; inline code arrives inside <p>.
            if (!match && !text.includes('\n')) {
              return (
                <code className={className} {...props}>
                  {children}
                </code>
              )
            }
            return <CodeBlock code={text} lang={match?.[1]} />
          },
          a({ href, children }) {
            return (
              <a href={href} onClick={(e) => {
                e.preventDefault()
                if (href) void window.open(href, '_blank', 'noopener')
              }}>
                {children}
              </a>
            )
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
})
