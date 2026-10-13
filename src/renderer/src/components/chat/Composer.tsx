/** Composer — DSH InputBar card: 28px-radius surface, blue caret,
 *  chip selects, round blue send button, mention popup as menu surface. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, AtSign, Check, ChevronDown, Square, Star, X } from 'lucide-react'
import { useT } from '../../i18n'
import { AgentAvatar, Badge, Spinner } from '../ui'
import { useAppStore } from '../../stores/app'
import { useChatStore } from '../../stores/chat'
import { useSwarmStore } from '../../stores/swarm'
import type { ModelInfo } from '@shared/types'

/* Model preferences persisted locally: a short favorites + recent list
 * on top of the picker. */
const FAV_KEY = 'halis.model.favorites'
const RECENT_KEY = 'halis.model.recent'
const MAX_PREFS = 10
const BROWSE_CAP = 50

function readPrefs(key: string): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function rememberModel(key: string, id: string): string[] {
  const next = [id, ...readPrefs(key).filter((x) => x !== id)].slice(0, MAX_PREFS)
  localStorage.setItem(key, JSON.stringify(next))
  return next
}

function toggleModelPref(key: string, id: string): string[] {
  const prev = readPrefs(key)
  const next = (prev.includes(id) ? prev.filter((x) => x !== id) : [id, ...prev]).slice(0, MAX_PREFS)
  localStorage.setItem(key, JSON.stringify(next))
  return next
}

