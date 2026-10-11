/** Composer: textarea + send/stop + model picker (agent mode) + mentions (swarm). */
import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Square, ChevronDown, AtSign } from 'lucide-react'
import { useT } from '../../i18n'
import { Badge, Button, Select } from '../ui'
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

  return (
    <div className="flex items-center gap-2">
      <Select value={group} onChange={(e) => setGroup(e.target.value)} className="!w-auto !py-1.5 !text-xs !px-2">
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.label}
          </option>
        ))}
      </Select>
      <Select value={value} onChange={(e) => onChange(e.target.value)} className="!w-auto !py-1.5 !text-xs !px-2 max-w-[280px]" title={value}>
        {models.slice(0, 300).map((m) => (
          <option key={m.id} value={m.id}>
            {m.providerId !== 'pollinations' ? `${catalog.providers.find((p) => p.id === m.providerId)?.name ?? m.providerId} · ` : ''}
            {m.name}
            {m.free ? ' ✦' : ''}
          </option>
        ))}
      </Select>
      {current?.free ? <Badge color="#4ADE80">free</Badge> : null}
      <ChevronDown size={12} className="text-faint -ml-4 pointer-events-none" />
    </div>
  )
}

export function Composer() {
  const t = useT()
  const [text, setText] = useState('')
  const [modelId, setModelId] = useState<string>('')
  const [mentionOpen, setMentionOpen] = useState(false)
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
    return match ? match[1].toLowerCase() : null
  })()

  const suggestions = mentionStart !== null ? swarmConfig.agents.filter((a) => a.name.toLowerCase().includes(mentionStart) && mentionStart !== a.name.toLowerCase()).slice(0, 5) : []

  const applyMention = (name: string) => {
    setText((prev) => prev.replace(/@([A-Za-z0-9_.-]*)$/, `@${name} `))
    taRef.current?.focus()
    setMentionOpen(false)
  }

  return (
    <div className="px-5 pb-4 pt-1">
      {/* typing indicators (swarm) */}
      <div className="h-5 flex items-center gap-3 mb-1.5 px-1">
        {Object.entries(chat.typing).map(([id, info]) => (
          <span key={id} className="inline-flex items-center gap-1.5 text-[11px] text-cyan">
            <span className="typing-dot w-1 h-1 rounded-full bg-cyan inline-block" />
            {info.name} {t('typing')}
          </span>
        ))}
        {chat.swarmRound ? (
          <span className="text-[11px] text-faint ml-auto">
            {t('round_label')} {chat.swarmRound.round}/{chat.swarmRound.maxRounds}
          </span>
        ) : null}
      </div>

      <div className="rounded-2xl border border-line bg-panel2 focus-within:border-accent/50 transition-colors shadow-[0_8px_32px_rgba(0,0,0,0.35)]">
        <div className="flex items-center gap-2 px-3.5 pt-2.5 border-b border-line/60 pb-2">
          {chat.activeMode === 'agent' ? (
            <ModelPicker value={modelId || settings?.defaultModelId || 'pollinations/openai-fast'} onChange={(id) => { setModelId(id); void loadSettings() }} />
          ) : (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-muted">
              <AtSign size={12} />
              {swarmConfig.agents.length} agents
              {swarmConfig.plannerCoordination ? <Badge color="#7C6CFF">planner</Badge> : null}
            </span>
          )}
          {chat.running ? (
            <Button variant="danger" size="sm" className="ml-auto" onClick={() => void chat.stop()}>
              <Square size={11} /> {t('stop_turn')}
            </Button>
          ) : null}
        </div>
        <div className="flex items-end gap-3 px-3.5 py-3 relative">
          <textarea
            ref={taRef}
            value={text}
            placeholder={chat.activeMode === 'agent' ? t('placeholder_agent') : t('placeholder_swarm')}
            className="flex-1 bg-transparent outline-none resize-none text-[13.5px] leading-relaxed placeholder:text-faint max-h-[180px] selectable"
            rows={1}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
          />
          <Button variant="primary" onClick={submit} disabled={!text.trim() || chat.running} className="!rounded-xl !p-2.5">
            <ArrowUp size={15} />
          </Button>

          {suggestions.length > 0 && mentionStart !== null ? (
            <div className="absolute bottom-[calc(100%+6px)] left-2 rounded-xl border border-line bg-panel shadow-xl overflow-hidden fade-up z-10">
              {suggestions.map((a) => (
                <button key={a.id} className="flex items-center gap-2 px-3 py-2 hover:bg-panel3 w-full text-left cursor-pointer" onMouseDown={(e) => { e.preventDefault(); applyMention(a.name) }}>
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
        <span>·</span>
        <span>Shift+Enter ⏎</span>
      </div>
    </div>
  )
}
