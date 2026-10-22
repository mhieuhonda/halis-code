import { useEffect, useState } from 'react'
import { MessageSquare, Settings as SettingsIcon, Sparkles, Users, Wallet } from 'lucide-react'
import { bridge } from './ui/lib/bridge'
import { useAppStore } from './ui/stores/app'
import { useChatStore } from './ui/stores/chat'
import { Splash } from './ui/components/Splash'
import { ToastHost } from './ui/components/ui'
import { ChatScreen } from './ui/components/chat/ChatScreen'
import { SwarmScreen } from './ui/components/SwarmScreen'
import { TelegraphScreen } from './ui/components/TelegraphScreen'
import { BoardScreen } from './ui/components/BoardScreen'
import { SettingsScreen } from './ui/components/SettingsScreen'
import { useT } from './ui/i18n'

type Tab = 'chat' | 'swarm' | 'telegraph' | 'board' | 'settings'

export default function App() {
  const [booted, setBooted] = useState(false)
  const [tab, setTab] = useState<Tab>('chat')
  const t = useT()
  const loadSettings = useAppStore((s) => s.loadSettings)
  const loadCatalog = useAppStore((s) => s.loadCatalog)
  const loadKeyStatus = useAppStore((s) => s.loadKeyStatus)
  const initChat = useChatStore((s) => s.init)
  const loadSessions = useChatStore((s) => s.loadSessions)
  const approvals = useChatStore((s) => s.approvals)
  const runningSessions = useChatStore((s) => s.runningSessions)

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

  if (!booted) return <Splash />

  const tabs: Array<{ id: Tab; icon: typeof MessageSquare; label: string; badge?: boolean }> = [
    { id: 'chat', icon: MessageSquare, label: t('tab_chat'), badge: approvals.length > 0 },
    { id: 'swarm', icon: Users, label: t('tab_swarm'), badge: runningSessions.length > 0 && tab !== 'chat' },
    { id: 'telegraph', icon: Wallet, label: t('tab_telegraph') },
    { id: 'board', icon: Sparkles, label: t('tab_board') },
    { id: 'settings', icon: SettingsIcon, label: t('tab_settings') },
  ]

  return (
    <div className="app-shell">
      {tab === 'chat' && <ChatScreen />}
      {tab === 'swarm' && <SwarmScreen />}
      {tab === 'telegraph' && <TelegraphScreen />}
      {tab === 'board' && <BoardScreen />}
      {tab === 'settings' && <SettingsScreen />}

      <nav className="bottom-nav safe-bottom">
        {tabs.map(({ id, icon: Icon, label, badge }) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)} style={{ position: 'relative' }}>
            <Icon size={21} strokeWidth={tab === id ? 2.2 : 1.8} />
            {badge ? <span className="badge-dot" /> : null}
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <ToastHost />
    </div>
  )
}
