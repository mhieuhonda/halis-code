/**
 * Command palette (Ctrl+K) — routes, sessions, quick model switch.
 * Inspired by opencode's searchable dialog-select.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Bot, Cpu, ListChecks, MessageSquarePlus, Search, Settings, Sparkles, Star, Users, Zap } from 'lucide-react'
import { useT } from '../../i18n'
import { useAppStore } from '../../stores/app'
import { useChatStore } from '../../stores/chat'
import type { Route } from './Sidebar'

interface Command {
  id: string
  label: string
  hint?: string
  icon: React.ReactNode
  group: string
  run: () => void
}

export function CommandPalette({ open, onClose, setRoute }: { open: boolean; onClose: () => void; setRoute: (r: Route) => void }) {
  const t = useT()
  const chat = useChatStore()
  const catalog = useAppStore((s) => s.catalog)
  const settings = useAppStore((s) => s.settings)
  const setSettings = useAppStore((s) => s.setSettings)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setSelected(0)
      setTimeout(() => inputRef.current?.focus(), 20)
    }
  }, [open])

  const commands = useMemo<Command[]>(() => {
    const nav: Array<{ id: Route; icon: React.ReactNode; label: string }> = [
      { id: 'chat', icon: <Sparkles size={14} />, label: t('nav_chat') },
      { id: 'swarm-setup', icon: <Users size={14} />, label: t('nav_swarm_setup') },
      { id: 'models', icon: <Cpu size={14} />, label: t('nav_models') },
      { id: 'telegraph', icon: <Zap size={14} />, label: t('nav_telegraph') },
      { id: 'tasks', icon: <ListChecks size={14} />, label: t('nav_tasks') },
      { id: 'settings', icon: <Settings size={14} />, label: t('nav_settings') },
    ]
    const out: Command[] = []

    out.push({
      id: 'new-agent-session',
      label: t('new_chat'),
      hint: 'Ctrl+N',
      icon: <MessageSquarePlus size={14} className="text-ember" />,
      group: t('sessions'),
      run: () => {
        void chat.newSession('agent')
        setRoute('chat')
      },
    })
    out.push({
      id: 'new-swarm-session',
      label: t('new_swarm_session'),
      icon: <Users size={14} className="text-signal" />,
      group: t('sessions'),
      run: () => {
        void chat.newSession('swarm')
        setRoute('chat')
      },
    })
    for (const item of nav) {
      out.push({
        id: `go-${item.id}`,
        label: item.label,
        icon: <span className="text-muted">{item.icon}</span>,
        group: t('nav_go'),
        run: () => setRoute(item.id),
      })
    }
    for (const s of chat.sessions.slice(0, 8)) {
      out.push({
        id: `session-${s.id}`,
        label: s.title,
        hint: s.mode === 'swarm' ? '🐝' : '✦',
        icon: <span className="text-faint text-[11px]">{s.mode === 'swarm' ? '🐝' : '✦'}</span>,
        group: t('sessions'),
        run: () => {
          void chat.openSession(s.id)
          setRoute('chat')
        },
      })
    }
    if (catalog) {
      const free = catalog.models.filter((m) => m.free).slice(0, 24)
      for (const m of free) {
        out.push({
          id: `model-${m.id}`,
          label: m.name,
          hint: catalog.providers.find((p) => p.id === m.providerId)?.name ?? m.providerId,
          icon: <Star size={13} className="text-amber" />,
          group: t('settings_default_model'),
          run: () => {
            void setSettings({ defaultModelId: m.id })
          },
        })
      }
    }
    return out
  }, [t, chat.sessions, catalog, settings?.defaultModelId, setRoute, chat, setSettings])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands.slice(0, 14)
    return commands.filter((c) => c.label.toLowerCase().includes(q) || c.group.toLowerCase().includes(q)).slice(0, 14)
  }, [commands, query])

  useEffect(() => {
    setSelected((prev) => Math.min(prev, Math.max(0, filtered.length - 1)))
  }, [filtered.length])

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${selected}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  if (!open) return null

  const grouped: Array<{ group: string; items: Array<{ cmd: Command; idx: number }> }> = []
  filtered.forEach((cmd, idx) => {
    const last = grouped[grouped.length - 1]
    if (last && last.group === cmd.group) last.items.push({ cmd, idx })
    else grouped.push({ group: cmd.group, items: [{ cmd, idx }] })
  })

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center pt-[14vh] bg-black/60 backdrop-blur-[3px] fade-in" onMouseDown={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl border border-line2 bg-panel shadow-[0_32px_90px_-16px_rgba(0,0,0,0.85)] overflow-hidden pop"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setSelected((s) => (s + 1) % Math.max(1, filtered.length))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setSelected((s) => (s - 1 + Math.max(1, filtered.length)) % Math.max(1, filtered.length))
          } else if (e.key === 'Enter') {
            e.preventDefault()
            const cmd = filtered[selected]
            if (cmd) {
              cmd.run()
              onClose()
            }
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          }
        }}
      >
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-line">
          <Search size={14} className="text-faint shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('palette_placeholder')}
            className="flex-1 bg-transparent outline-none text-[13.5px] text-ink placeholder:text-faint"
          />
          <kbd className="text-[10px] font-mono text-faint border border-line rounded px-1.5 py-0.5">esc</kbd>
        </div>
        <div ref={listRef} className="max-h-[320px] overflow-y-auto py-1.5">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-[12.5px] text-faint">{t('no_results')}</div>
          ) : (
            grouped.map((g) => (
              <div key={`${g.group}-${g.items[0].idx}`}>
                <div className="px-4 pt-2 pb-1 text-[10px] uppercase tracking-wider text-faint font-medium">{g.group}</div>
                {g.items.map(({ cmd, idx }) => (
                  <button
                    key={cmd.id}
                    data-idx={idx}
                    className={`w-full flex items-center gap-2.5 px-4 py-2 text-left cursor-pointer transition-colors ${
                      idx === selected ? 'bg-panel3' : 'hover:bg-panel2'
                    }`}
                    onMouseEnter={() => setSelected(idx)}
                    onClick={() => {
                      cmd.run()
                      onClose()
                    }}
                  >
                    <span className="shrink-0">{cmd.icon}</span>
                    <span className="text-[13px] text-ink truncate flex-1">{cmd.label}</span>
                    {cmd.hint ? <span className="text-[10.5px] text-faint font-mono shrink-0">{cmd.hint}</span> : null}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
        <div className="flex items-center gap-3 px-4 py-2 border-t border-line text-[10.5px] text-faint">
          <span>↑↓ {t('palette_navigate')}</span>
          <span>↵ {t('palette_run')}</span>
          <span className="ml-auto font-mono">Halis</span>
        </div>
      </div>
    </div>
  )
}
