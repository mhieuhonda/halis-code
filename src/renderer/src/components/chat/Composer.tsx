/** Composer — DSH InputBar card: 28px-radius surface, blue caret,
 *  chip selects, round blue send button, mention popup as menu surface. */
import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Square, AtSign, X } from 'lucide-react'
import { useT } from '../../i18n'
import { Badge, ChipSelect, Spinner } from '../ui'
import { useAppStore } from '../../stores/app'
import { useChatStore } from '../../stores/chat'
import { useSwarmStore } from '../../stores/swarm'

export function ModelPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const t = useT()
  const catalog = useAppStore((s) => s.catalog)
  const [group, setGroup] = useState('all')

  if (!catalog) return null
  const groups = [
    { id: 'free-nokey', label: t('group_free_nokey') },
    { id: 'free-key', label: t('group_free_key') },
    { id: 'local', label: t('group_local') },
    { id: 'all', label: t('group_all') },
  ]
  const keyless = new Set(catalog.providers.filter((p) => p.keyless).map((p) => p.id))
  let models = catalog.models
  if (group === 'free-nokey') models = models.filter((m) => m.free && keyless.has(m.providerId))
  else if (group === 'free-key') models = models.filter((m) => m.free && !keyless.has(m.providerId))
  else if (group === 'local') models = models.filter((m) => m.providerId === 'ollama')

  const current = catalog.models.find((m) => m.id === value)
  // A filtered group (or the 300-option cap) can exclude the selected model —
  // a controlled <select> with no matching option renders blank while the
  // hidden model is still what sends use. Keep it visible as a pinned entry.
  const listed = models.slice(0, 300)
  if (current && !listed.some((m) => m.id === current.id)) listed.unshift(current)

  return (
    <div className="flex items-center gap-1 min-w-0">
      <ChipSelect value={group} onChange={(e) => setGroup(e.target.value)} aria-label="model group">
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.label}
          </option>
        ))}
      </ChipSelect>
      <ChipSelect value={value} onChange={(e) => onChange(e.target.value)} title={value} className="max-w-[240px]">
        {listed.map((m) => (
          <option key={m.id} value={m.id}>
            {m.providerId !== 'pollinations' ? `${catalog.providers.find((p) => p.id === m.providerId)?.name ?? m.providerId} · ` : ''}
            {m.name}
            {m.free ? ' ✦' : ''}
          </option>
        ))}
      </ChipSelect>
      {current?.free ? <Badge color="#22c55e">free</Badge> : null}
    </div>
  )
}

