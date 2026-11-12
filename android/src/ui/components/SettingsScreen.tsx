/**
 * Settings — the desktop settings panel on a phone: one scrolling column of
 * hairline settings-lists (General / Models & keys / Telegraph / Security /
 * About), 24×16 switches, 13px titles with muted descriptions.
 */
import { useState } from 'react'
import { Check, ChevronRight, RefreshCw } from 'lucide-react'
import type { AppLanguage, AppTheme } from '@shared/types'
import { useAppStore } from '../stores/app'
import { useT } from '../i18n'
import { SectionTitle, SettingRow, Sheet, Switch, pushToast } from './ui'
import { ModelPicker } from './ModelPicker'
import { bridge } from '../lib/bridge'

export function SettingsScreen() {
  const t = useT()
  const settings = useAppStore((s) => s.settings)
  const setSettings = useAppStore((s) => s.setSettings)
  const catalog = useAppStore((s) => s.catalog)
  const keyStatus = useAppStore((s) => s.keyStatus)
  const loadKeyStatus = useAppStore((s) => s.loadKeyStatus)
  const loadCatalog = useAppStore((s) => s.loadCatalog)
  const workspace = useAppStore((s) => s.workspace)
  const pickWorkspace = useAppStore((s) => s.pickWorkspace)
  const [keyProvider, setKeyProvider] = useState<string | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [testing, setTesting] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<Record<string, string>>({})
  const [pickerOpen, setPickerOpen] = useState(false)

  const groups = (catalog?.providers ?? [])
    .map((provider) => ({ provider, models: (catalog?.models ?? []).filter((m) => m.providerId === provider.id) }))
    .filter((g) => g.models.length > 0)
  const defaultModel = catalog?.models.find((m) => m.id === settings?.defaultModelId)

  return (
    <>
      <div className="settings-body">
        {/* General */}
        <div className="settings-section">
          <SectionTitle>{t('sec_general')}</SectionTitle>
          <div className="settings-list">
            <SettingRow label={t('settings_language')}>
              <select
                className="field"
                style={{ width: 130, minHeight: 32 }}
                value={settings?.language ?? 'en'}
                onChange={(e) => void setSettings({ language: e.target.value as AppLanguage })}
              >
                <option value="en">{t('lang_en')}</option>
                <option value="vi">{t('lang_vi')}</option>
              </select>
            </SettingRow>
            <SettingRow label={t('settings_theme')} hint={t('settings_theme_hint')}>
              <select
                className="field"
                style={{ width: 110, minHeight: 32 }}
                value={settings?.theme ?? 'light'}
                onChange={(e) => void setSettings({ theme: e.target.value as AppTheme })}
              >
                <option value="light">{t('theme_light')}</option>
                <option value="dark">{t('theme_dark')}</option>
              </select>
            </SettingRow>
            <SettingRow label={t('settings_default_model')} hint={defaultModel?.name ?? t('none')} onClick={() => setPickerOpen(true)}>
              <ChevronRight size={16} style={{ color: 'var(--v2-icon-faint)' }} />
            </SettingRow>
            <SettingRow label={t('workspace_label')} hint={workspace.exists ? workspace.workspace : t('no_workspace')} onClick={() => void pickWorkspace()}>
              <ChevronRight size={16} style={{ color: 'var(--v2-icon-faint)' }} />
            </SettingRow>
          </div>
        </div>

        {/* Models & keys */}
        <div className="settings-section">
          <SectionTitle>{t('sec_models')}</SectionTitle>
          <div className="settings-list">
            {groups.map(({ provider, models }) => {
              const hasKey = keyStatus[provider.id]
              return (
                <SettingRow
                  key={provider.id}
                  label={provider.name}
                  hint={
                    provider.note ??
                    (provider.keyless
                      ? t('key_optional')
                      : hasKey
                        ? `${t('key_saved')} · ${models.length} ${t('models_count')}`
                        : `${t('key_needed')} · ${models.length} ${t('models_count')}`)
                  }
                  onClick={() => {
                    if (provider.keyless) return
                    setKeyProvider(provider.id)
                    setKeyInput('')
                  }}
                >
                  {provider.keyless ? (
                    <span className="chip chip-green">{t('key_optional')}</span>
                  ) : hasKey ? (
                    <Check size={16} style={{ color: 'var(--v2-state-success-fg)' }} />
                  ) : (
                    <span className="chip chip-amber">{t('add')}</span>
                  )}
                </SettingRow>
              )
            })}
            <SettingRow label={t('catalog_refresh')} hint={catalog ? `${catalog.models.length} ${t('models_count')} · ${catalog.source}` : undefined}>
              <button className="icon-btn" onClick={() => void loadCatalog().then(() => pushToast(t('catalog_updated')))} aria-label="refresh">
                <RefreshCw size={16} />
              </button>
            </SettingRow>
          </div>
        </div>

        {/* Telegraph */}
        <div className="settings-section">
          <SectionTitle>{t('sec_telegraph')}</SectionTitle>
          <div className="settings-list">
            <SettingRow label={t('settings_telegraph_toggle')} hint={t('settings_telegraph_toggle_hint')}>
              <Switch on={settings?.telegraphEnabled !== false} onChange={(next) => void setSettings({ telegraphEnabled: next })} />
            </SettingRow>
            <SettingRow label={t('tg_budget')}>
              <input
                className="field"
                style={{ width: 90, minHeight: 32 }}
                type="number"
                min={0}
                step="0.5"
                value={settings?.telegraph.dailyBudgetUsd ?? 0}
                onChange={(e) =>
                  void setSettings({ telegraph: { ...(settings?.telegraph ?? { networkId: 'base-sepolia', autoApproveUpTo: 0, dailyBudgetUsd: 0 }), dailyBudgetUsd: Number(e.target.value) || 0 } })
                }
              />
            </SettingRow>
            <SettingRow label={t('tg_autoapprove')}>
              <input
                className="field"
                style={{ width: 90, minHeight: 32 }}
                type="number"
                min={0}
                step="0.01"
                value={settings?.telegraph.autoApproveUpTo ?? 0}
                onChange={(e) =>
                  void setSettings({ telegraph: { ...(settings?.telegraph ?? { networkId: 'base-sepolia', autoApproveUpTo: 0, dailyBudgetUsd: 0 }), autoApproveUpTo: Number(e.target.value) || 0 } })
                }
              />
            </SettingRow>
          </div>
        </div>

        {/* Security */}
        <div className="settings-section">
          <SectionTitle>{t('sec_security')}</SectionTitle>
          <div className="settings-list">
            <SettingRow label={t('settings_autoapprove')}>
              <Switch on={settings?.autoApproveAll ?? false} onChange={(next) => void setSettings({ autoApproveAll: next })} />
            </SettingRow>
            <SettingRow
              label={t('settings_websearch')}
              hint={t('settings_websearch_hint')}
              onClick={() => {
                const key = prompt('Tavily API key')
                if (key !== null) void setSettings({ tavilyApiKey: key.trim() || undefined })
              }}
            >
              <span className={`chip ${settings?.tavilyApiKey ? 'chip-green' : ''}`}>{settings?.tavilyApiKey ? 'Tavily' : 'DuckDuckGo'}</span>
            </SettingRow>
          </div>
        </div>

        {/* About */}
        <div className="settings-section">
          <SectionTitle>Halis Code</SectionTitle>
          <div className="card">
            <div style={{ fontWeight: 530 }}>v0.3.0 · Android</div>
            <div className="hint" style={{ marginTop: 6 }}>{t('mobile_only_note')}</div>
            <div className="hint" style={{ marginTop: 6 }}>{t('memory_note')}</div>
            <div className="hint" style={{ marginTop: 6 }}>© mhieuhonda · MIT</div>
          </div>
        </div>
      </div>

      {/* key editor */}
      <Sheet open={!!keyProvider} onClose={() => setKeyProvider(null)} title={catalog?.providers.find((p) => p.id === keyProvider)?.name ?? ''}>
        <input className="field" style={{ fontFamily: 'var(--font-mono)' }} placeholder={t('enter_key')} value={keyInput} onChange={(e) => setKeyInput(e.target.value)} />
        <div className="hint" style={{ marginTop: 6 }}>
          {catalog?.providers.find((p) => p.id === keyProvider)?.docs ? (
            <a href={catalog.providers.find((p) => p.id === keyProvider)?.docs} target="_blank" rel="noopener" style={{ color: 'var(--v2-text-accent)' }}>
              {t('get_key')}
            </a>
          ) : (
            t('enter_key_hint')
          )}
        </div>
        <div className="row" style={{ gap: 6, marginTop: 12 }}>
          {keyProvider ? (
            <button
              className="btn btn-ghost btn-sm"
              disabled={testing === keyProvider}
              onClick={() => {
                const model = catalog?.models.find((m) => m.providerId === keyProvider)
                if (!model) return
                setTesting(keyProvider)
                void bridge
                  .modelTestKey(model.id, keyInput.trim() || undefined)
                  .then((res) => {
                    setTestResult((prev) => ({ ...prev, [keyProvider]: res.detail.slice(0, 120) }))
                  })
                  .finally(() => setTesting(null))
              }}
            >
              {testing === keyProvider ? <span className="spinner" /> : null}
              {t('test_model')}
            </button>
          ) : null}
          <button
            className="btn btn-contrast btn-sm grow"
            disabled={!keyInput.trim() || !keyProvider}
            onClick={() => {
              if (!keyProvider) return
              void bridge
                .modelSaveKey(keyProvider, keyInput.trim())
                .then(() => loadKeyStatus())
                .then(() => {
                  pushToast(t('key_saved'))
                  setKeyProvider(null)
                })
            }}
          >
            {t('save_key')}
          </button>
          {keyStatus[keyProvider ?? ''] ? (
            <button
              className="btn btn-danger btn-sm"
              onClick={() => {
                if (!keyProvider) return
                void bridge.modelRemoveKey(keyProvider).then(() => loadKeyStatus()).then(() => setKeyProvider(null))
              }}
            >
              {t('remove_key')}
            </button>
          ) : null}
        </div>
        {keyProvider && testResult[keyProvider] ? <div className="hint" style={{ marginTop: 8 }}>{testResult[keyProvider]}</div> : null}
      </Sheet>

      <ModelPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        currentId={settings?.defaultModelId}
        onPick={(m) => {
          void setSettings({ defaultModelId: m.id })
        }}
      />
    </>
  )
}
