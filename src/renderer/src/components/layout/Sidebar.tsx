/** Left sidebar: brand, mode switch, navigation, session list. */
import { useState } from 'react'
import { Bot, Settings, Sparkles, Trash2, Users, Zap, ListChecks, Cpu } from 'lucide-react'
import { useT } from '../../i18n'
import { useChatStore } from '../../stores/chat'
import { useAppStore } from '../../stores/app'
import { useSwarmStore } from '../../stores/swarm'
import { useTelegraphStore } from '../../stores/telegraph'
import { Badge } from '../ui'

export type Route = 'chat' | 'swarm-setup' | 'models' | 'telegraph' | 'tasks' | 'settings'

export function Sidebar({ route, setRoute }: { route: Route; setRoute: (r: Route) => void }) {
  const t = useT()
  const chat = useChatStore()
  const settings = useAppStore((s) => s.settings)
  const swarmCount = useSwarmStore((s) => s.config.agents.filter((a) => a.enabled).length)
  const tgStatus = useTelegraphStore((s) => s.status)
  const [hoverDelete, setHoverDelete] = useState<string | null>(null)

  const navItems: Array<{ id: Route; icon: React.ReactNode; label: string; badge?: React.ReactNode }> = [
    { id: 'chat', icon: <Sparkles size={15} />, label: t('nav_chat') },
    { id: 'swarm-setup', icon: <Users size={15} />, label: t('nav_swarm_setup'), badge: swarmCount ? <Badge color="#22D3EE">{swarmCount}</Badge> : undefined },
    { id: 'models', icon: <Cpu size={15} />, label: t('nav_models') },
    { id: 'telegraph', icon: <Zap size={15} />, label: t('nav_telegraph'), badge: tgStatus?.walletFunded ? <Badge color="#4ADE80">●</Badge> : undefined },
    { id: 'tasks', icon: <ListChecks size={15} />, label: t('nav_tasks') },
    { id: 'settings', icon: <Settings size={15} />, label: t('nav_settings') },
  ]

  const chatMode = chat.activeMode

  return (
    <aside className="w-[248px] shrink-0 flex flex-col border-r border-line bg-panel">
      {/* brand */}
      <div className="px-4 py-4 flex items-center gap-2.5 border-b border-line">
        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-accent to-cyan flex items-center justify-center text-white shadow-[0_4px_16px_rgba(124,108,255,0.4)]">
          <Bot size={17} />
        </div>
        <div className="leading-tight">
          <div className="font-semibold text-[14.5px] tracking-tight">{t('app_name')}</div>
          <div className="text-[10px] text-faint">
            {t('beta_badge')} · {settings?.language === 'vi' ? 'Tiếng Việt' : 'English'}
          </div>
        </div>
      </div>

      {/* mode switch */}
      <div className="px-3 pt-3">
        <div className="rounded-xl bg-panel2 border border-line p-1 flex">
          {(['agent', 'swarm'] as const).map((m) => (
            <button
              key={m}
              onClick={() => {
                const existing = chat.sessions.find((s) => s.mode === m)
                if (existing) void chat.openSession(existing.id)
                else void chat.newSession(m)
                setRoute('chat')
              }}
              className={`flex-1 rounded-lg py-1.5 text-[12.5px] font-medium transition-colors cursor-pointer ${
                route === 'chat' && chatMode === m ? 'bg-accent text-white' : 'text-muted hover:text-ink'
              }`}
            >
              {m === 'agent' ? t('mode_agent') : t('mode_swarm')}
            </button>
          ))}
        </div>
      </div>

      {/* nav */}
      <nav className="px-3 py-3 flex flex-col gap-0.5 border-b border-line">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setRoute(item.id)}
            className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] transition-colors cursor-pointer ${
              route === item.id ? 'bg-panel3 text-ink' : 'text-muted hover:text-ink hover:bg-panel2'
            }`}
          >
            <span className={route === item.id ? 'text-accent' : ''}>{item.icon}</span>
            {item.label}
            {item.badge ? <span className="ml-auto">{item.badge}</span> : null}
          </button>
        ))}
      </nav>

      {/* sessions */}
      <div className="flex-1 overflow-y-auto px-3 py-2 min-h-0">
        <div className="flex items-center justify-between px-1.5 mb-1.5">
          <span className="text-[10.5px] uppercase tracking-wider text-faint font-medium">{t('sessions')}</span>
          <span className="text-[10.5px] text-faint">{chat.sessions.length}</span>
        </div>
        {chat.sessions.length === 0 ? (
          <div className="text-[12px] text-faint px-1.5">{t('no_sessions')}</div>
        ) : (
          chat.sessions.map((s) => (
            <div
              key={s.id}
              onMouseEnter={() => setHoverDelete(s.id)}
              onMouseLeave={() => setHoverDelete(null)}
              className={`group flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer mb-0.5 transition-colors ${
                chat.activeSessionId === s.id && route === 'chat' ? 'bg-panel3' : 'hover:bg-panel2'
              }`}
              onClick={() => {
                void chat.openSession(s.id)
                setRoute('chat')
              }}
            >
              <span className="text-[11px]">{s.mode === 'swarm' ? '🐝' : '✦'}</span>
              <span className={`text-[12.5px] truncate flex-1 ${chat.activeSessionId === s.id ? 'text-ink' : 'text-muted'}`}>{s.title}</span>
              {hoverDelete === s.id ? (
                <button
                  className="text-faint hover:text-red cursor-pointer shrink-0"
                  onClick={(e) => {
                    e.stopPropagation()
                    void chat.deleteSession(s.id)
                  }}
                >
                  <Trash2 size={12} />
                </button>
              ) : null}
            </div>
          ))
        )}
      </div>

      <div className="px-4 py-3 border-t border-line text-[10px] text-faint leading-relaxed">
        local-first · telegraph-ready
      </div>
    </aside>
  )
}
