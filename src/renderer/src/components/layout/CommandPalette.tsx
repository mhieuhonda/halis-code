/**
 * Command palette (Ctrl+K) — routes, sessions, quick model switch.
 * Skinned as a DSH frosted popup-select: menu surface material, 34px rows,
 * sticky group headers, shortcut chips.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Bot, Cpu, ListChecks, MessageSquarePlus, Search, Settings, Star, Users, Zap } from 'lucide-react'
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
      { id: 'chat', icon: <Bot size={14} />, label: t('nav_chat') },
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
      icon: <MessageSquarePlus size={14} className="text-[color:var(--dsw-alias-state-business-primary)]" />,
      group: t('sessions'),
      run: () => {
        void chat.newSession('agent')
        setRoute('chat')
      },
    })
    out.push({
      id: 'new-swarm-session',
      label: t('new_swarm_session'),
      icon: <Users size={14} className="text-[color:var(--dsw-alias-state-business-primary)]" />,
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
        icon: <span className="text-[color:var(--dsw-alias-label-tertiary)]">{item.icon}</span>,
        group: t('nav_go'),
        run: () => setRoute(item.id),
      })
    }
    for (const s of chat.sessions.slice(0, 8)) {
      out.push({
        id: `session-${s.id}`,
        label: s.title,
        hint: s.mode === 'swarm' ? t('mode_swarm') : t('mode_agent'),
        icon: <span className="text-[color:var(--dsw-alias-label-tertiary)]">{s.mode === 'swarm' ? <Users size={13} /> : <Bot size={13} />}</span>,
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
          icon: <Star size={13} className="text-[color:var(--dsw-alias-state-warn-primary)]" />,
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
    <div className="fixed inset-0 z-[70] flex items-start justify-center pt-[14vh] bg-[var(--dsw-alias-bg-mask-2)] modal-enter" onMouseDown={onClose}>
      <div
        className="dsh-menu-surface w-full max-w-[520px] rounded-lg overflow-hidden"
        style={{ boxShadow: 'var(--dsw-elevation-prominent)' }}
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
        <div className="flex items-center gap-2.5 px-4 h-12 border-b-[0.5px] border-[color:var(--dsw-alias-border-l2)]">
          <Search size={14} className="text-[color:var(--dsw-alias-label-tertiary)] shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('palette_placeholder')}
            className="flex-1 bg-transparent outline-none border-none text-[14px] text-ink placeholder:text-[color:var(--dsw-alias-label-dimmed)]"
          />
          <span className="dsh-kbd">esc</span>
        </div>
        <div ref={listRef} className="max-h-[340px] overflow-y-auto p-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-[13px] text-[color:var(--dsw-alias-label-tertiary)]">{t('no_results')}</div>
          ) : (
            grouped.map((g) => (
              <div key={`${g.group}-${g.items[0]!.idx}`}>
                <div className="px-2.5 pt-2 pb-1 text-[11px] leading-4 font-medium text-[color:var(--dsw-alias-label-tertiary)]">{g.group}</div>
                {g.items.map(({ cmd, idx }) => (
                  <button
                    key={cmd.id}
                    data-idx={idx}
                    className={`w-full flex items-center gap-2.5 min-h-[34px] px-2.5 rounded-md text-left cursor-pointer bg-transparent border-none transition-colors duration-100 ${
                      idx === selected ? 'bg-[var(--dsw-alias-interactive-bg-hover)]' : ''
                    }`}
                    onMouseEnter={() => setSelected(idx)}
                    onClick={() => {
                      cmd.run()
                      onClose()
                    }}
                  >
                    <span className="shrink-0">{cmd.icon}</span>
                    <span className="text-[13px] text-ink truncate flex-1">{cmd.label}</span>
                    {cmd.hint ? <span className="text-[11px] text-[color:var(--dsw-alias-label-caption)] font-mono shrink-0">{cmd.hint}</span> : null}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
        <div className="flex items-center gap-3 px-4 py-2 border-t-[0.5px] border-[color:var(--dsw-alias-border-l2)] text-[11px] text-[color:var(--dsw-alias-label-tertiary)]">
          <span>↑↓ {t('palette_navigate')}</span>
          <span>↵ {t('palette_run')}</span>
          <span className="ml-auto flex items-center gap-1">
            <span className="dsh-kbd">Ctrl</span>
            <span className="dsh-kbd">K</span>
          </span>
        </div>
      </div>
    </div>
  )
}
