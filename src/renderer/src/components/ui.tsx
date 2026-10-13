/** Shared UI primitives. */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
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
  variant?: 'default' | 'primary' | 'ghost' | 'danger' | 'good' | 'outline'
  size?: 'sm' | 'md'
}) {
  const base =
    'inline-flex items-center justify-center gap-1.5 rounded-md font-medium cursor-pointer select-none disabled:opacity-40 disabled:cursor-not-allowed'
  const sizes = size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-9 px-3.5 text-[13px]'
  const variants = {
    default: 'bg-panel2 text-ink border border-line hover:bg-panel4',
    primary: 'text-[var(--hal-alias-brand-primary-inverted)] bg-[var(--hal-alias-button-primary-fill)] hover:bg-[var(--hal-alias-button-primary-hover)] border border-transparent',
    ghost: 'text-muted hover:text-ink hover:bg-[var(--hal-alias-interactive-bg-hover)]',
    outline: 'text-ink border-[0.5px] border-[color:var(--hal-alias-border-l3)] hover:bg-[var(--hal-alias-interactive-bg-hover)]',
    danger: 'text-red border-[0.5px] border-red/25 hover:bg-[var(--hal-alias-interactive-bg-hover-danger)]',
    good: 'text-good border-[0.5px] border-good/25 hover:bg-[color-mix(in_srgb,var(--hal-alias-state-success-primary)_10%,transparent)]',
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
          ? { backgroundColor: `${color}14`, color, border: `0.5px solid ${color}2e` }
          : { backgroundColor: 'var(--hal-alias-bg-skeleton)', color: 'var(--hal-alias-label-secondary)', border: '0.5px solid var(--hal-alias-border-l2)' }
      }
    >
      {children}
    </span>
  )
}

/* ------------------------------- Inputs ------------------------------ */

const fieldCls =
  'w-full h-8 rounded-md bg-[var(--hal-alias-bg-layer-1)] border-[0.5px] border-[color:var(--hal-alias-border-l4)] px-2.5 text-[13px] text-ink placeholder:text-[color:var(--hal-alias-label-dimmed)] outline-none transition-colors duration-100 focus:border-[color:var(--hal-alias-state-business-primary)] focus:bg-[var(--hal-alias-bg-layer-1)]'

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${fieldCls} ${className}`} {...props} />
}

export function Textarea({ className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${fieldCls} h-auto py-2 ${className}`} {...props} />
}

const selectChevron =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2381858C' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")"

export function Select({ className = '', children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`w-full h-8 appearance-none rounded-md bg-[var(--hal-alias-bg-layer-1)] border-[0.5px] border-[color:var(--hal-alias-border-l4)] pl-2.5 pr-7 text-[13px] text-ink outline-none cursor-pointer transition-colors duration-100 focus:border-[color:var(--hal-alias-state-business-primary)] ${className}`}
      style={{
        backgroundImage: selectChevron,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 8px center',
        backgroundSize: '12px 12px',
      }}
      {...props}
    >
      {children}
    </select>
  )
}

/** DSH composer chip select — borderless, chevron baked in, hover fill. */
export function ChipSelect({ className = '', children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`h-7 max-w-[220px] appearance-none rounded-sm bg-transparent pl-2 pr-5 text-[13px] font-medium text-muted outline-none cursor-pointer hover:bg-[var(--hal-alias-interactive-bg-hover)] ${className}`}
      style={{
        backgroundImage: selectChevron,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 4px center',
        backgroundSize: '12px 12px',
      }}
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
        className={`relative inline-flex h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors duration-100 box-content border ${
          checked
            ? 'bg-[var(--hal-alias-brand-primary)] border-transparent'
            : 'bg-transparent border-[color:var(--hal-alias-border-l3)]'
        }`}
      >
        <span
          className={`h-4 w-4 rounded-full transition-transform duration-100 ease-linear ${
            checked ? 'translate-x-4 bg-[var(--hal-alias-brand-primary-inverted)]' : 'translate-x-0 bg-[var(--hal-alias-switch-thumb)]'
          }`}
        />
      </span>
      {label ? <span className="text-[13px] text-muted group-hover:text-ink transition-colors text-left">{label}</span> : null}
    </button>
  )
}

/* ---------------------------- Agent avatar --------------------------- */

/** Agent avatar tile: uploaded picture first, then the legacy emoji, then
 *  the agent's initial. New agents ship with no picture at all — the UI
 *  never offers preset avatars, only upload-or-empty. */
