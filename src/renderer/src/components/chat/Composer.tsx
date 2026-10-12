/** Composer: textarea + send/stop + model picker (agent mode) + mentions (swarm). */
import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Square, AtSign } from 'lucide-react'
import { useT } from '../../i18n'
import { Badge, Select, Spinner } from '../ui'
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
    <div className="flex items-center gap-1.5 min-w-0">
      <Select value={group} onChange={(e) => setGroup(e.target.value)} className="!w-auto !py-1 !text-[11px] !px-2 !rounded-lg">
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.label}
          </option>
        ))}
      </Select>
      <Select value={value} onChange={(e) => onChange(e.target.value)} className="!w-auto !py-1 !text-[11px] !px-2 max-w-[240px] !rounded-lg" title={value}>
        {listed.map((m) => (
          <option key={m.id} value={m.id}>
            {m.providerId !== 'pollinations' ? `${catalog.providers.find((p) => p.id === m.providerId)?.name ?? m.providerId} · ` : ''}
            {m.name}
            {m.free ? ' ✦' : ''}
          </option>
        ))}
      </Select>
      {current?.free ? <Badge color="#3ED598">free</Badge> : null}
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
    ta.style.height = `${Math.min(ta.scrollHeight, 180)}px`
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
    <div className="px-5 pb-4 pt-1.5">
      {/* typing indicators (swarm) */}
      <div className="h-5 flex items-center gap-3 mb-1.5 px-1">
        {Object.entries(chat.typing).map(([id, info]) => (
          <span key={id} className="inline-flex items-center gap-1.5 text-[11px] text-cyan fade-in">
            <span className="typing-dot w-1 h-1 rounded-full bg-cyan inline-block" />
            {info.name} {t('typing')}
          </span>
        ))}
        {chat.swarmRound ? (
          <span className="text-[11px] text-faint ml-auto font-mono">
            {t('round_label')} {chat.swarmRound.round}/{chat.swarmRound.maxRounds}
          </span>
        ) : null}
      </div>

      {/* the composer — gradient ring on focus */}
      <div
        className={`rounded-2xl border bg-panel2/90 backdrop-blur transition-all duration-200 shadow-[0_12px_44px_-12px_rgba(0,0,0,0.6)] ${
          focused ? 'border-transparent shadow-[0_0_0_1px_rgba(69,165,255,0.35),0_0_28px_-6px_rgba(69,165,255,0.25),0_12px_44px_-12px_rgba(0,0,0,0.6)]' : 'border-line'
        }`}
      >
        <div className="flex items-center gap-2 px-3 pt-2.5 pb-2 border-b border-line/70">
          {isAgent ? (
            <ModelPicker value={modelId || settings?.defaultModelId || 'pollinations/openai-fast'} onChange={(id) => { setModelId(id); void loadSettings() }} />
          ) : (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-muted">
              <AtSign size={12} className="text-signal" />
              {swarmConfig.agents.length} agents
              {swarmConfig.plannerCoordination ? <Badge color="#8D7FFF">planner</Badge> : null}
            </span>
          )}
          {chat.running ? (
            <button
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-red/30 bg-red/10 px-2.5 py-1 text-[11.5px] text-red hover:bg-red/20 transition-colors cursor-pointer"
              onClick={() => void chat.stop()}
            >
              <Square size={10} /> {t('stop_turn')}
            </button>
          ) : null}
        </div>
        <div className="flex items-end gap-3 px-3.5 py-3 relative">
          <span className="absolute left-0 top-3 bottom-3 w-[2px] rounded-full bg-gradient-to-b from-ember to-signal opacity-40" />
          <textarea
            ref={taRef}
            value={text}
            placeholder={isAgent ? t('placeholder_agent') : t('placeholder_swarm')}
            className="flex-1 bg-transparent outline-none resize-none text-[13.5px] leading-relaxed placeholder:text-faint max-h-[180px] selectable pl-2"
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
          <button
            onClick={submit}
            disabled={!text.trim() || chat.running}
            className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-200 cursor-pointer disabled:cursor-not-allowed ${
              text.trim() && !chat.running
                ? 'bg-gradient-to-br from-ember to-signal text-white shadow-[0_4px_16px_-2px_rgba(69,165,255,0.5)] hover:brightness-110 active:scale-95'
                : 'bg-panel3 text-faint border border-line'
            }`}
          >
            {chat.running ? <Spinner size={13} className="text-muted" /> : <ArrowUp size={15} />}
          </button>

          {suggestions.length > 0 && mentionStart !== null ? (
            <div className="absolute bottom-[calc(100%+6px)] left-2 rounded-xl border border-line2 bg-panel shadow-[0_16px_50px_-10px_rgba(0,0,0,0.8)] overflow-hidden pop z-10">
              {suggestions.map((a) => (
                <button key={a.id} className="flex items-center gap-2 px-3 py-2 hover:bg-panel3 w-full text-left cursor-pointer transition-colors" onMouseDown={(e) => { e.preventDefault(); applyMention(a.name) }}>
                  <span>{a.avatar}</span>
                  <span className="text-[13px]">{a.name}</span>
                  <span className="text-[11px] text-faint">{a.roleId}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <div className="px-1.5 mt-1.5 text-[10.5px] text-faint flex items-center gap-2">
        <span>Enter ↵ {t('send')}</span>
        <span className="text-line2">·</span>
        <span>Shift+Enter ⏎</span>
        <span className="ml-auto inline-flex items-center gap-1">
          <kbd className="font-mono border border-line rounded px-1 py-px text-[9.5px]">Ctrl K</kbd>
          {t('palette_open')}
        </span>
      </div>
    </div>
  )
}
