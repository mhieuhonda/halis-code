/** Settings: appearance, language, workspace, default model, approvals, MCP servers, web search, telegraph master switch, about. */
import { useEffect, useState } from 'react'
import { FolderOpen, Globe, Moon, Plug, Plus, Scissors, ShieldAlert, Sun, Trash2, Zap, ZapOff } from 'lucide-react'
import { useT } from '../../i18n'
import { useAppStore } from '../../stores/app'
import { bridge } from '../../lib/ipc'
import { Badge, Button, Input, SectionTitle, Select, Toggle } from '../ui'
import { ModelPicker } from '../chat/Composer'
import { TELEGRAPH_NETWORKS } from '@shared/types'
import type { AppTheme, McpServerConfig, McpServerStatus } from '@shared/types'

export function SettingsView() {
  const t = useT()
  const app = useAppStore()
  const settings = app.settings
  const [mcpStatuses, setMcpStatuses] = useState<McpServerStatus[]>([])

  useEffect(() => {
    if (!settings) void app.loadSettings()
  }, [settings, app])

  useEffect(() => {
    void bridge.mcpStatuses().then(setMcpStatuses)
    const onMcp = (event: Event) => setMcpStatuses((event as CustomEvent<McpServerStatus[]>).detail ?? [])
    window.addEventListener('halis:mcp', onMcp)
    return () => window.removeEventListener('halis:mcp', onMcp)
  }, [])

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

        {/* appearance */}
        <section className="rounded-2xl border border-line bg-panel2 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Sun size={14} className="text-signal" />
            <span className="text-[13.5px] font-semibold">{t('settings_theme')}</span>
            <Badge color="#81858c">{(settings.theme ?? 'light') === 'dark' ? t('theme_dark') : t('theme_light')}</Badge>
          </div>
          <p className="text-[12px] text-muted mb-3">{t('settings_theme_hint')}</p>
          <div className="flex gap-2">
            {([
              ['light', Sun],
              ['dark', Moon],
            ] as const).map(([value, Icon]) => (
              <button
                key={value}
                onClick={() => void app.setSettings({ theme: value as AppTheme })}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-[13px] cursor-pointer transition-colors ${
                  (settings.theme ?? 'light') === value ? 'border-signal/60 bg-signal/10 text-ink' : 'border-line text-muted hover:border-line2'
                }`}
              >
                <Icon size={14} />
                {value === 'light' ? t('theme_light') : t('theme_dark')}
              </button>
            ))}
          </div>
        </section>

        {/* workspace */}
        <section className="rounded-2xl border border-line bg-panel2 p-4">
          <div className="flex items-center gap-2 mb-2">
            <FolderOpen size={14} className="text-signal" />
            <span className="text-[13.5px] font-semibold">{t('settings_workspace')}</span>
            {app.workspace.isGit ? <Badge color="#22c55e">git</Badge> : null}
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
            <Badge color="#f59e0b">{settings.defaultModelId?.split('/').pop()}</Badge>
          </div>
          <ModelPicker value={settings.defaultModelId} onChange={(id) => void app.setSettings({ defaultModelId: id })} />
        </section>

        {/* MCP servers */}
        <McpSection configs={settings.mcpServers ?? []} statuses={mcpStatuses} onChange={(configs) => void app.setSettings({ mcpServers: configs })} />

        {/* web search */}
        <section className="rounded-2xl border border-line bg-panel2 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Globe size={14} className="text-signal" />
            <span className="text-[13.5px] font-semibold">{t('settings_websearch')}</span>
          </div>
          <p className="text-[12px] text-muted mb-3">{t('settings_websearch_hint')}</p>
          <Input
            type="password"
            placeholder="TAVILY_API_KEY (optional)"
            value={settings.tavilyApiKey ?? ''}
            onChange={(e) => void app.setSettings({ tavilyApiKey: e.target.value })}
            className="font-mono !text-xs"
          />
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

        {/* ponytail */}
        <section className={`rounded-2xl border p-4 ${settings.ponytailEnabled ? 'border-signal/40 bg-signal/5' : 'border-line bg-panel2'}`}>
          <div className="flex items-center gap-2 mb-2">
            <Scissors size={14} className={settings.ponytailEnabled ? 'text-signal' : 'text-muted'} />
            <span className="text-[13.5px] font-semibold">{t('settings_ponytail')}</span>
            <Badge color={settings.ponytailEnabled ? '#3ED598' : '#81858c'}>{settings.ponytailEnabled ? 'on' : 'off'}</Badge>
          </div>
          <p className="text-[12px] text-muted mb-3 leading-relaxed">{t('settings_ponytail_hint')}</p>
          <Toggle checked={settings.ponytailEnabled === true} onChange={(v) => void app.setSettings({ ponytailEnabled: v })} label={t('settings_ponytail')} />
          <p className="text-[11px] text-faint mt-2.5">{t('settings_restart_note')}</p>
        </section>

        {/* telegraph master switch */}
        <section className={`rounded-2xl border p-4 ${settings.telegraphEnabled === false ? 'border-amber/40 bg-amber/5' : 'border-line bg-panel2'}`}>
          <div className="flex items-center gap-2 mb-2">
            {settings.telegraphEnabled === false ? <ZapOff size={14} className="text-amber" /> : <Zap size={14} className="text-cyan" />}
            <span className="text-[13.5px] font-semibold">{t('settings_telegraph_toggle')}</span>
            <Badge color={settings.telegraphEnabled === false ? '#f59e0b' : '#3ED598'}>{settings.telegraphEnabled === false ? 'off' : 'on'}</Badge>
          </div>
          <p className="text-[12px] text-muted mb-3 leading-relaxed">{t('settings_telegraph_toggle_hint')}</p>
          <Toggle
            checked={settings.telegraphEnabled !== false}
            onChange={(v) => void app.setSettings({ telegraphEnabled: v })}
            label={t('settings_telegraph_toggle')}
          />
          <p className="text-[11px] text-faint mt-2.5 font-mono">
            chain {TELEGRAPH_NETWORKS[settings.telegraph.networkId]?.chainId} · USDC {TELEGRAPH_NETWORKS[settings.telegraph.networkId]?.usdcAddress.slice(0, 10)}… · {TELEGRAPH_NETWORKS[settings.telegraph.networkId]?.label}
          </p>
        </section>

        {/* telegraph network */}
        {settings.telegraphEnabled !== false ? (
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
        ) : null}

        <div className="text-[11px] text-faint text-center pb-4">
          Halis Code v0.3.0 · local-first · TypeScript 7
        </div>
      </div>
    </div>
  )
}

function McpSection({ configs, statuses, onChange }: { configs: McpServerConfig[]; statuses: McpServerStatus[]; onChange: (configs: McpServerConfig[]) => void }) {
  const t = useT()
  const [testing, setTesting] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<Record<string, string>>({})

  const update = (index: number, patch: Partial<McpServerConfig>) => {
    onChange(configs.map((c, i) => (i === index ? { ...c, ...patch } : c)))
  }

  const test = async (config: McpServerConfig) => {
    setTesting(config.name)
    try {
      const result = await bridge.mcpTest(config)
      setTestResult((prev) => ({ ...prev, [config.name]: `${result.ok ? '✓' : '✗'} ${result.detail}` }))
    } catch (err) {
      setTestResult((prev) => ({ ...prev, [config.name]: `✗ ${err instanceof Error ? err.message : String(err)}` }))
    } finally {
      setTesting(null)
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-panel2 p-4">
      <div className="flex items-center gap-2 mb-2">
        <Plug size={14} className="text-signal" />
        <span className="text-[13.5px] font-semibold">{t('mcp_title')}</span>
        <Badge color="#81858c">MCP</Badge>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          onClick={() =>
            onChange([
              ...configs,
              { name: `server-${configs.length + 1}`, command: '', args: [], enabled: false },
            ])
          }
        >
          <Plus size={12} /> {t('mcp_add')}
        </Button>
      </div>
      <p className="text-[12px] text-muted mb-3">{t('mcp_hint')}</p>
      {configs.length === 0 ? <p className="text-[11.5px] text-faint">{t('mcp_empty')}</p> : null}
      <div className="space-y-3">
        {configs.map((config, index) => {
          const status = statuses.find((s) => s.name === config.name)
          return (
            <div key={index} className="rounded-xl border border-line bg-panel/60 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Input value={config.name} onChange={(e) => update(index, { name: e.target.value })} className="!text-xs max-w-[180px]" placeholder="name" />
                <Toggle checked={config.enabled} onChange={(v) => update(index, { enabled: v })} label={t('mcp_enabled')} />
                <Button size="sm" variant="danger" className="ml-auto" onClick={() => onChange(configs.filter((_, i) => i !== index))}>
                  <Trash2 size={12} />
                </Button>
              </div>
              <div className="flex gap-2">
                <Select value={config.url !== undefined && !config.command ? 'url' : 'stdio'} onChange={(e) => update(index, e.target.value === 'url' ? { url: '', command: undefined } : { command: '', url: undefined })} className="!text-xs max-w-[110px]">
                  <option value="stdio">stdio</option>
                  <option value="url">HTTP</option>
                </Select>
                {config.url !== undefined && !config.command ? (
                  <Input value={config.url} onChange={(e) => update(index, { url: e.target.value })} className="font-mono !text-xs flex-1" placeholder="https://server.example.com/mcp" />
                ) : (
                  <>
                    <Input value={config.command ?? ''} onChange={(e) => update(index, { command: e.target.value })} className="font-mono !text-xs flex-1" placeholder="npx" />
                    <Input
                      value={(config.args ?? []).join(' ')}
                      onChange={(e) => update(index, { args: e.target.value.split(' ').filter(Boolean) })}
                      className="font-mono !text-xs flex-1"
                      placeholder="-y @modelcontextprotocol/server-filesystem /path"
                    />
                  </>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="default" onClick={() => void test(config)} disabled={testing === config.name}>
                  {t('mcp_test')}
                </Button>
                {status ? (
                  <Badge color={status.connected ? '#3ED598' : '#FF6B7A'}>
                    {status.connected ? `${status.toolCount} tools` : 'offline'}
                  </Badge>
                ) : null}
                {testResult[config.name] ? <span className="text-[11px] text-faint truncate">{testResult[config.name]}</span> : null}
              </div>
            </div>
          )
        })}
      </div>
      <p className="text-[11px] text-faint mt-3">{t('mcp_save_note')}</p>
      {configs.length ? (
        <Button size="sm" className="mt-2" onClick={() => void bridge.mcpSetServers(configs)}>
          {t('mcp_apply')}
        </Button>
      ) : null}
    </section>
  )
}
