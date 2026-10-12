/** Sidebar — DeepSeek Harness desktop structure: logo row, new-chat bar,
 *  mode segments, panel rows, session list, footer. Drag-resizable. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bot, Cpu, ListChecks, PanelLeft, Plus, Search, Settings, Trash2, Users, X, Zap } from 'lucide-react'
import { useT } from '../../i18n'
import { useChatStore } from '../../stores/chat'
import { useAppStore } from '../../stores/app'
import { useSwarmStore } from '../../stores/swarm'
import { useTelegraphStore } from '../../stores/telegraph'
import logoUrl from '../../assets/logo.png'
import nameUrl from '../../assets/name.png'

export type Route = 'chat' | 'swarm-setup' | 'models' | 'telegraph' | 'tasks' | 'settings'

const SIDEBAR_MIN = 264
const SIDEBAR_MAX = 420
const SIDEBAR_DEFAULT = 280
const COLLAPSE_KEY = 'halis.sidebar.collapsed'
const WIDTH_KEY = 'halis.sidebar.width'

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'now'
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d`
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function Sidebar({ route, setRoute }: { route: Route; setRoute: (r: Route) => void }) {
  const t = useT()
  const chat = useChatStore()
  const settings = useAppStore((s) => s.settings)
  const swarmCount = useSwarmStore((s) => s.config.agents.filter((a) => a.enabled).length)
  const tgStatus = useTelegraphStore((s) => s.status)
  const [query, setQuery] = useState('')
  const [width, setWidth] = useState(() => {
    const n = Number(localStorage.getItem(WIDTH_KEY))
    return Number.isFinite(n) && n >= SIDEBAR_MIN && n <= SIDEBAR_MAX ? n : SIDEBAR_DEFAULT
  })
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1')
  const [animating, setAnimating] = useState(false)
  const [dragging, setDragging] = useState(false)
  const animTimer = useRef<number | undefined>(undefined)

  const toggleCollapse = useCallback(() => {
    setAnimating(true)
    setCollapsed((v) => {
      localStorage.setItem(COLLAPSE_KEY, v ? '0' : '1')
      return !v
    })
    window.clearTimeout(animTimer.current)
    animTimer.current = window.setTimeout(() => setAnimating(false), 320)
  }, [])

  // Sidebar drag resize (DSH col-resize handle)
  const onHandleDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      const startX = e.clientX
      const startW = width
      setDragging(true)
      const onMove = (ev: PointerEvent) => {
        const next = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startW + (ev.clientX - startX)))
        setWidth(next)
      }
      const onUp = () => {
        setDragging(false)
        localStorage.setItem(WIDTH_KEY, String(width))
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [width],
  )

  useEffect(() => () => window.clearTimeout(animTimer.current), [])

  const isMac = navigator.userAgent.includes('Mac')

  const navItems: Array<{ id: Route; icon: React.ReactNode; label: string; badge?: React.ReactNode }> = [
    { id: 'chat', icon: <Bot size={16} />, label: t('nav_chat') },
    { id: 'swarm-setup', icon: <Users size={16} />, label: t('nav_swarm_setup'), badge: swarmCount ? <Badge count={swarmCount} /> : undefined },
    { id: 'models', icon: <Cpu size={16} />, label: t('nav_models') },
    ...(settings?.telegraphEnabled === false
      ? []
      : [{ id: 'telegraph' as Route, icon: <Zap size={16} />, label: t('nav_telegraph'), badge: tgStatus?.walletFunded ? <DotBadge /> : undefined }]),
    { id: 'tasks', icon: <ListChecks size={16} />, label: t('nav_tasks') },
    { id: 'settings', icon: <Settings size={16} />, label: t('nav_settings') },
  ]

  const chatMode = chat.activeMode
  const modeActive = (m: 'agent' | 'swarm') => route === 'chat' && chatMode === m
  const modeIndex = modeActive('swarm') ? 1 : 0

  const filteredSessions = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return chat.sessions
    return chat.sessions.filter((s) => s.title.toLowerCase().includes(q))
  }, [chat.sessions, query])

  return (
    <aside
      className="relative h-full shrink-0 overflow-hidden"
      style={{ width: collapsed ? 0 : width, transition: animating ? `width var(--ds-transition-duration-slow) var(--ds-ease-in-out)` : 'none' }}
    >
      <div className="dsh-sidebar h-full flex flex-col box-border px-3 pt-1.5 pb-1.5 overflow-hidden" style={{ width }}>
        {/* macOS drag strip under the traffic lights */}
        <div className="dsh-topstrip" />

        {/* logo row: new brand mark + wordmark, panel toggle */}
        <div className="flex-none flex items-center justify-between h-[56px] pl-1">
          <button
            className="flex items-center gap-2 min-w-0 overflow-hidden cursor-default bg-transparent border-none p-0"
            style={{ color: 'inherit' }}
            aria-label="Halis Code"
          >
            <img src={logoUrl} alt="Halis Code" className="brand-img w-6 h-6" draggable={false} />
            <img src={nameUrl} alt="" className="brand-img h-[22px] w-auto" draggable={false} />
          </button>
          <button className="dsh-iconbtn" onClick={toggleCollapse} aria-label="Toggle sidebar">
            <PanelLeft size={15} />
          </button>
        </div>

        {/* new session bar */}
        <button
          className="group relative flex-none flex items-center h-[38px] mx-0.5 mb-3 px-3 box-border rounded-md border-[0.5px] border-[color:var(--dsw-alias-border-l3)] bg-[var(--dsw-alias-button-elevated-fill)] text-ink text-[13px] font-medium cursor-pointer overflow-hidden hover:bg-[var(--dsw-alias-button-floating-hover)] transition-colors duration-100"
          onClick={() => {
            void chat.newSession(chatMode)
            setRoute('chat')
          }}
        >
          <span className="flex items-center justify-center w-full gap-1.5">
            <Plus size={15} className="shrink-0" />
            <span className="truncate">{t('new_chat')}</span>
            <span className="ml-auto hidden group-hover:flex items-center gap-1 opacity-80 shrink-0">
              <span className="dsh-kbd">{isMac ? '⌘' : 'Ctrl'}</span>
              <span className="dsh-kbd">N</span>
            </span>
          </span>
        </button>

        {/* mode switch — DSH segmented control */}
        <div className="flex-none relative flex rounded-md p-1 gap-0.5 mb-2 bg-[var(--dsw-alias-interactive-bg-hover)]">
          <span
            className="absolute top-1 bottom-1 rounded-sm bg-[var(--dsw-alias-bg-layer-1)]"
            style={{
              width: 'calc(50% - 4px)',
              left: 'calc(4px + ' + modeIndex * 100 + '% + ' + modeIndex * 2 + 'px)',
              boxShadow: 'var(--dsw-elevation-soft)',
              transition: 'transform 160ms ease, left 160ms ease',
              transform: 'translateX(0)',
            }}
          />
          {(['agent', 'swarm'] as const).map((m) => (
            <button
              key={m}
              onClick={() => {
                const existing = chat.sessions.find((s) => s.mode === m)
                if (existing) void chat.openSession(existing.id)
                else void chat.newSession(m)
                setRoute('chat')
              }}
              className={`relative z-10 flex-1 h-7 rounded-sm text-[13px] font-medium cursor-pointer bg-transparent border-none transition-colors duration-100 ${
                modeActive(m) ? 'text-ink' : 'text-[color:var(--dsw-alias-label-tertiary)] hover:text-ink'
              }`}
            >
              <span className="flex items-center justify-center gap-1.5">
                {m === 'agent' ? <Bot size={13} /> : <Users size={13} />}
                {m === 'agent' ? t('mode_agent') : t('mode_swarm')}
              </span>
            </button>
          ))}
        </div>

        {/* panel nav rows */}
        <nav className="flex-none flex flex-col gap-1 mb-2">
          {navItems.map((item) => {
            const active = route === item.id
            return (
              <button
                key={item.id}
                onClick={() => setRoute(item.id)}
                className={`flex items-center gap-2 mx-0.5 min-h-9 px-2 rounded-md text-[13px] leading-[22px] text-left cursor-pointer bg-transparent border-none transition-colors duration-100 ${
                  active
                    ? 'text-ink bg-[var(--dsw-specific-sidebar-nav-item-active)]'
                    : 'text-ink hover:bg-[var(--dsw-specific-sidebar-nav-item-hover)]'
                }`}
              >
                <span className={active ? 'text-[color:var(--dsw-alias-state-business-primary)]' : 'text-[color:var(--dsw-alias-label-tertiary)]'}>{item.icon}</span>
                <span className="flex-1 truncate">{item.label}</span>
                {item.badge ? <span className="flex-none">{item.badge}</span> : null}
              </button>
            )
          })}
        </nav>

        {/* sessions */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <div className="flex-none flex items-center justify-between pl-2 pr-1 mb-1">
            <span className="text-[11px] font-medium text-[color:var(--dsw-alias-label-tertiary)]">{t('sessions')}</span>
            <span className="text-[10px] text-[color:var(--dsw-alias-label-caption)] font-mono">{chat.sessions.length}</span>
          </div>
          {chat.sessions.length > 3 ? (
            <div className="flex-none relative mb-1.5 mx-0.5">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[color:var(--dsw-alias-label-tertiary)]" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('search')}
                className="w-full h-7 rounded-md bg-transparent border-[0.5px] border-[color:var(--dsw-alias-border-l4)] pl-7 pr-6 text-[12px] text-ink placeholder:text-[color:var(--dsw-alias-label-dimmed)] outline-none focus:border-[color:var(--dsw-alias-border-l4)] focus:bg-[var(--dsw-alias-bg-layer-1)] transition-colors duration-100"
              />
              {query ? (
                <button
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[color:var(--dsw-alias-label-tertiary)] hover:text-ink cursor-pointer bg-transparent border-none p-0"
                  onClick={() => setQuery('')}
                >
                  <X size={11} />
                </button>
              ) : null}
            </div>
          ) : null}
          <div className="flex-1 min-h-0 overflow-y-auto -mx-1 px-1">
            {filteredSessions.length === 0 ? (
              <div className="text-[12px] text-[color:var(--dsw-alias-label-tertiary)] px-2 py-1">{query ? t('no_results') : t('no_sessions')}</div>
            ) : (
              filteredSessions.map((s) => {
                const active = chat.activeSessionId === s.id && route === 'chat'
                return (
                  <div
                    key={s.id}
                    className={`group flex items-center gap-2 h-8 px-2 mb-0.5 rounded-md cursor-pointer transition-colors duration-100 ${
                      active ? 'bg-[var(--dsw-alias-interactive-bg-hover)]' : 'hover:bg-[var(--dsw-specific-sidebar-nav-item-hover)]'
                    }`}
                    onClick={() => {
                      void chat.openSession(s.id)
                      setRoute('chat')
                    }}
                  >
                    <span className={active ? 'text-[color:var(--dsw-alias-state-business-primary)]' : 'text-[color:var(--dsw-alias-label-tertiary)]'}>
                      {s.mode === 'swarm' ? <Users size={12} /> : <Bot size={12} />}
                    </span>
                    <span className="flex-1 text-[13px] leading-5 truncate text-ink">{s.title}</span>
                    <span className="group-hover:hidden text-[10px] leading-4 text-[color:var(--dsw-alias-label-tertiary)]">{relativeTime(s.updatedAt)}</span>
                    <button
                      className="hidden group-hover:inline-flex text-[color:var(--dsw-alias-label-tertiary)] hover:text-[color:var(--dsw-alias-state-error-primary)] cursor-pointer bg-transparent border-none p-0"
                      onClick={(e) => {
                        e.stopPropagation()
                        void chat.deleteSession(s.id)
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* footer */}
        <div className="flex-none flex items-center gap-1.5 px-2 pt-2 pb-1 text-[10px] text-[color:var(--dsw-alias-label-caption)]">
          <span className="w-1.5 h-1.5 rounded-full bg-[color:var(--dsw-alias-state-success-primary)] inline-block" />
          {settings?.telegraphEnabled === false ? 'local-first' : 'local-first · telegraph-ready'}
        </div>
      </div>

      {/* drag handle */}
      {!collapsed && (
        <div
          className="absolute top-0 bottom-0 -right-1 w-2 z-20"
          style={{ cursor: 'col-resize', touchAction: 'none' }}
          onPointerDown={onHandleDown}
        />
      )}
      {/* right hairline */}
      {!collapsed && <div className="absolute top-0 bottom-0 right-0 w-[0.5px] pointer-events-none bg-[color:var(--dsw-alias-border-l3)]" />}
    </aside>
  )
}

function Badge({ count }: { count: number }) {
  return (
    <span
      className="inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full text-[10px] font-medium leading-none"
      style={{ background: 'var(--dsw-alias-state-business-tertiary)', color: 'var(--dsw-alias-state-business-primary)' }}
    >
      {count}
    </span>
  )
}

function DotBadge() {
  return <span className="w-1.5 h-1.5 rounded-full bg-[color:var(--dsw-alias-state-success-primary)] inline-block" />
}
