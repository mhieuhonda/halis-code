/** Halis Code — renderer root: splash, command palette, toasts, routes. */
import { useEffect, useState } from 'react'
import { useAppStore } from './stores/app'
import { useChatStore } from './stores/chat'
import { useSwarmStore } from './stores/swarm'
import { useTelegraphStore } from './stores/telegraph'
import { Sidebar, type Route } from './components/layout/Sidebar'
import { Splash } from './components/layout/Splash'
import { CommandPalette } from './components/layout/CommandPalette'
import { ChatView } from './components/chat/ChatView'
import { SwarmSetupView } from './components/swarm/SwarmSetupView'
import { TelegraphView } from './components/telegraph/TelegraphView'
import { TaskBoardView } from './components/taskboard/TaskBoardView'
import { SettingsView } from './components/settings/SettingsView'
import { ToastHost } from './components/ui'

export default function App() {
  const [route, setRoute] = useState<Route>('chat')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [booted, setBooted] = useState(false)
  const app = useAppStore()
  const chat = useChatStore()
  const swarm = useSwarmStore()
  const tg = useTelegraphStore()
  // Boot-once snapshot of the store objects: keeping `chat` itself out of
  // effect dependency arrays below avoids re-running effects on every
  // streamed token (each `set` gives the store a new identity).
  const chatInit = chat.init
  const chatLoadSessions = chat.loadSessions

  useEffect(() => {
    const unsub = chatInit()
    void Promise.all([
      app.loadSettings(),
      app.loadCatalog(),
      app.loadKeyStatus(),
      app.loadWorkspace(),
      swarm.load(),
      chatLoadSessions(),
    ])
      .catch(() => {})
      .finally(() => setBooted(true))
    // Telegraph status pings the network (up to ~20s) — never gate the splash on it.
    void tg.loadStatus().catch(() => {})
    return () => unsub?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Boot: once the session list is loaded, open the newest or create one —
  // never duplicate empty sessions across launches. The fallback session
  // keeps the CURRENT mode: deleting the last swarm session must not yank
  // the user into agent mode.
  useEffect(() => {
    if (!chat.sessionsLoaded) return
    if (chat.sessions.length === 0 && !chat.activeSessionId) {
      void chat.newSession(chat.activeMode)
    } else if (!chat.activeSessionId && chat.sessions[0]) {
      void chat.openSession(chat.sessions[0].id)
    }
  }, [chat.sessionsLoaded, chat.sessions, chat.activeSessionId, chat.activeMode])

  // Global shortcuts: Ctrl+K palette, Ctrl+N new chat, Esc closes palette.
  // Reads the store imperatively inside the handler — a `chat` dependency
  // would tear down and re-add this listener on EVERY store update (i.e.
  // every streamed token) for the whole app lifetime.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        void useChatStore.getState().newSession(useChatStore.getState().activeMode)
        setRoute('chat')
      } else if (e.key === 'Escape' && paletteOpen) {
        setPaletteOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [paletteOpen])

  // Keep the document title in sync with the open session.
  useEffect(() => {
    const active = chat.sessions.find((s) => s.id === chat.activeSessionId)
    document.title = active ? `Halis Code — ${active.title.slice(0, 42)}` : 'Halis Code'
  }, [chat.activeSessionId, chat.sessions])

  return (
    <ToastHost>
      <Splash ready={booted} />
      <div className="flex h-full w-full overflow-hidden">
        <Sidebar route={route} setRoute={setRoute} />
        <main key={route} className="flex-1 min-w-0 flex fade-in">
          {route === 'chat' ? <ChatView mode={chat.activeMode} /> : null}
          {route === 'swarm-setup' ? <SwarmSetupView /> : null}
          {route === 'telegraph' ? <TelegraphView /> : null}
          {route === 'tasks' ? <TaskBoardView /> : null}
          {route === 'settings' ? <SettingsView /> : null}
        </main>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} setRoute={setRoute} />
    </ToastHost>
  )
}