export function ModelPicker({ value, onChange, direction = 'up', className = '' }: { value: string; onChange: (id: string) => void; direction?: 'up' | 'down'; className?: string }) {
  const t = useT()
  const catalog = useAppStore((s) => s.catalog)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [favs, setFavs] = useState<string[]>(() => readPrefs(FAV_KEY))
  const [recents, setRecents] = useState<string[]>(() => readPrefs(RECENT_KEY))
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  useEffect(() => {
    if (!open) return
    setQuery('')
    requestAnimationFrame(() => searchRef.current?.focus())
  }, [open])

  const providerName = useMemo(() => {
    const map = new Map((catalog?.providers ?? []).map((p) => [p.id, p.name]))
    return (m: ModelInfo) => map.get(m.providerId) ?? m.providerId
  }, [catalog])

  if (!catalog) return null
  const current = catalog.models.find((m) => m.id === value)
  const q = query.trim().toLowerCase()
  const matches = (m: ModelInfo) => !q || m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q) || providerName(m).toLowerCase().includes(q)

  const favModels = favs.map((id) => catalog.models.find((m) => m.id === id)).filter((m): m is ModelInfo => !!m)
  const recentModels = recents
    .filter((id) => !favs.includes(id))
    .map((id) => catalog.models.find((m) => m.id === id))
    .filter((m): m is ModelInfo => !!m)

  const star = (m: ModelInfo) => (
    <button
      className="shrink-0 p-1 bg-transparent border-none cursor-pointer text-[color:var(--hal-alias-label-dimmed)] hover:text-[var(--hal-alias-state-warn-primary)] transition-colors duration-100"
      title={t('model_favorite_toggle')}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        setFavs(toggleModelPref(FAV_KEY, m.id))
      }}
    >
      <Star size={13} className={favs.includes(m.id) ? 'fill-[var(--hal-alias-state-warn-primary)] text-[var(--hal-alias-state-warn-primary)]' : ''} />
    </button>
  )

  const row = (m: ModelInfo, extraBadge?: React.ReactNode) => (
    <div
      key={m.id}
      className={`group flex items-center gap-2 min-h-[32px] pl-2.5 pr-1 rounded-md cursor-pointer transition-colors duration-100 ${
        m.id === value ? 'bg-[var(--hal-alias-interactive-bg-hover)]' : 'hover:bg-[var(--hal-alias-interactive-bg-hover)]'
      }`}
      title={`${m.id}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        onChange(m.id)
        setRecents(rememberModel(RECENT_KEY, m.id))
        setOpen(false)
      }}
    >
      <span className="flex-1 min-w-0 truncate text-[13px] text-ink">{m.name}</span>
      {extraBadge}
      {m.free ? <Badge color="#22c55e">free</Badge> : null}
      <span className="text-[10.5px] text-[color:var(--hal-alias-label-tertiary)] truncate max-w-[110px]">{providerName(m)}</span>
      {m.id === value ? <Check size={13} className="shrink-0 text-[color:var(--hal-alias-state-success-primary)]" /> : <span className="w-[13px] shrink-0" />}
      <span className="opacity-0 group-hover:opacity-100 transition-opacity">{star(m)}</span>
    </div>
  )

  const section = (label: string, models: ModelInfo[], cap?: number) => {
    if (!models.length) return null
    const shown = cap ? models.slice(0, cap) : models
    return (
      <div key={label} className="px-1">
        <div className="flex items-baseline gap-1.5 px-1.5 pt-2 pb-1">
          <span className="text-[11px] font-medium text-[color:var(--hal-alias-label-tertiary)]">{label}</span>
          <span className="text-[10px] text-[color:var(--hal-alias-label-caption)]">{models.length}</span>
        </div>
        {shown.map((m) => row(m))}
        {cap && models.length > cap ? (
          <div className="px-2.5 py-1.5 text-[11px] text-[color:var(--hal-alias-label-caption)]">{t('model_more', { n: models.length - cap })}</div>
        ) : null}
      </div>
    )
  }

  const popupPos = direction === 'up' ? 'bottom-[calc(100%+6px)]' : 'top-[calc(100%+6px)]'

  return (
    <div ref={rootRef} className={`relative min-w-0 ${className}`}>
      <button
        type="button"
        className="inline-flex items-center gap-1 h-7 max-w-[280px] rounded-sm bg-transparent pl-2 pr-1.5 text-[13px] font-medium text-muted outline-none cursor-pointer hover:bg-[var(--hal-alias-interactive-bg-hover)] transition-colors duration-100"
        onClick={() => setOpen((v) => !v)}
        title={current ? `${current.id}` : t('select_model')}
      >
        <span className="truncate">
          {current ? (
            <>
              {providerName(current)} · {current.name}
            </>
          ) : (
            t('select_model')
          )}
        </span>
        {current?.free ? <span className="text-[#22c55e] text-[11px] leading-none">✦</span> : null}
        <ChevronDown size={13} className={`shrink-0 opacity-60 transition-transform duration-100 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open ? (
        <div
          className={`hal-menu-surface absolute ${popupPos} left-0 z-20 w-[360px] rounded-lg overflow-hidden flex flex-col p-1.5 pop`}
          style={{ boxShadow: 'var(--hal-elevation-prominent)' }}
        >
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation()
                setOpen(false)
              }
            }}
            placeholder={t('model_search')}
            className="shrink-0 h-8 mx-0.5 mb-1 rounded-md bg-[var(--hal-alias-bg-layer-1)] border-[0.5px] border-[color:var(--hal-alias-border-l4)] px-2.5 text-[12.5px] text-ink placeholder:text-[color:var(--hal-alias-label-dimmed)] outline-none focus:border-[color:var(--hal-alias-state-business-primary)]"
          />
          <div className="overflow-y-auto min-h-0 max-h-[380px]">
            {q ? (
              (() => {
                const hits = catalog.models.filter(matches)
                const ranked = [...hits.filter((m) => favs.includes(m.id)), ...hits.filter((m) => !favs.includes(m.id))]
                return ranked.length ? ranked.map((m) => row(m)) : <div className="px-2.5 py-4 text-[12px] text-[color:var(--hal-alias-label-tertiary)]">{t('model_none')}</div>
              })()
            ) : (
              <>
                {section(t('model_favorites'), favModels)}
                {section(t('model_recent'), recentModels)}
                {catalog.providers.map((p) => {
                  const models = catalog.models.filter((m) => m.providerId === p.id && !favs.includes(m.id) && !recents.includes(m.id))
                  if (!models.length) return null
                  const sorted = [...models].sort((a, b) => Number(b.free) - Number(a.free) || a.name.localeCompare(b.name))
                  return section(p.name, sorted, BROWSE_CAP)
                })}
              </>
            )}
          </div>
        </div>
      ) : null}
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
    void chat.send(value, chat.activeMode === 'agent' ? modelId || settings?.defaultModelId || undefined : undefined)
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
          <span key={id} className="inline-flex items-center gap-1.5 text-[11px] text-[color:var(--hal-alias-label-secondary)] fade-in">
            <span className="typing-dot w-1 h-1 rounded-full bg-[color:var(--hal-alias-state-business-primary)] inline-block" />
            {info.name} {t('typing')}
          </span>
        ))}
        {chat.swarmRound ? (
          <span className="text-[11px] text-[color:var(--hal-alias-label-tertiary)] ml-auto font-mono">
            {t('round_label')} {chat.swarmRound.round}/{chat.swarmRound.maxRounds}
          </span>
        ) : null}
      </div>

      {/* the card — DSH radius-panel surface */}
      <div
        className="relative flex flex-col gap-2 pt-2"
        style={{
          borderRadius: 'var(--hal-radius-panel)',
          background: 'var(--hal-specific-input-major)',
          boxShadow: focused ? 'var(--hal-elevation-prominent)' : 'var(--hal-elevation-soft)',
          transition: 'box-shadow 150ms ease',
        }}
      >
        {/* input row */}
        <div className="relative">
          {text ? null : (
            <div
              className="absolute left-[22px] right-4 top-[10px] text-[color:var(--hal-alias-label-caption)] pointer-events-none truncate"
              style={{ fontSize: 'var(--hal-content-font-size, 14px)', lineHeight: 'calc(24px + var(--hal-content-font-delta, 0px))' }}
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
              fontFamily: 'var(--hal-font-family)',
              fontSize: 'var(--hal-content-font-size, 14px)',
              lineHeight: 'calc(24px + var(--hal-content-font-delta, 0px))',
              caretColor: 'var(--hal-alias-state-business-primary)',
            }}
            rows={1}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // IME composition (Windows Vietnamese Telex, CJK…): the Enter
              // that COMMITS the candidate must not send the message.
              if (e.nativeEvent.isComposing) return
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                // Enter with the mention popup open picks the first
                // suggestion instead of sending a raw "@Ri" that resolves
                // to nobody.
                if (suggestions.length > 0 && mentionStart !== null) {
                  applyMention(suggestions[0]!.name)
                  return
                }
                submit()
              }
            }}
          />
        </div>

        {/* tools row */}
        <div className="flex items-center gap-3 px-2 pb-2 min-w-0">
          {isAgent ? (
            <ModelPicker value={modelId || settings?.defaultModelId || ''} onChange={(id) => { setModelId(id); void loadSettings() }} />
          ) : (
            <span className="inline-flex items-center gap-1.5 h-7 px-2 rounded-sm text-[12px] font-medium text-[color:var(--hal-alias-label-secondary)] hover:bg-[var(--hal-alias-interactive-bg-hover)] cursor-default transition-colors duration-100">
              <AtSign size={12} className="text-[color:var(--hal-alias-state-business-primary)]" />
              {swarmConfig.agents.length} agents
              {swarmConfig.plannerCoordination ? <Badge color="#8d7fff">planner</Badge> : null}
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            {chat.running ? (
              <button
                className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] text-[color:var(--hal-alias-state-error-secondary)] hover:bg-[var(--hal-alias-interactive-bg-hover-danger)] cursor-pointer bg-transparent border-none transition-colors duration-100"
                onClick={() => void chat.stop()}
              >
                <Square size={10} /> {t('stop_turn')}
              </button>
            ) : null}
            <button
              onClick={chat.running ? () => void chat.stop() : submit}
              disabled={!chat.running && !text.trim()}
              className="shrink-0 w-[34px] h-[34px] rounded-full flex items-center justify-center cursor-pointer border-none text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-100"
              style={{ background: 'var(--hal-alias-button-info-fill)' }}
              onMouseEnter={(e) => { if (!e.currentTarget.disabled) e.currentTarget.style.background = 'var(--hal-alias-button-info-hover)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--hal-alias-button-info-fill)' }}
              aria-label={chat.running ? t('stop_turn') : t('send')}
            >
              {chat.running ? <Spinner size={14} className="text-white" /> : <ArrowUp size={16} />}
            </button>
          </div>
        </div>

        {/* @mention popup — DSH menu surface */}
        {suggestions.length > 0 && mentionStart !== null ? (
          <div
            className="hal-menu-surface absolute bottom-[calc(100%+6px)] left-2 rounded-lg overflow-hidden z-10 p-1 pop"
            style={{ boxShadow: 'var(--hal-elevation-prominent)' }}
          >
            {suggestions.map((a) => (
              <button
                key={a.id}
                className="flex items-center gap-2 min-h-[34px] px-2.5 rounded-md hover:bg-[var(--hal-alias-interactive-bg-hover)] w-full text-left cursor-pointer bg-transparent border-none transition-colors duration-100"
                onMouseDown={(e) => { e.preventDefault(); applyMention(a.name) }}
              >
                <span className="w-5 h-5 rounded-sm overflow-hidden shrink-0">
                  <AgentAvatar agent={a} size={20} className="rounded-sm" />
                </span>
                <span className="text-[13px] text-ink">{a.name}</span>
                <span className="text-[11px] text-[color:var(--hal-alias-label-tertiary)]">{a.roleId}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {chat.sendError ? (
        <div className="mt-1.5 mx-1 rounded-md border-[0.5px] border-[color:var(--hal-alias-state-error-secondary)] px-3 py-1.5 text-[12px] text-[color:var(--hal-alias-state-error-secondary)] flex items-center gap-2" style={{ background: 'var(--hal-alias-interactive-bg-hover-danger)' }}>
          <span className="flex-1">{t('send_failed')} — {chat.sendError}</span>
          <button
            className="text-[color:var(--hal-alias-label-tertiary)] hover:text-ink cursor-pointer bg-transparent border-none p-0 transition-colors duration-100"
            onClick={() => useChatStore.setState({ sendError: null })}
          >
            <X size={12} />
          </button>
        </div>
      ) : null}

      <div className="px-2 mt-1.5 text-[10.5px] text-[color:var(--hal-alias-label-caption)] flex items-center gap-2">
        <span>Enter ↵ {t('send')}</span>
        <span>·</span>
        <span>Shift+Enter ⏎</span>
        <span className="ml-auto inline-flex items-center gap-1">
          <span className="hal-kbd">Ctrl</span>
          <span className="hal-kbd">K</span>
          {t('palette_open')}
        </span>
      </div>
    </div>
  )
}
