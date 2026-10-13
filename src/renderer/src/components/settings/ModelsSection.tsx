/** Models & API keys — settings section. Provider keys, default model,
 *  and a searchable catalog browser. */
import { useEffect, useMemo, useState } from 'react'
import { Check, Eye, EyeOff, KeyRound, RefreshCw, Search, Star, Zap } from 'lucide-react'
import type { ModelInfo, ProviderInfo } from '@shared/types'
import { useT } from '../../i18n'
import { useAppStore } from '../../stores/app'
import { Badge, Button, Input, Spinner } from '../ui'
import { ModelPicker } from '../chat/Composer'

export function KeyBox({ provider }: { provider: ProviderInfo }) {
  const t = useT()
  const { loadKeyStatus } = useAppStore()
  const [key, setKey] = useState('')
  const [visible, setVisible] = useState(false)
  const [state, setState] = useState<'idle' | 'saving' | 'ok' | 'error'>('idle')

  const save = async () => {
    if (!key.trim()) return
    setState('saving')
    try {
      await window.halis.modelSaveKey(provider.id, key.trim())
      await loadKeyStatus()
      setState('ok')
      setKey('')
      setTimeout(() => setState('idle'), 2000)
    } catch {
      // A failed save must not leave the button stuck on its spinner.
      setState('error')
      setTimeout(() => setState('idle'), 2500)
    }
  }

  const remove = async () => {
    try {
      await window.halis.modelRemoveKey(provider.id)
      await loadKeyStatus()
      setState('idle')
    } catch {
      setState('error')
      setTimeout(() => setState('idle'), 2500)
    }
  }

  const hasKey = useAppStore((s) => !!s.keyStatus[provider.id] && !provider.keyless)

  return (
    <div className="mt-2.5 pt-2.5 border-t border-line/70">
      {provider.keyless ? (
        <div className="flex items-center gap-2 text-[12px] text-good">
          <Zap size={12} /> {t('key_optional')}
        </div>
      ) : hasKey ? (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1.5 text-[12px] text-good">
            <Check size={12} /> {t('key_saved')}
          </span>
          <Button size="sm" variant="ghost" onClick={() => void remove()}>
            {t('remove_key')}
          </Button>
        </div>
      ) : (
        <div>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                type={visible ? 'text' : 'password'}
                value={key}
                placeholder={provider.envKey ? `${t('enter_key')} · ${provider.envKey}` : t('enter_key')}
                onChange={(e) => setKey(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void save()
                }}
                className="!py-1.5 !text-xs pr-8"
              />
              <button className="absolute right-2 top-1/2 -translate-y-1/2 text-faint hover:text-muted cursor-pointer" onClick={() => setVisible(!visible)}>
                {visible ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>
            <Button size="sm" onClick={() => void save()} disabled={!key.trim() || state === 'saving'}>
              {state === 'saving' ? <Spinner size={12} /> : state === 'ok' ? <Check size={13} /> : null}
              {state === 'ok' ? t('key_saved') : t('save_key')}
            </Button>
          </div>
          <div className="mt-1.5 flex items-center gap-2 text-[11px]">
            {provider.freeKey ? <span className="text-good">{t('provider_note_free_key')}</span> : null}
            {provider.docs ? (
              <a
                className="text-cyan hover:underline cursor-pointer"
                onClick={(e) => {
                  e.preventDefault()
                  window.open(provider.docs, '_blank', 'noopener')
                }}
              >
                {t('get_key')} ↗
              </a>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}

function ModelRow({ model, isDefault, onSetDefault }: { model: ModelInfo; isDefault: boolean; onSetDefault: () => void }) {
  const [testState, setTestState] = useState<'idle' | 'testing' | 'ok' | 'bad'>('idle')
  const [detail, setDetail] = useState('')
  const t = useT()

  const test = async () => {
    setTestState('testing')
    const result = (await window.halis.modelTestKey(model.id)) as { ok: boolean; detail: string }
    setTestState(result.ok ? 'ok' : 'bad')
    setDetail(result.detail)
  }

  return (
    <div className="flex items-center gap-3 px-3.5 py-2.5 hover:bg-panel2/60 transition-colors group">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium truncate">{model.name}</span>
          {model.free ? <Badge color="#22c55e">free</Badge> : null}
          {model.reasoning ? <Badge>reasoning</Badge> : null}
          {model.toolCall ? null : <Badge color="#f59e0b">no tools</Badge>}
          {isDefault ? <Badge color="#8b5cf6">{t('default_badge')}</Badge> : null}
        </div>
        <div className="text-[11px] text-faint font-mono truncate">{model.id}</div>
        {testState !== 'idle' && testState !== 'testing' ? (
          <div className={`text-[11px] mt-0.5 ${testState === 'ok' ? 'text-good' : 'text-red'} font-mono break-all`}>
            {testState === 'ok' ? '✓ ' : '✗ '}
            {detail.slice(0, 160)}
          </div>
        ) : null}
      </div>
      <div className="flex items-center gap-2.5 shrink-0">
        {model.contextWindow ? (
          <span className="text-[10.5px] text-faint hidden sm:inline">
            {(model.contextWindow / 1000).toFixed(0)}k {t('context_window')}
          </span>
        ) : null}
        {model.costPerMTok ? (
          <span className="text-[10.5px] text-faint hidden md:inline font-mono">
            ${model.costPerMTok.input}/${model.costPerMTok.output} Mtok
          </span>
        ) : null}
        <Button size="sm" variant="ghost" onClick={() => void test()} className="opacity-0 group-hover:opacity-100 transition-opacity">
          {testState === 'testing' ? <Spinner size={11} /> : t('test_model')}
        </Button>
        {isDefault ? (
          <Star size={13} className="text-amber fill-amber" />
        ) : (
          <button className="opacity-0 group-hover:opacity-100 text-faint hover:text-amber cursor-pointer transition-opacity" title={t('set_default')} onClick={onSetDefault}>
            <Star size={13} />
          </button>
        )}
      </div>
    </div>
  )
}

export function ModelsSection() {
  const t = useT()
  const { catalog, loadCatalog, loadKeyStatus, settings, setSettings } = useAppStore()
  const [query, setQuery] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    if (!catalog) void loadCatalog()
    void loadKeyStatus()
  }, [])

  const groups = useMemo(() => {
    if (!catalog) return []
    const q = query.trim().toLowerCase()
    const match = (m: ModelInfo) => !q || m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)
    return catalog.providers
      .map((p) => ({
        provider: p,
        models: catalog.models
          .filter((m) => m.providerId === p.id)
          .filter(match)
          .sort((a, b) => Number(b.free) - Number(a.free) || a.name.localeCompare(b.name)),
      }))
      .filter((g) => g.models.length > 0)
  }, [catalog, query])

  const refresh = async () => {
    setRefreshing(true)
    await loadCatalog()
    setRefreshing(false)
  }

  return (
    <div className="space-y-4">
      {/* default model */}
      <section className="rounded-2xl border border-line bg-panel2 p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[13.5px] font-semibold">{t('settings_default_model')}</span>
          {settings?.defaultModelId ? <Badge color="#f59e0b">{settings.defaultModelId.split('/').pop()}</Badge> : null}
        </div>
        <ModelPicker value={settings?.defaultModelId ?? ''} direction="down" onChange={(id) => void setSettings({ defaultModelId: id })} />
      </section>

      {/* provider keys */}
      <section className="rounded-2xl border border-line bg-panel2 p-4">
        <div className="flex items-center gap-2 mb-3">
          <KeyRound size={14} className="text-signal" />
          <span className="text-[13.5px] font-semibold">{t('settings_keys_title')}</span>
        </div>
        <p className="text-[12px] text-muted mb-3">{t('models_subtitle')}</p>
        <div className="rounded-xl border border-line divide-y divide-line/60 overflow-hidden">
          {catalog?.providers
            .filter((p) => !p.keyless)
            .map((p) => (
              <div key={p.id} className="px-3.5 py-3">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium">{p.name}</span>
                  {p.freeKey ? <Badge color="#22c55e">free key</Badge> : null}
                  {p.note ? <span className="text-[11px] text-faint truncate">{p.note}</span> : null}
                </div>
                <KeyBox provider={p} />
              </div>
            ))}
        </div>
      </section>

      {/* catalog browser */}
      <section className="rounded-2xl border border-line bg-panel2 p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[13.5px] font-semibold">{t('settings_catalog_title')}</span>
          <span className="text-[11px] text-faint font-mono">
            {catalog ? `${catalog.models.length} ${t('models_count')} · ${catalog.source}` : ''}
          </span>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => void refresh()}>
            {refreshing ? <Spinner size={12} /> : <RefreshCw size={13} />}
            {t('catalog_refresh')}
          </Button>
        </div>
        <div className="relative mb-3">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('model_search')} className="!pl-9" />
        </div>
        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g.provider.id}>
              <div className="flex items-baseline gap-2 mb-1.5 px-1">
                <h4 className="text-[12.5px] font-semibold">{g.provider.name}</h4>
                <span className="text-[11px] text-faint">{g.models.length}</span>
              </div>
              <div className="rounded-xl border border-line divide-y divide-line/60 overflow-hidden">
                {g.models.slice(0, 40).map((m) => (
                  <ModelRow
                    key={m.id}
                    model={m}
                    isDefault={settings?.defaultModelId === m.id}
                    onSetDefault={() => void setSettings({ defaultModelId: m.id })}
                  />
                ))}
                {g.models.length > 40 ? (
                  <div className="px-3.5 py-2 text-[11px] text-faint">{t('model_more', { n: g.models.length - 40 })}</div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
