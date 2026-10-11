/** Left rail: brand, mode switch, navigation, session list. */
import { useMemo, useState } from 'react'
import { Bot, Settings, Sparkles, Trash2, Users, Zap, ListChecks, Cpu, Search, X } from 'lucide-react'
import { useT } from '../../i18n'
import { useChatStore } from '../../stores/chat'
import { useAppStore } from '../../stores/app'
import { useSwarmStore } from '../../stores/swarm'
import { useTelegraphStore } from '../../stores/telegraph'
import { Badge } from '../ui'
import logoUrl from '../../assets/logo-64.png'

export type Route = 'chat' | 'swarm-setup' | 'models' | 'telegraph' | 'tasks' | 'settings'

export function Sidebar({ route, setRoute }: { route: Route; setRoute: (r: Route) => void }) {
  const t = useT()
  const chat = useChatStore()
  const settings = useAppStore((s) => s.settings)
  const swarmCount = useSwarmStore((s) => s.config.agents.filter((a) => a.enabled).length)
  const tgStatus = useTelegraphStore((s) => s.status)
  const [query, setQuery] = useState('')
  const [hoverDelete, setHoverDelete] = useState<string | null>(null)

  const navItems: Array<{ id: Route; icon: React.ReactNode; label: string; badge?: React.ReactNode }> = [
    { id: 'chat', icon: <Sparkles size={15} />, label: t('nav_chat') },
    { id: 'swarm-setup', icon: <Users size={15} />, label: t('nav_swarm_setup'), badge: swarmCount ? <Badge color="#45C4FF">{swarmCount}</Badge> : undefined },
    { id: 'models', icon: <Cpu size={15} />, label: t('nav_models') },
    ...(settings?.telegraphEnabled === false
      ? []
      : [{ id: 'telegraph' as Route, icon: <Zap size={15} />, label: t('nav_telegraph'), badge: tgStatus?.walletFunded ? <Badge color="#3ED598">●</Badge> : undefined }]),
    { id: 'tasks', icon: <ListChecks size={15} />, label: t('nav_tasks') },
    { id: 'settings', icon: <Settings size={15} />, label: t('nav_settings') },
  ]

  const chatMode = chat.activeMode

  const filteredSessions = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return chat.sessions
    return chat.sessions.filter((s) => s.title.toLowerCase().includes(q))
  }, [chat.sessions, query])

  return (
    <aside className="w-[236px] shrink-0 flex flex-col border-r border-line bg-panel">
      {/* brand */}
      <div className="px-4 pt-4 pb-3 flex items-center gap-2.5">
        <img src={logoUrl} alt="Halis Code" className="w-9 h-9 rounded-[10px] shadow-[0_4px_18px_-4px_rgba(69,165,255,0.5)]" draggable={false} />
        <div className="leading-tight min-w-0">
          <div className="font-semibold text-[14.5px] tracking-tight brand-gradient-text">Halis Code</div>
          <div className="text-[10px] text-faint">
            {t('beta_badge')} · {settings?.language === 'vi' ? 'Tiếng Việt' : 'English'}
          </div>
        </div>
      </div>

      {/* mode switch */}
      <div className="px-3 pt-1 pb-1">
        <div className="rounded-xl bg-panel2 border border-line p-1 flex relative">
          {(['agent', 'swarm'] as const).map((m) => {
            const active = route === 'chat' && chatMode === m
            return (
              <button
                key={m}
                onClick={() => {
                  const existing = chat.sessions.find((s) => s.mode === m)
                  if (existing) void chat.openSession(existing.id)
                  else void chat.newSession(m)
                  setRoute('chat')
                }}
                className={`relative flex-1 rounded-lg py-1.5 text-[12.5px] font-medium transition-all duration-200 cursor-pointer z-10 ${
                  active ? 'text-ink' : 'text-muted hover:text-ink'
                }`}
              >
                {active ? (
                  <span className="absolute inset-0 rounded-lg bg-gradient-to-r from-ember/25 to-signal/25 border border-signal/25" />
                ) : null}
                <span className="relative flex items-center justify-center gap-1.5">
                  {m === 'agent' ? <Bot size={12} className={active ? 'text-ember' : ''} /> : <Users size={12} className={active ? 'text-signal' : ''} />}
                  {m === 'agent' ? t('mode_agent') : t('mode_swarm')}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* nav */}
      <nav className="px-3 pt-2 pb-3 flex flex-col gap-0.5 border-b border-line">
        {navItems.map((item) => {
          const active = route === item.id
          return (
            <button
              key={item.id}
              onClick={() => setRoute(item.id)}
              className={`group relative flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg text-[13px] transition-colors duration-150 cursor-pointer ${
                active ? 'text-ink bg-panel2' : 'text-muted hover:text-ink hover:bg-panel2/60'
              }`}
            >
              <span
                className={`absolute left-0 top-1/2 -translate-y-1/2 w-[2px] rounded-full transition-all duration-200 ${
                  active ? 'h-4 bg-gradient-to-b from-ember to-signal' : 'h-0 bg-transparent'
                }`}
              />
              <span className={`transition-colors ${active ? 'text-signal' : 'text-faint group-hover:text-muted'}`}>{item.icon}</span>
              {item.label}
              {item.badge ? <span className="ml-auto">{item.badge}</span> : null}
            </button>
          )
        })}
      </nav>

      {/* sessions */}
      <div className="flex-1 overflow-y-auto px-3 py-2.5 min-h-0">
        <div className="flex items-center justify-between px-1.5 mb-1.5">
          <span className="text-[10.5px] uppercase tracking-wider text-faint font-medium">{t('sessions')}</span>
          <span className="text-[10.5px] text-faint">{chat.sessions.length}</span>
        </div>
        {chat.sessions.length > 3 ? (
          <div className="relative mb-1.5">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('search')}
              className="w-full rounded-lg bg-panel2 border border-line pl-7 pr-6 py-1.5 text-[11.5px] text-ink placeholder:text-faint outline-none focus:border-line2 transition-colors"
            />
            {query ? (
              <button className="absolute right-2 top-1/2 -translate-y-1/2 text-faint hover:text-muted cursor-pointer" onClick={() => setQuery('')}>
                <X size={11} />
              </button>
            ) : null}
          </div>
        ) : null}
        {filteredSessions.length === 0 ? (
          <div className="text-[12px] text-faint px-1.5 py-1">{query ? t('no_results') : t('no_sessions')}</div>
        ) : (
          filteredSessions.map((s) => {
            const active = chat.activeSessionId === s.id && route === 'chat'
            return (
              <div
                key={s.id}
                onMouseEnter={() => setHoverDelete(s.id)}
                onMouseLeave={() => setHoverDelete(null)}
                className={`group relative flex items-center gap-2 px-2.5 py-[7px] rounded-lg cursor-pointer mb-0.5 transition-colors duration-150 ${
                  active ? 'bg-panel2' : 'hover:bg-panel2/60'
                }`}
                onClick={() => {
                  void chat.openSession(s.id)
                  setRoute('chat')
                }}
              >
                <span
                  className={`absolute left-0 top-1/2 -translate-y-1/2 w-[2px] rounded-full transition-all duration-200 ${
                    active ? 'h-3.5 bg-gradient-to-b from-ember to-signal' : 'h-0'
                  }`}
                />
                <span className={`text-[11px] shrink-0 ${active ? '' : 'opacity-70'}`}>{s.mode === 'swarm' ? '🐝' : '✦'}</span>
                <span className={`text-[12.5px] truncate flex-1 ${active ? 'text-ink' : 'text-muted'}`}>{s.title}</span>
                {hoverDelete === s.id ? (
                  <button
                    className="text-faint hover:text-red cursor-pointer shrink-0 transition-colors"
                    onClick={(e) => {
                      e.stopPropagation()
                      void chat.deleteSession(s.id)
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                ) : null}
              </div>
            )
          })
        )}
      </div>

      <div className="px-4 py-3 border-t border-line text-[10px] text-faint leading-relaxed flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-good/80 inline-block shadow-[0_0_6px_rgba(62,213,152,0.6)]" />
        {settings?.telegraphEnabled === false ? 'local-first' : 'local-first · telegraph-ready'}
      </div>
    </aside>
  )
}