export function Composer() {
  const t = useT()
  const [text, setText] = useState('')
  const [modelId, setModelId] = useState<string>('')
  const [focused, setFocused] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const { settings, loadSettings } = useAppStore()
  const chat = useChatStore()
  const swarmConfig = useSwarmStore((s) => s.config)

  useEffect(() => {
    if (!modelId && settings?.defaultModelId) setModelId(settings.defaultModelId)
  }, [settings?.defaultModelId, modelId])

  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`
  }, [text])

  const submit = () => {
    const value = text.trim()
    if (!value || chat.running) return
    setText('')
    void chat.send(value, chat.activeMode === 'agent' ? modelId : undefined)
  }

  const mentionStart = (() => {
    const match = text.match(/@([A-Za-z0-9_.-]*)$/)
    return match?.[1]?.toLowerCase() ?? null
  })()

  const suggestions = mentionStart !== null ? swarmConfig.agents.filter((a) => a.name.toLowerCase().includes(mentionStart) && mentionStart !== a.name.toLowerCase()).slice(0, 5) : []

  const applyMention = (name: string) => {
    setText((prev) => prev.replace(/@([A-Za-z0-9_.-]*)$/, `@${name} `))
    taRef.current?.focus()
  }

  const isAgent = chat.activeMode === 'agent'

  return (
    <div className="px-4 pb-3 pt-2">
      {/* typing indicators (swarm) */}
      <div className="h-5 flex items-center gap-3 mb-1 px-2">
        {Object.entries(chat.typing).map(([id, info]) => (
          <span key={id} className="inline-flex items-center gap-1.5 text-[11px] text-[color:var(--dsw-alias-label-secondary)] fade-in">
            <span className="typing-dot w-1 h-1 rounded-full bg-[color:var(--dsw-alias-state-business-primary)] inline-block" />
            {info.name} {t('typing')}
          </span>
        ))}
        {chat.swarmRound ? (
          <span className="text-[11px] text-[color:var(--dsw-alias-label-tertiary)] ml-auto font-mono">
            {t('round_label')} {chat.swarmRound.round}/{chat.swarmRound.maxRounds}
          </span>
        ) : null}
      </div>

      {/* the card — DSH radius-panel surface */}
      <div
        className="relative flex flex-col gap-2 pt-2"
        style={{
          borderRadius: 'var(--dsw-radius-panel)',
          background: 'var(--dsw-specific-input-major)',
          boxShadow: focused ? 'var(--dsw-elevation-prominent)' : 'var(--dsw-elevation-soft)',
          transition: 'box-shadow 150ms ease',
        }}
      >
        {/* input row */}
        <div className="relative">
          {text ? null : (
            <div
              className="absolute left-[22px] right-4 top-[10px] text-[color:var(--dsw-alias-label-caption)] pointer-events-none truncate"
              style={{ fontSize: 'var(--dsh-content-font-size, 14px)', lineHeight: 'calc(24px + var(--dsh-content-font-delta, 0px))' }}
            >
              {isAgent ? t('placeholder_agent') : t('placeholder_swarm')}
            </div>
          )}
          <textarea
            ref={taRef}
            value={text}
            aria-label={isAgent ? t('placeholder_agent') : t('placeholder_swarm')}
            className="block w-full bg-transparent outline-none border-none resize-none selectable min-h-[36px] max-h-[200px] px-[14px] pt-[6px] pb-0 text-ink"
            style={{
              fontFamily: 'var(--dsw-font-family)',
              fontSize: 'var(--dsh-content-font-size, 14px)',
              lineHeight: 'calc(24px + var(--dsh-content-font-delta, 0px))',
              caretColor: 'var(--dsw-alias-state-business-primary)',
            }}
            rows={1}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
          />
        </div>

        {/* tools row */}
        <div className="flex items-center gap-3 px-2 pb-2 min-w-0">
          {isAgent ? (
            <ModelPicker value={modelId || settings?.defaultModelId || 'pollinations/openai-fast'} onChange={(id) => { setModelId(id); void loadSettings() }} />
          ) : (
            <span className="inline-flex items-center gap-1.5 h-7 px-2 rounded-sm text-[12px] font-medium text-[color:var(--dsw-alias-label-secondary)] hover:bg-[var(--dsw-alias-interactive-bg-hover)] cursor-default transition-colors duration-100">
              <AtSign size={12} className="text-[color:var(--dsw-alias-state-business-primary)]" />
              {swarmConfig.agents.length} agents
              {swarmConfig.plannerCoordination ? <Badge color="#8d7fff">planner</Badge> : null}
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            {chat.running ? (
              <button
                className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] text-[color:var(--dsw-alias-state-error-secondary)] hover:bg-[var(--dsw-alias-interactive-bg-hover-danger)] cursor-pointer bg-transparent border-none transition-colors duration-100"
                onClick={() => void chat.stop()}
              >
                <Square size={10} /> {t('stop_turn')}
              </button>
            ) : null}
            <button
              onClick={chat.running ? () => void chat.stop() : submit}
              disabled={!chat.running && !text.trim()}
              className="shrink-0 w-[34px] h-[34px] rounded-full flex items-center justify-center cursor-pointer border-none text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-100"
              style={{ background: 'var(--dsw-alias-button-info-fill)' }}
              onMouseEnter={(e) => { if (!e.currentTarget.disabled) e.currentTarget.style.background = 'var(--dsw-alias-button-info-hover)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--dsw-alias-button-info-fill)' }}
              aria-label={chat.running ? t('stop_turn') : t('send')}
            >
              {chat.running ? <Spinner size={14} className="text-white" /> : <ArrowUp size={16} />}
            </button>
          </div>
        </div>

        {/* @mention popup — DSH menu surface */}
        {suggestions.length > 0 && mentionStart !== null ? (
          <div
            className="dsh-menu-surface absolute bottom-[calc(100%+6px)] left-2 rounded-lg overflow-hidden z-10 p-1 pop"
            style={{ boxShadow: 'var(--dsw-elevation-prominent)' }}
          >
            {suggestions.map((a) => (
              <button
                key={a.id}
                className="flex items-center gap-2 min-h-[34px] px-2.5 rounded-md hover:bg-[var(--dsw-alias-interactive-bg-hover)] w-full text-left cursor-pointer bg-transparent border-none transition-colors duration-100"
                onMouseDown={(e) => { e.preventDefault(); applyMention(a.name) }}
              >
                <span className="w-5 h-5 rounded-sm flex items-center justify-center text-[11px] shrink-0" style={{ background: `${a.color}14`, color: a.color }}>
                  {a.avatar}
                </span>
                <span className="text-[13px] text-ink">{a.name}</span>
                <span className="text-[11px] text-[color:var(--dsw-alias-label-tertiary)]">{a.roleId}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {chat.sendError ? (
        <div className="mt-1.5 mx-1 rounded-md border-[0.5px] border-[color:var(--dsw-alias-state-error-secondary)] px-3 py-1.5 text-[12px] text-[color:var(--dsw-alias-state-error-secondary)] flex items-center gap-2" style={{ background: 'var(--dsw-alias-interactive-bg-hover-danger)' }}>
          <span className="flex-1">{t('send_failed')} — {chat.sendError}</span>
          <button
            className="text-[color:var(--dsw-alias-label-tertiary)] hover:text-ink cursor-pointer bg-transparent border-none p-0 transition-colors duration-100"
            onClick={() => useChatStore.setState({ sendError: null })}
          >
            <X size={12} />
          </button>
        </div>
      ) : null}

      <div className="px-2 mt-1.5 text-[10.5px] text-[color:var(--dsw-alias-label-caption)] flex items-center gap-2">
        <span>Enter ↵ {t('send')}</span>
        <span>·</span>
        <span>Shift+Enter ⏎</span>
        <span className="ml-auto inline-flex items-center gap-1">
          <span className="dsh-kbd">Ctrl</span>
          <span className="dsh-kbd">K</span>
          {t('palette_open')}
        </span>
      </div>
    </div>
  )
}
