/** Settings: language, workspace, default model, approvals, about. */
import { useEffect } from 'react'
import { FolderOpen, Globe, ShieldAlert, Zap } from 'lucide-react'
import { useT } from '../../i18n'
import { useAppStore } from '../../stores/app'
import { Badge, Button, Input, SectionTitle, Select, Toggle } from '../ui'
import { ModelPicker } from '../chat/Composer'
import { TELEGRAPH_NETWORKS } from '@shared/types'

export function SettingsView() {
  const t = useT()
  const app = useAppStore()
  const settings = app.settings

  useEffect(() => {
    if (!settings) void app.loadSettings()
  }, [settings, app])

  if (!settings) return null

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-6 space-y-7">
        <SectionTitle>{t('settings_title')}</SectionTitle>

        {/* language */}
        <section className="rounded-2xl border border-line bg-panel2 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Globe size={14} className="text-signal" />
            <span className="text-[13.5px] font-semibold">{t('settings_language')}</span>
          </div>
          <div className="flex gap-2">
            {(['en', 'vi'] as const).map((lang) => (
              <button
                key={lang}
                onClick={() => void app.setSettings({ language: lang })}
                className={`px-4 py-2 rounded-xl border text-[13px] cursor-pointer transition-colors ${
                  settings.language === lang ? 'border-signal/60 bg-signal/10 text-ink' : 'border-line text-muted hover:border-line2'
                }`}
              >
                {lang === 'en' ? '🇬🇧 English' : '🇻🇳 Tiếng Việt'}
              </button>
            ))}
          </div>
        </section>

        {/* workspace */}
        <section className="rounded-2xl border border-line bg-panel2 p-4">
          <div className="flex items-center gap-2 mb-2">
            <FolderOpen size={14} className="text-signal" />
            <span className="text-[13.5px] font-semibold">{t('settings_workspace')}</span>
            {app.workspace.isGit ? <Badge color="#4ADE80">git</Badge> : null}
          </div>
          <p className="text-[12px] text-muted mb-3">{t('settings_workspace_hint')}</p>
          <div className="flex gap-2">
            <Input readOnly value={app.workspace.workspace} className="font-mono !text-xs" />
            <Button onClick={() => void app.pickWorkspace()}>{t('pick_workspace')}</Button>
          </div>
        </section>

        {/* default model */}
        <section className="rounded-2xl border border-line bg-panel2 p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[13.5px] font-semibold">{t('settings_default_model')}</span>
            <Badge color="#FF7A3E">{settings.defaultModelId.split('/').pop()}</Badge>
          </div>
          <ModelPicker value={settings.defaultModelId} onChange={(id) => void app.setSettings({ defaultModelId: id })} />
        </section>

        {/* approvals */}
        <section className="rounded-2xl border border-line bg-panel2 p-4">
          <div className="flex items-center gap-2 mb-3">
            <ShieldAlert size={14} className="text-amber" />
            <span className="text-[13.5px] font-semibold">{t('approval_title')}</span>
          </div>
          <Toggle checked={settings.autoApproveAll} onChange={(v) => void app.setSettings({ autoApproveAll: v })} label={t('settings_autoapprove')} />
          <p className="text-[11px] text-faint mt-2.5">{t('settings_restart_note')}</p>
        </section>

        {/* telegraph network */}
        <section className="rounded-2xl border border-line bg-panel2 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Zap size={14} className="text-cyan" />
            <span className="text-[13.5px] font-semibold">{t('tg_network')}</span>
          </div>
          <Select
            value={settings.telegraph.networkId}
            onChange={(e) => void app.setSettings({ telegraph: { ...settings.telegraph, networkId: e.target.value } })}
            className="max-w-xs"
          >
            {Object.entries(TELEGRAPH_NETWORKS).map(([id, net]) => (
              <option key={id} value={id}>
                {net.label}
              </option>
            ))}
          </Select>
          <p className="text-[11px] text-faint mt-2 font-mono">
            chain {TELEGRAPH_NETWORKS[settings.telegraph.networkId]?.chainId} · USDC {TELEGRAPH_NETWORKS[settings.telegraph.networkId]?.usdcAddress.slice(0, 10)}…
          </p>
        </section>

        <div className="text-[11px] text-faint text-center pb-4">
          Halis Code v0.1.0 · local-first · TypeScript 7
        </div>
      </div>
    </div>
  )
}
