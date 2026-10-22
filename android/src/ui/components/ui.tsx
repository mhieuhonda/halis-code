/** Shared mobile UI primitives: bottom sheet, toasts, switch, section row. */
import { useEffect, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'

/* ------------------------------- Sheet ------------------------------- */

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        {title ? (
          <div className="row" style={{ marginBottom: 10 }}>
            <div className="grow" style={{ fontWeight: 650, fontSize: 16 }}>
              {title}
            </div>
            <button className="icon-btn" onClick={onClose} aria-label="close">
              <X size={19} />
            </button>
          </div>
        ) : null}
        {children}
      </div>
    </div>
  )
}

/* ------------------------------- Toasts ------------------------------ */

interface Toast {
  id: number
  message: string
  kind: 'info' | 'error'
}

let toastSeq = 0
const toastListeners = new Set<(toasts: Toast[]) => void>()
let toasts: Toast[] = []

export function pushToast(message: string, kind: 'info' | 'error' = 'info'): void {
  const toast: Toast = { id: ++toastSeq, message, kind }
  toasts = [...toasts, toast]
  toastListeners.forEach((l) => l(toasts))
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== toast.id)
    toastListeners.forEach((l) => l(toasts))
  }, 2600)
}

export function ToastHost() {
  const [items, setItems] = useState<Toast[]>(toasts)
  useEffect(() => {
    const listener = (next: Toast[]) => setItems(next)
    toastListeners.add(listener)
    // Bridge store-driven toasts (settings errors etc.) dispatched as DOM events.
    const onDomToast = (e: Event) => {
      const detail = (e as CustomEvent<{ message: string; kind?: 'info' | 'error' }>).detail
      if (detail?.message) pushToast(detail.message, detail.kind ?? 'info')
    }
    window.addEventListener('halis:toast', onDomToast)
    return () => {
      toastListeners.delete(listener)
      window.removeEventListener('halis:toast', onDomToast)
    }
  }, [])
  if (!items.length) return null
  return (
    <div className="toast-host">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.kind === 'error' ? 'error' : ''}`}>
          {t.message}
        </div>
      ))}
    </div>
  )
}

/* ------------------------------- Switch ------------------------------ */

export function Switch({ on, onChange }: { on: boolean; onChange: (next: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)} />
  )
}

/* ------------------------------- Row --------------------------------- */

export function SettingRow({ label, hint, children, onClick }: { label: string; hint?: string; children?: ReactNode; onClick?: () => void }) {
  return (
    <div className="row" style={{ padding: '12px 0', gap: 12, cursor: onClick ? 'pointer' : undefined }} onClick={onClick}>
      <div className="grow">
        <div style={{ fontWeight: 600, fontSize: 14.5 }}>{label}</div>
        {hint ? <div className="hint" style={{ marginTop: 2 }}>{hint}</div> : null}
      </div>
      {children}
    </div>
  )
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--hal-ink-muted)', margin: '18px 0 6px' }}>
      {children}
    </div>
  )
}
