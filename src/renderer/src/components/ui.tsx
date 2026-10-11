/** Shared UI primitives — small, quiet, dark. */
import { type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes, useEffect } from 'react'
import { X } from 'lucide-react'

export function Button({
  variant = 'default',
  size = 'md',
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'ghost' | 'danger' | 'good'; size?: 'sm' | 'md' }) {
  const base =
    'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer select-none'
  const sizes = size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-2 text-[13px]'
  const variants = {
    default: 'bg-panel3 text-ink border border-line hover:border-line2 hover:bg-[#202839]',
    primary: 'bg-accent text-white hover:bg-[#8d7fff] shadow-[0_2px_12px_rgba(124,108,255,0.25)]',
    ghost: 'text-muted hover:text-ink hover:bg-panel3',
    danger: 'bg-red/10 text-red border border-red/30 hover:bg-red/20',
    good: 'bg-good/10 text-good border border-good/30 hover:bg-good/20',
  }
  return (
    <button className={`${base} ${sizes} ${variants[variant]} ${className}`} {...props}>
      {children}
    </button>
  )
}

export function Badge({ children, color, className = '' }: { children: ReactNode; color?: string; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-medium leading-none ${className}`}
      style={color ? { backgroundColor: `${color}1f`, color, border: `1px solid ${color}38` } : { backgroundColor: '#1c2333', color: '#8b95ab', border: '1px solid #262f45' }}
    >
      {children}
    </span>
  )
}

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full rounded-lg bg-[#0d1119] border border-line px-3 py-2 text-[13px] text-ink placeholder:text-faint outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/25 transition ${className}`}
      {...props}
    />
  )
}

export function Textarea({ className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={`w-full rounded-lg bg-[#0d1119] border border-line px-3 py-2 text-[13px] text-ink placeholder:text-faint outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/25 transition resize-none ${className}`}
      {...props}
    />
  )
}

export function Select({ className = '', children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`w-full appearance-none rounded-lg bg-[#0d1119] border border-line px-3 py-2 text-[13px] text-ink outline-none focus:border-accent/60 cursor-pointer ${className}`}
      {...props}
    >
      {children}
    </select>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex items-center gap-2.5 group cursor-pointer">
      <span
        className={`relative inline-flex h-[18px] w-[32px] shrink-0 rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-[#2a3348]'}`}
      >
        <span
          className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white transition-transform ${checked ? 'translate-x-[16px]' : 'translate-x-[2px]'}`}
        />
      </span>
      {label ? <span className="text-[13px] text-muted group-hover:text-ink transition-colors text-left">{label}</span> : null}
    </button>
  )
}

export function Spinner({ size = 14, className = '' }: { size?: number; className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.2" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px] p-6" onMouseDown={onClose}>
      <div
        className={`bg-panel border border-line rounded-2xl shadow-2xl w-full ${wide ? 'max-w-2xl' : 'max-w-md'} max-h-[80vh] overflow-hidden flex flex-col fade-up`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-line">
          <div className="text-[15px] font-semibold">{title}</div>
          <button onClick={onClose} className="text-muted hover:text-ink cursor-pointer p-1">
            <X size={16} />
          </button>
        </div>
        <div className="px-5 py-4 overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 mb-3">
      <h2 className="text-[15px] font-semibold tracking-tight">{children}</h2>
      {hint ? <span className="text-xs text-faint">{hint}</span> : null}
    </div>
  )
}

export function EmptyState({ icon, title, hint }: { icon?: ReactNode; title: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      {icon ? <div className="text-faint mb-1">{icon}</div> : null}
      <div className="text-muted text-sm">{title}</div>
      {hint ? <div className="text-faint text-xs max-w-sm">{hint}</div> : null}
    </div>
  )
}
