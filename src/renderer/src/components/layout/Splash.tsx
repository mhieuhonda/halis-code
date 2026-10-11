/** Boot splash — the logo ignites, then the app fades in underneath. */
import { useEffect, useState } from 'react'
import logoUrl from '../../assets/logo.png'

export function Splash({ ready }: { ready: boolean }) {
  const [visible, setVisible] = useState(true)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    if (!ready) return
    // give the logo a beat to be seen, then lift the curtain
    const t1 = setTimeout(() => setLeaving(true), 420)
    const t2 = setTimeout(() => setVisible(false), 1000)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [ready])

  if (!visible) return null

  return (
    <div className={`fixed inset-0 z-[100] flex flex-col items-center justify-center bg-bg ${leaving ? 'splash-done' : ''}`}>
      <div className="halis-aurora absolute inset-0 overflow-hidden" />
      <div className="relative flex flex-col items-center">
        <img src={logoUrl} alt="" className="splash-logo w-24 h-24 rounded-[22px] shadow-[0_20px_60px_-12px_rgba(69,165,255,0.55)]" draggable={false} />
        <div className="mt-6 splash-logo text-[22px] font-semibold tracking-tight brand-gradient-text" style={{ animationDelay: '0.12s' }}>
          Halis Code
        </div>
        <div className="mt-3 flex items-center gap-1.5" style={{ animationDelay: '0.2s' }}>
          <span className="typing-dot w-1.5 h-1.5 rounded-full bg-signal inline-block" />
          <span className="typing-dot w-1.5 h-1.5 rounded-full bg-signal inline-block" style={{ animationDelay: '0.2s' }} />
          <span className="typing-dot w-1.5 h-1.5 rounded-full bg-signal inline-block" style={{ animationDelay: '0.4s' }} />
        </div>
      </div>
      <div className="absolute bottom-8 text-[10.5px] text-faint tracking-wide font-mono">local-first · swarm-ready · telegraph-native</div>
    </div>
  )
}
