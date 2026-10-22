/** Full-screen searchable model picker. */
import { useMemo, useState } from 'react'
import { Search, Star, X, Zap } from 'lucide-react'
import type { ModelInfo } from '@shared/types'
import { useAppStore } from '../stores/app'
import { useT } from '../i18n'
import { Sheet } from './ui'

const FAVORITES_KEY = 'halis-model-favorites'

function loadFavorites(): string[] {
  try {
    return JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}

export function ModelPicker({ open, onClose, onPick, currentId }: { open: boolean; onClose: () => void; onPick: (model: ModelInfo) => void; currentId?: string }) {
  const t = useT()
  const catalog = useAppStore((s) => s.catalog)
  const [query, setQuery] = useState('')
  const [favorites, setFavorites] = useState<string[]>(loadFavorites)

  const providerName = (id: string) => catalog?.providers.find((p) => p.id === id)?.name ?? id

  const filtered = useMemo(() => {
    const models = catalog?.models ?? []
    const q = query.trim().toLowerCase()
    const base = q
      ? models.filter((m) => `${m.name} ${m.id} ${providerName(m.providerId)}`.toLowerCase().includes(q))
      : models
    const sorted = [...base].sort((a, b) => {
      const favA = favorites.includes(a.id) ? 0 : 1
      const favB = favorites.includes(b.id) ? 0 : 1
      if (favA !== favB) return favA - favB
      return Number(b.free) - Number(a.free) || a.name.localeCompare(b.name)
    })
    return sorted.slice(0, 120)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, query, favorites])

  const toggleFavorite = (id: string) => {
    setFavorites((prev) => {
      const next = prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id]
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(next))
      return next
    })
  }

  return (
    <Sheet open={open} onClose={onClose} title={t('select_model')}>
      <div className="row" style={{ background: 'var(--hal-bg-soft)', border: '1px solid var(--hal-border)', borderRadius: 12, padding: '4px 10px', marginBottom: 10 }}>
        <Search size={16} style={{ color: 'var(--hal-ink-muted)' }} />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('model_search')}
          style={{ border: 'none', background: 'transparent', outline: 'none', padding: '9px 4px', flex: 1, minWidth: 0 }}
        />
        {query ? (
          <button className="icon-btn" style={{ width: 32, height: 32 }} onClick={() => setQuery('')}>
            <X size={15} />
          </button>
        ) : null}
      </div>

      <div>
        {filtered.map((m) => (
          <button
            key={m.id}
            className="row"
            style={{
              width: '100%',
              border: 'none',
              borderBottom: '1px solid var(--hal-border)',
              background: m.id === currentId ? 'var(--hal-accent-soft)' : 'transparent',
              padding: '10px 6px',
              textAlign: 'left',
              cursor: 'pointer',
              gap: 8,
            }}
            onClick={() => {
              onPick(m)
              onClose()
            }}
          >
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="row" style={{ gap: 6 }}>
                <span style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
                {m.free ? <span className="chip chip-green" style={{ fontSize: 10 }}>free</span> : null}
                {m.reasoning ? <span className="chip chip-blue" style={{ fontSize: 10 }}>reasoning</span> : null}
                {!m.toolCall ? <span className="chip chip-amber" style={{ fontSize: 10 }}>no tools</span> : null}
              </div>
              <div className="hint" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {providerName(m.providerId)}
                {m.contextWindow ? ` · ${Math.round(m.contextWindow / 1000)}k ${t('context_window')}` : ''}
              </div>
            </div>
            <button
              className="icon-btn"
              style={{ width: 34, height: 34 }}
              onClick={(e) => {
                e.stopPropagation()
                toggleFavorite(m.id)
              }}
              aria-label={t('model_favorite_toggle')}
            >
              <Star size={16} fill={favorites.includes(m.id) ? 'var(--hal-amber)' : 'none'} style={{ color: favorites.includes(m.id) ? 'var(--hal-amber)' : 'var(--hal-ink-muted)' }} />
            </button>
            {m.free ? <Zap size={14} style={{ color: 'var(--hal-green)' }} /> : null}
          </button>
        ))}
        {!filtered.length ? <div className="hint" style={{ padding: 20, textAlign: 'center' }}>{t('model_none')}</div> : null}
      </div>
    </Sheet>
  )
}
