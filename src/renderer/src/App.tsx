/** Halis Code — renderer root. */
import { useEffect, useState } from 'react'
import { useAppStore } from './stores/app'
import { useChatStore } from './stores/chat'
import { useSwarmStore } from './stores/swarm'
import { useTelegraphStore } from './stores/telegraph'
import { Sidebar, type Route } from './components/layout/Sidebar'
import { ChatView } from './components/chat/ChatView'
import { SwarmSetupView } from './components/swarm/SwarmSetupView'
import { ModelsView } from './components/models/ModelsView'
import { TelegraphView } from './components/telegraph/TelegraphView'
import { TaskBoardView } from './components/taskboard/TaskBoardView'
import { SettingsView } from './components/settings/SettingsView'

export default function App() {
  const [route, setRoute] = useState<Route>('chat')
  const app = useAppStore()
  const chat = useChatStore()
  const swarm = useSwarmStore()
  const tg = useTelegraphStore()

  useEffect(() => {
    chat.init()
    void app.loadSettings()
    void app.loadCatalog()
    void app.loadKeyStatus()
    void app.loadWorkspace()
    void swarm.load()
    void tg.loadStatus()
    void chat.loadSessions()
  }, [])

  // Boot: once the session list is loaded, open the newest or create one —
  // never duplicate empty sessions across launches.
  useEffect(() => {
    if (!chat.sessionsLoaded) return
    if (chat.sessions.length === 0 && !chat.activeSessionId) {
      void chat.newSession('agent')
    } else if (!chat.activeSessionId) {
      void chat.openSession(chat.sessions[0].id)
    }
  }, [chat.sessionsLoaded, chat.sessions, chat.activeSessionId])

  return (
    <div className="flex h-full w-full overflow-hidden">
      <Sidebar route={route} setRoute={setRoute} />
      {route === 'chat' ? <ChatView mode={chat.activeMode} /> : null}
      {route === 'swarm-setup' ? <SwarmSetupView /> : null}
      {route === 'models' ? <ModelsView /> : null}
      {route === 'telegraph' ? <TelegraphView /> : null}
      {route === 'tasks' ? <TaskBoardView /> : null}
      {route === 'settings' ? <SettingsView /> : null}
    </div>
  )
}
