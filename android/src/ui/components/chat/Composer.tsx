/** Chat composer — auto-growing textarea, model chip, send/stop. */
import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Square } from 'lucide-react'
import type { ModelInfo } from '@shared/types'
import { useChatStore } from '../../stores/chat'
import { useAppStore } from '../../stores/app'
import { useT } from '../../i18n'
import { ModelPicker } from '../ModelPicker'

export function Composer({ mode }: { mode: 'agent' | 'swarm' }) {
  const t = useT()
  const send = useChatStore((s) => s.send)
  const stop = useChatStore((s) => s.stop)
  const running = useChatStore((s) => s.running)
  const sendError = useChatStore((s) => s.sendError)
  const activeSession = useChatStore((s) => s.sessions.find((x) => x.id === s.activeSessionId))
  const catalog = useAppStore((s) => s.catalog)
  const [text, setText] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const areaRef = useRef<HTMLTextAreaElement>(null)

  const currentModel: ModelInfo | undefined = catalog?.models.find((m) => m.id === (activeSession?.modelId ?? useAppStore.getState().settings?.defaultModelId))

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
    const modelId = mode === 'agent' ? (useChatStore.getState().sessions.find((x) => x.id === useChatStore.getState().activeSessionId)?.modelId ?? undefined) : undefined
    void send(trimmed, modelId)
  }

  return (
    <div className="composer-wrap">
      {sendError ? (
        <div className="chip chip-red" style={{ marginBottom: 6, maxWidth: '100%', whiteSpace: 'normal', textAlign: 'left' }}>
          {t('send_failed')}: {sendError}
        </div>
      ) : null}
      {running ? (
        <div className="row" style={{ marginBottom: 6, color: 'var(--hal-ink-muted)', fontSize: 12.5, fontWeight: 600 }}>
          <span className="spinner" />
          {mode === 'swarm' ? t('working') : t('thinking')}…
          <button className="btn btn-sm" style={{ marginLeft: 'auto', color: 'var(--hal-red)' }} onClick={() => void stop()}>
            <Square size={11} /> {t('stop_turn')}
          </button>
        </div>
      ) : null}
      <div className="composer">
        {mode === 'agent' ? (
          <button className="chip" style={{ marginBottom: 4, alignSelf: 'flex-end', maxWidth: 130, overflow: 'hidden' }} onClick={() => setPickerOpen(true)}>
            {currentModel?.name ?? t('select_model')}
          </button>
        ) : null}
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
        <button className={`send-btn ${running ? 'stop' : ''}`} disabled={!running && !text.trim()} onClick={running ? () => void stop() : submit} aria-label={running ? 'stop' : 'send'}>
          {running ? <Square size={16} /> : <ArrowUp size={18} />}
        </button>
      </div>
      {mode === 'swarm' ? <div className="hint" style={{ marginTop: 4 }}>@Tên agent để gọi trực tiếp — không nhắn cho tất cả.</div> : null}
    </div>
  )
}
