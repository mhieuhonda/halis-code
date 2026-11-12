/**
 * Model picker — the desktop select dialog as a bottom sheet: bare search
 * field with a hairline, sticky provider headers (popular first), 36px rows
 * with provider icons, Free badges and a favorites star.
 */
import { useMemo, useState } from 'react'
import { Check, Search, Star, X } from 'lucide-react'
import type { CatalogSnapshot, ModelInfo, ProviderInfo } from '@shared/types'
import { useAppStore } from '../stores/app'
import { useT } from '../i18n'
import { Sheet } from './ui'

const FAVORITES_KEY = 'halis-model-favorites'
/** Rows rendered per provider before the "show more" expander. */
const PREVIEW_ROWS = 5
/** Hard cap for search results — keeps the DOM small on phones. */
const SEARCH_CAP = 200

function loadFavorites(): string[] {
  try {
    return JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}

export function ModelPicker({
  open,
  onClose,
  onPick,
  currentId,
}: {
  open: boolean
  onClose: () => void
  onPick: (model: ModelInfo) => void
  currentId?: string
}) {
  const t = useT()
  const catalog = useAppStore((s) => s.catalog) as CatalogSnapshot | null
  const [query, setQuery] = useState('')
  const [favorites, setFavorites] = useState<string[]>(loadFavorites)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const providerName = (id: string) => catalog?.providers.find((p) => p.id === id)?.name ?? id

  const searching = query.trim().length > 0

  const results = useMemo(() => {
    const models = catalog?.models ?? []
    const q = query.trim().toLowerCase()
    if (!q) return []
    return models
      .filter((m) => `${m.name} ${m.id} ${providerName(m.providerId)}`.toLowerCase().includes(q))
      .slice(0, SEARCH_CAP)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, query])

  const groups = useMemo(() => {
    if (!catalog) return []
    const favoriteModels = favorites
      .map((id) => catalog.models.find((m) => m.id === id))
      .filter((m): m is ModelInfo => !!m)
    const sections: Array<{ provider: ProviderInfo | null; models: ModelInfo[] }> = []
    if (favoriteModels.length && !searching) sections.push({ provider: null, models: favoriteModels })
    for (const provider of catalog.providers) {
      const models = catalog.models.filter((m) => m.providerId === provider.id)
      if (!models.length) continue
      if (searching) continue
      sections.push({ provider, models })
    }
    return sections
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, favorites, searching])

  const toggleFavorite = (id: string) => {
    setFavorites((prev) => {
      const next = prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id]
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(next))
      return next
    })
  }

  const pick = (m: ModelInfo) => {
    onPick(m)
    onClose()
  }

  return (
    <Sheet open={open} onClose={onClose} title={t('select_model')}>
      <div className="search-row">
        <Search size={14} style={{ color: 'var(--v2-icon-muted)', flex: '0 0 auto' }} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('model_search')}
          style={{ minWidth: 0 }}
        />
        {searching ? (
          <button className="icon-btn" onClick={() => setQuery('')} aria-label="clear">
            <X size={14} />
          </button>
        ) : null}
      </div>

      <div className="sheet-body">
        {searching ? (
          <>
            {results.map((m) => (
              <PickRow
                key={m.id}
                model={m}
                providerName={providerName(m.providerId)}
                selected={m.id === currentId}
                favorite={favorites.includes(m.id)}
                onToggleFavorite={() => toggleFavorite(m.id)}
                onPick={() => pick(m)}
              />
            ))}
            {!results.length ? <div className="hint" style={{ padding: 20, textAlign: 'center' }}>{t('model_none')}</div> : null}
          </>
        ) : (
          groups.map(({ provider, models }) => {
            const isOpen = provider ? expanded[provider.id] : true
            const shown = isOpen ? models : models.slice(0, PREVIEW_ROWS)
            return (
              <div key={provider?.id ?? 'favorites'}>
                <div className="pick-group">
                  {provider ? (
                    <span
                      className="sb-avatar"
                      style={{ background: 'linear-gradient(180deg, #ffffff29, #ffffff00), var(--v2-bg-layer-04)' }}
                    >
                      {provider.name.slice(0, 1).toUpperCase()}
                    </span>
                  ) : (
                    <Star size={12} style={{ color: 'var(--v2-state-warning-fg)' }} />
                  )}
                  {provider?.name ?? t('model_favorites')}
                </div>
                {shown.map((m) => (
                  <PickRow
                    key={m.id}
                    model={m}
                    providerName={provider?.name ?? providerName(m.providerId)}
                    selected={m.id === currentId}
                    favorite={favorites.includes(m.id)}
                    onToggleFavorite={() => toggleFavorite(m.id)}
                    onPick={() => pick(m)}
                  />
                ))}
                {provider && models.length > PREVIEW_ROWS && !isOpen ? (
                  <button className="pick-more" onClick={() => setExpanded((prev) => ({ ...prev, [provider.id]: true }))}>
                    {t('model_show_more', { count: models.length - PREVIEW_ROWS })}
                  </button>
                ) : null}
                {provider && isOpen && models.length > PREVIEW_ROWS ? (
                  <button className="pick-more" onClick={() => setExpanded((prev) => ({ ...prev, [provider.id]: false }))}>
                    {t('model_show_less')}
                  </button>
                ) : null}
              </div>
            )
          })
        )}
      </div>
    </Sheet>
  )
}

function PickRow({
  model,
  providerName,
  selected,
  favorite,
  onToggleFavorite,
  onPick,
}: {
  model: ModelInfo
  providerName: string
  selected: boolean
  favorite: boolean
  onToggleFavorite: () => void
  onPick: () => void
}) {
  const t = useT()
  return (
    <div className={`pick-row ${selected ? 'selected' : ''}`}>
      <button className="grow row" style={{ minWidth: 0, gap: 8, textAlign: 'left' }} onClick={onPick}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
          <span className="name">{model.name}</span>
          {model.free ? <span className="chip chip-green">free</span> : null}
          {model.reasoning ? <span className="chip chip-blue">R</span> : null}
          {!model.toolCall ? <span className="chip chip-amber">no tools</span> : null}
        </span>
        <span className="meta">{providerName}</span>
        {selected ? <Check size={14} style={{ color: 'var(--v2-icon-base)', flex: '0 0 auto' }} /> : null}
      </button>
      <button className="star-btn" onClick={onToggleFavorite} aria-label={t('model_favorite_toggle')}>
        <Star size={14} fill={favorite ? 'var(--v2-state-warning-fg)' : 'none'} style={{ color: favorite ? 'var(--v2-state-warning-fg)' : 'var(--v2-icon-faint)' }} />
      </button>
    </div>
  )
}