export function AgentAvatar({
  agent,
  size = 20,
  className = '',
}: {
  agent: { name: string; avatar: string; avatarImage?: string; color: string }
  size?: number
  className?: string
}) {
  const initial = agent.name?.trim()?.[0]?.toUpperCase() || '·'
  const tile: React.CSSProperties = {
    width: size,
    height: size,
    backgroundColor: `${agent.color}1a`,
    color: agent.color,
    fontSize: Math.max(9, Math.round(size * 0.46)),
  }
  if (agent.avatarImage) {
    return (
      <img
        src={agent.avatarImage}
        alt={agent.name}
        draggable={false}
        className={`inline-flex shrink-0 rounded-[inherit] object-cover ${className}`}
        style={{ width: size, height: size }}
      />
    )
  }
  if (agent.avatar) {
    return (
      <span className={`inline-flex shrink-0 items-center justify-center rounded-[inherit] ${className}`} style={tile}>
        {agent.avatar}
      </span>
    )
  }
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-[inherit] font-semibold ${className}`} style={tile}>
      {initial}
    </span>
  )
}

/* ------------------------------ Spinner ------------------------------ */

export function Spinner({ size = 14, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={`shrink-0 ${className}`}
      style={{ animation: 'hal-state-dot-spin 1.5s linear infinite' }}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray="12 150"
        style={{ animation: 'hal-state-dot-spin 1.5s linear infinite, hal-state-dot-dash 1.5s ease-in-out infinite' }}
      />
    </svg>
  )
}

/* --------------------------- Shimmer text ---------------------------- */

/** DSH TextShimmer — dim base with a bright band sweeping through. */
export function ShimmerText({ text, className = '', highlight }: { text: string; className?: string; highlight?: string }) {
  return (
    <span
      className={`shimmer-text ${className}`}
      style={highlight ? ({ ['--hal-shimmer-highlight-color' as string]: highlight } as React.CSSProperties) : undefined}
    >
      <span>{text}</span>
      <span className="shimmer-sweep" aria-hidden>
        <span className="shimmer-highlight">{text}</span>
      </span>
    </span>
  )
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--hal-alias-bg-mask-1)] backdrop-blur-[2px] p-6 modal-enter"
      onMouseDown={onClose}
    >
      <div
        className={`bg-[var(--hal-alias-bg-layer-2)] rounded-panel w-full max-w-[380px] max-h-[80vh] overflow-hidden flex flex-col modal-enter ${wide ? '!max-w-[488px]' : ''}`}
        style={{ boxShadow: 'var(--hal-elevation-prominent)' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pt-[22px] pb-3 pl-6 pr-4">
          <div className="text-base font-medium leading-6">{title}</div>
          <button
            onClick={onClose}
            className="text-[color:var(--hal-alias-label-tertiary)] hover:text-ink cursor-pointer p-1 rounded-sm hover:bg-[var(--hal-alias-interactive-bg-hover)] transition-colors duration-100"
          >
            <X size={15} />
          </button>
        </div>
        <div className="px-6 pb-6 overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}

/* --------------------------- Section title --------------------------- */

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 mb-3">
      <h2 className="text-base font-medium leading-6">{children}</h2>
      {hint ? <span className="text-xs text-[color:var(--hal-alias-label-tertiary)]">{hint}</span> : null}
    </div>
  )
}

/* ----------------------------- Empty state --------------------------- */

export function EmptyState({ icon, title, hint }: { icon?: ReactNode; title: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
      {icon ? <div className="text-[color:var(--hal-alias-label-tertiary)] mb-1">{icon}</div> : null}
      <div className="text-muted text-sm">{title}</div>
      {hint ? <div className="text-[color:var(--hal-alias-label-caption)] text-xs max-w-sm leading-relaxed">{hint}</div> : null}
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
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4200)
  }, [])

  const api = useMemo(() => ({ push }), [push])

  const iconFor = (kind: ToastKind) =>
    kind === 'success' ? (
      <Check size={13} className="text-good" />
    ) : kind === 'error' ? (
      <TriangleAlert size={13} className="text-[color:var(--hal-alias-state-error-secondary)]" />
    ) : (
      <Info size={13} className="text-[color:var(--hal-alias-link)]" />
    )

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="fixed top-10 left-1/2 -translate-x-1/2 z-[60] flex flex-col items-center gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="toast-in pointer-events-auto flex items-center gap-2.5 rounded-lg px-4 py-3 min-w-[220px] max-w-[min(640px,100vw-48px)] text-[var(--hal-alias-tooltip-text)]"
            style={{ background: 'var(--hal-alias-toast-bg)', boxShadow: 'var(--hal-shadow-lv3)' }}
          >
            {iconFor(t.kind)}
            <span className="text-[13px] leading-5">{t.message}</span>
            <button
              className="ml-auto opacity-60 hover:opacity-100 cursor-pointer p-0.5 transition-opacity duration-100"
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
