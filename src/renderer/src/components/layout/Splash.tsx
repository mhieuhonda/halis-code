/** Boot splash — brand mark settles, wordmark reveals, quiet dots. */
import { useEffect, useState } from 'react'
import logoUrl from '../../assets/logo.png'
import nameUrl from '../../assets/name.png'

export function Splash({ ready }: { ready: boolean }) {
  const [visible, setVisible] = useState(true)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    if (!ready) return
    // give the mark a beat to be seen, then lift the curtain
    const t1 = setTimeout(() => setLeaving(true), 420)
    const t2 = setTimeout(() => setVisible(false), 1000)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [ready])

  if (!visible) return null

  return (
    <div className={`fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[var(--hal-alias-bg-base)] ${leaving ? 'splash-done' : ''}`}>
      <div className="flex flex-col items-center">
        <img src={logoUrl} alt="Halis Code" className="splash-logo brand-img w-20 h-20" draggable={false} />
        <img src={nameUrl} alt="" className="splash-logo brand-img h-7 w-auto mt-5" draggable={false} style={{ animationDelay: '0.12s' }} />
        <div className="mt-4 flex items-center gap-1.5" style={{ animationDelay: '0.2s' }}>
          <span className="typing-dot w-1 h-1 rounded-full bg-[color:var(--hal-alias-state-business-primary)] inline-block" />
          <span className="typing-dot w-1 h-1 rounded-full bg-[color:var(--hal-alias-state-business-primary)] inline-block" style={{ animationDelay: '0.2s' }} />
          <span className="typing-dot w-1 h-1 rounded-full bg-[color:var(--hal-alias-state-business-primary)] inline-block" style={{ animationDelay: '0.4s' }} />
        </div>
      </div>
      <div className="absolute bottom-8 text-[10.5px] text-[color:var(--hal-alias-label-caption)] tracking-wide font-mono">
        local-first · swarm-ready · telegraph-native
      </div>
    </div>
  )
}
