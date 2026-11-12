/**
 * App shell — desktop layout adapted to the phone: a 36px titlebar on the
 * deep chrome, the session/workspace panel below it, and the sidebar as a
 * slide-in drawer. No bottom tab bar; every surface is one of the desktop
 * app's floating rounded panels.
 */
import { useEffect, useState } from 'react'
import { PanelLeft, Settings as SettingsIcon, SquarePen } from 'lucide-react'
import logoUrl from './assets/logo.png'
import { bridge } from './ui/lib/bridge'
import { useAppStore } from './ui/stores/app'
import { useChatStore } from './ui/stores/chat'
import { Splash } from './ui/components/Splash'
import { ToastHost } from './ui/components/ui'
import { Sidebar } from './ui/components/Sidebar'
import { ChatScreen } from './ui/components/chat/ChatScreen'
import { SwarmScreen } from './ui/components/SwarmScreen'
import { TelegraphScreen } from './ui/components/TelegraphScreen'
import { BoardScreen } from './ui/components/BoardScreen'
import { SettingsScreen } from './ui/components/SettingsScreen'
import { useT } from './ui/i18n'

export type Route = 'chat' | 'swarm' | 'telegraph' | 'board' | 'settings'

let routeSeq = 0

export default function App() {
  const [booted, setBooted] = useState(false)
  const [route, setRoute] = useState<Route>('chat')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const t = useT()
  const loadSettings = useAppStore((s) => s.loadSettings)
  const loadCatalog = useAppStore((s) => s.loadCatalog)
  const loadKeyStatus = useAppStore((s) => s.loadKeyStatus)
  const initChat = useChatStore((s) => s.init)
  const loadSessions = useChatStore((s) => s.loadSessions)
  const approvals = useChatStore((s) => s.approvals)
  const runningSessions = useChatStore((s) => s.runningSessions)
  const activeSession = useChatStore((s) => s.sessions.find((x) => x.id === s.activeSessionId))
  const activeMode = useChatStore((s) => s.activeMode)
  const newSession = useChatStore((s) => s.newSession)

  useEffect(() => {
    let alive = true
    void (async () => {
      await bridge.boot()
      if (!alive) return
      initChat()
      await Promise.all([loadSettings(), loadCatalog(), loadKeyStatus(), loadSessions()])
      if (alive) setBooted(true)
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The hardware back button pops the drawer first (main.tsx drives history).
  useEffect(() => {
    if (drawerOpen) {
      window.history.pushState({ drawer: ++routeSeq }, '')
      const onPop = () => setDrawerOpen(false)
      window.addEventListener('popstate', onPop)
      return () => window.removeEventListener('popstate', onPop)
    }
  }, [drawerOpen])

  if (!booted) return <Splash />

  const pageTitle =
    route === 'chat'
      ? (activeSession?.title ?? (activeMode === 'swarm' ? t('new_swarm_session') : t('new_chat')))
      : route === 'swarm'
        ? t('swarm_setup_title')
        : route === 'telegraph'
          ? t('nav_telegraph')
          : route === 'board'
            ? t('tasks_title')
            : t('settings_title')

  const navigate = (next: Route) => {
    setRoute(next)
    setDrawerOpen(false)
  }

  return (
    <div className="app-shell">
      <header className="titlebar">
        <button className="icon-btn" onClick={() => setDrawerOpen(true)} aria-label="sidebar">
          <PanelLeft size={17} />
        </button>
        <button className="titlebar-title" onClick={() => setDrawerOpen(true)} aria-label="open sessions">
          <img src={logoUrl} alt="" className="brand-mark" draggable={false} />
          <span className="t">{pageTitle}</span>
          <span className="sub">·</span>
          <span className="sub">{route === 'chat' ? t('sessions') : t('workspace_label')}</span>
        </button>
        {route === 'chat' ? (
          <button
            className="icon-btn"
            onClick={() => {
              setRoute('chat')
              void newSession(useChatStore.getState().activeMode)
            }}
            aria-label="new session"
          >
            <SquarePen size={16} />
          </button>
        ) : null}
        <button className={`icon-btn ${route === 'settings' ? 'accent' : ''}`} onClick={() => navigate('settings')} aria-label="settings">
          <SettingsIcon size={17} />
        </button>
      </header>

      <main className="app-main">
        {route === 'chat' ? (
          <div className="panel-page">
            <ChatScreen />
          </div>
        ) : route === 'swarm' ? (
          <div className="panel-page">
            <SwarmScreen />
          </div>
        ) : route === 'telegraph' ? (
          <div className="panel-page">
            <TelegraphScreen />
          </div>
        ) : route === 'board' ? (
          <div className="panel-page">
            <BoardScreen />
          </div>
        ) : (
          <div className="panel-page">
            <SettingsScreen />
          </div>
        )}
      </main>

      <Sidebar
        open={drawerOpen}
        route={route}
        onClose={() => setDrawerOpen(false)}
        onNavigate={navigate}
        approvals={approvals.length > 0}
        running={runningSessions.length > 0}
      />

      <ToastHost />
    </div>
  )
}
