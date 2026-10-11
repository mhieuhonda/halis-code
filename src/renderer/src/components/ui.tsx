/** Shared UI primitives — quiet, flat, ember-and-signal. */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useEffect,
} from 'react'
import { Check, Info, TriangleAlert, X } from 'lucide-react'

/* ------------------------------- Button ------------------------------ */

export function Button({
  variant = 'default',
  size = 'md',
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'ghost' | 'danger' | 'good'
  size?: 'sm' | 'md'
}) {
  const base =
    'inline-flex items-center justify-center gap-1.5 rounded-xl font-medium transition-all duration-150 active:scale-[0.975] disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 cursor-pointer select-none'
  const sizes = size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-2 text-[13px]'
  const variants = {
    default: 'bg-panel3 text-ink border border-line hover:border-line2 hover:bg-panel4',
    primary: 'text-white bg-gradient-to-r from-ember to-signal hover:brightness-110 shadow-[0_2px_16px_-4px_rgba(69,165,255,0.45)]',
    ghost: 'text-muted hover:text-ink hover:bg-panel3',
    danger: 'bg-red/10 text-red border border-red/25 hover:bg-red/20',
    good: 'bg-good/10 text-good border border-good/25 hover:bg-good/20',
  }
  return (
    <button className={`${base} ${sizes} ${variants[variant]} ${className}`} {...props}>
      {children}
    </button>
  )
}

/* ------------------------------- Badge ------------------------------- */

export function Badge({ children, color, className = '' }: { children: ReactNode; color?: string; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-medium leading-none whitespace-nowrap ${className}`}
      style={
        color
          ? { backgroundColor: `${color}16`, color, border: `1px solid ${color}30` }
          : { backgroundColor: '#161b26', color: '#8b95a8', border: '1px solid #232b3c' }
      }
    >
      {children}
    </span>
  )
}

/* ------------------------------- Inputs ------------------------------ */

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full rounded-xl bg-panel2 border border-line px-3 py-2 text-[13px] text-ink placeholder:text-faint outline-none focus:border-signal/50 focus:bg-[#0d1018] focus:shadow-[0_0_0_3px_rgba(69,165,255,0.08)] transition-all ${className}`}
      {...props}
    />
  )
}

export function Textarea({ className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={`w-full rounded-xl bg-panel2 border border-line px-3 py-2 text-[13px] text-ink placeholder:text-faint outline-none focus:border-signal/50 focus:bg-[#0d1018] focus:shadow-[0_0_0_3px_rgba(69,165,255,0.08)] transition-all resize-none ${className}`}
      {...props}
    />
  )
}

export function Select({ className = '', children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`w-full appearance-none rounded-xl bg-panel2 border border-line px-3 py-2 text-[13px] text-ink outline-none focus:border-signal/50 cursor-pointer transition-colors ${className}`}
      {...props}
    >
      {children}
    </select>
  )
}

/* ------------------------------- Toggle ------------------------------ */

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex items-center gap-2.5 group cursor-pointer">
      <span
        className={`relative inline-flex h-[18px] w-[32px] shrink-0 rounded-full transition-all duration-200 ${
          checked ? 'bg-gradient-to-r from-ember to-signal shadow-[0_0_10px_-2px_rgba(69,165,255,0.5)]' : 'bg-panel4 border border-line'
        }`}
      >
        <span
          className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow transition-transform duration-200 ${checked ? 'translate-x-[16px]' : 'translate-x-[2px]'}`}
        />
      </span>
      {label ? <span className="text-[13px] text-muted group-hover:text-ink transition-colors text-left">{label}</span> : null}
    </button>
  )
}

/* ------------------------------ Spinner ------------------------------ */

export function Spinner({ size = 14, className = '' }: { size?: number; className?: string }) {
  return <span className={`orbit inline-block shrink-0 ${className}`} style={{ width: size, height: size }} />
}

/* ------------------------------- Modal ------------------------------- */

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean }) {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-[3px] p-6 fade-in" onMouseDown={onClose}>
      <div
        className={`bg-panel border border-line2 rounded-2xl shadow-[0_24px_80px_-16px_rgba(0,0,0,0.8)] w-full ${wide ? 'max-w-2xl' : 'max-w-md'} max-h-[80vh] overflow-hidden flex flex-col pop`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-line">
          <div className="text-[15px] font-semibold tracking-tight">{title}</div>
          <button onClick={onClose} className="text-muted hover:text-ink cursor-pointer p-1 rounded-lg hover:bg-panel3 transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="px-5 py-4 overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}

/* --------------------------- Section title --------------------------- */

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 mb-3">
      <h2 className="text-[17px] font-semibold tracking-tight">{children}</h2>
      {hint ? <span className="text-xs text-faint">{hint}</span> : null}
    </div>
  )
}

/* ----------------------------- Empty state --------------------------- */

export function EmptyState({ icon, title, hint }: { icon?: ReactNode; title: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
      {icon ? <div className="text-faint mb-1">{icon}</div> : null}
      <div className="text-muted text-sm">{title}</div>
      {hint ? <div className="text-faint text-xs max-w-sm leading-relaxed">{hint}</div> : null}
    </div>
  )
}

/* ------------------------------- Toasts ------------------------------ */

type ToastKind = 'info' | 'success' | 'error'
interface Toast {
  id: number
  kind: ToastKind
  message: string
}
interface ToastApi {
  push: (message: string, kind?: ToastKind) => void
}
const ToastCtx = createContext<ToastApi>({ push: () => {} })

export function useToast() {
  return useContext(ToastCtx)
}

export function ToastHost({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const seq = useRef(0)

  const push = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = ++seq.current
    setToasts((prev) => [...prev.slice(-3), { id, kind, message }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3600)
  }, [])

  const api = useMemo(() => ({ push }), [push])

  const iconFor = (kind: ToastKind) =>
    kind === 'success' ? <Check size={13} className="text-good" /> : kind === 'error' ? <TriangleAlert size={13} className="text-red" /> : <Info size={13} className="text-signal" />
  const accentFor = (kind: ToastKind) => (kind === 'success' ? '#3ed598' : kind === 'error' ? '#ff6b7a' : '#45a5ff')

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="fixed top-3 right-3 z-[60] flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="toast-in pointer-events-auto flex items-center gap-2.5 rounded-xl border bg-panel2/95 backdrop-blur px-3.5 py-2.5 shadow-[0_12px_40px_-8px_rgba(0,0,0,0.7)] min-w-[220px] max-w-[380px]"
            style={{ borderColor: `${accentFor(t.kind)}40`, borderLeft: `2px solid ${accentFor(t.kind)}` }}
          >
            {iconFor(t.kind)}
            <span className="text-[12.5px] text-ink leading-snug">{t.message}</span>
            <button
              className="ml-auto text-faint hover:text-ink cursor-pointer p-0.5 transition-colors"
              onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}
