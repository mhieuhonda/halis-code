/**
 * Composer — the desktop composer pill: rounded panel with a 13px editor,
 * a 44px toolbar carrying the mode chip and the model chip, and the 28px
 * contrast submit button. The mode menu replaces the desktop agent select.
 */
import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Check, ChevronDown, Square } from 'lucide-react'
import type { ModelInfo } from '@shared/types'
import { useChatStore } from '../../stores/chat'
import { useAppStore } from '../../stores/app'
import { useT } from '../../i18n'

export function Composer({ mode, onOpenPicker }: { mode: 'agent' | 'swarm'; onOpenPicker: () => void }) {
  const t = useT()
  const send = useChatStore((s) => s.send)
  const stop = useChatStore((s) => s.stop)
  const running = useChatStore((s) => s.running)
  const sendError = useChatStore((s) => s.sendError)
  const activeSession = useChatStore((s) => s.sessions.find((x) => x.id === s.activeSessionId))
  const catalog = useAppStore((s) => s.catalog)
  const [text, setText] = useState('')
  const [modeMenu, setModeMenu] = useState(false)
  const areaRef = useRef<HTMLTextAreaElement>(null)

  const currentModel: ModelInfo | undefined = catalog?.models.find(
    (m) => m.id === (activeSession?.modelId ?? useAppStore.getState().settings?.defaultModelId),
  )
  const provider = catalog?.providers.find((p) => p.id === currentModel?.providerId)

  useEffect(() => {
    const area = areaRef.current
    if (!area) return
    area.style.height = 'auto'
    area.style.height = `${Math.min(area.scrollHeight, 130)}px`
  }, [text])

  const submit = () => {
    const trimmed = text.trim()
    if (!trimmed || running) return
    setText('')
    // The selected model rides with the send (same contract as desktop) —
    // session meta lives in the sessions list, keyed by activeSessionId.
    const modelId =
      mode === 'agent'
        ? (useChatStore.getState().sessions.find((x) => x.id === useChatStore.getState().activeSessionId)?.modelId ?? undefined)
        : undefined
    void send(trimmed, modelId)
  }

  const switchMode = (next: 'agent' | 'swarm') => {
    setModeMenu(false)
    useChatStore.setState({ activeMode: next })
  }

  return (
    <div>
      {sendError ? <div className="composer-error">{t('send_failed')}: {sendError}</div> : null}
      <div className="composer">
        <textarea
          ref={areaRef}
          rows={1}
          value={text}
          placeholder={mode === 'swarm' ? t('placeholder_swarm') : t('placeholder_agent')}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) {
              e.preventDefault()
              submit()
            }
          }}
        />
        <div className="composer-toolbar">
          <div className="menu-anchor">
            <button className="chip-btn capitalize" onClick={() => setModeMenu(!modeMenu)}>
              {mode}
              <ChevronDown size={13} />
            </button>
            {modeMenu ? (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 29 }} onClick={() => setModeMenu(false)} />
                <div className="menu" style={{ left: 0, minWidth: 180 }}>
                  <button className="menu-item" onClick={() => switchMode('agent')}>
                    {t('mode_agent')}
                    {mode === 'agent' ? <Check size={14} className="check" /> : null}
                  </button>
                  <button className="menu-item" onClick={() => switchMode('swarm')}>
                    {t('mode_swarm')}
                    {mode === 'swarm' ? <Check size={14} className="check" /> : null}
                  </button>
                </div>
              </>
            ) : null}
          </div>

          {mode === 'agent' ? (
            <button className="chip-btn" onClick={onOpenPicker} style={{ minWidth: 0 }}>
              <span className="provider">{provider?.name ?? '—'}</span>
              <span style={{ color: 'var(--v2-text-faint)' }}>/</span>
              <span className="model">{currentModel?.name ?? t('select_model')}</span>
              <ChevronDown size={13} style={{ flex: '0 0 auto' }} />
            </button>
          ) : null}

          <button
            className="submit-btn"
            disabled={!running && !text.trim()}
            onClick={running ? () => void stop() : submit}
            aria-label={running ? 'stop' : 'send'}
          >
            {running ? <Square size={13} /> : <ArrowUp size={16} />}
          </button>
        </div>
      </div>
      {mode === 'swarm' ? (
        <div className="hint hint-faint" style={{ margin: '4px 2px 0' }}>
          {t('swarm_mention_hint')}
        </div>
      ) : null}
    </div>
  )
}
