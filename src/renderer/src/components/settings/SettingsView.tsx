/** Settings — two-pane layout: sticky section nav on the left, tidy cards on
 *  the right. Sections: General, Workspace, Models & API keys, Integrations,
 *  Security, Telegraph. */
import { useEffect, useState } from 'react'
import {
  Cpu,
  FolderOpen,
  Moon,
  Plug,
  Plus,
  ShieldAlert,
  SlidersHorizontal,
  Sun,
  Trash2,
  Zap,
  ZapOff,
} from 'lucide-react'
import { useT } from '../../i18n'
import { useAppStore } from '../../stores/app'
import { bridge } from '../../lib/ipc'
import { Badge, Button, Input, Select, Toggle } from '../ui'
import { ModelsSection } from './ModelsSection'
import { TELEGRAPH_NETWORKS } from '@shared/types'
import type { AppTheme, McpServerConfig, McpServerStatus } from '@shared/types'

type SectionId = 'general' | 'workspace' | 'models' | 'integrations' | 'security' | 'telegraph'

/** Settings — section shell: one titled card block. */
function Card({ title, hint, children, accent }: { title: string; hint?: string; children: React.ReactNode; accent?: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-panel2 p-4">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[13.5px] font-semibold">{title}</span>
        {accent}
      </div>
      {hint ? <p className="text-[12px] text-muted mb-3 leading-relaxed">{hint}</p> : <div className="mb-3" />}
      {children}
    </section>
  )
}

/**
 * Input controlled by a LOCAL draft, committed on blur. Settings writes are
 * async IPC round-trips (file write + workspace scan) — an input whose value
 * comes straight from the store re-renders with the older snapshot while the
 * user types faster than the round-trip, silently eating characters.
 */
function DraftInput({ value, onCommit, ...rest }: { value: string; onCommit: (next: string) => void } & Omit<React.ComponentProps<'input'>, 'value' | 'onChange' | 'onBlur'>) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <Input
      {...(rest as object)}
      value={draft}
      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft)
      }}
    />
  )
}

export function SettingsView() {
  const t = useT()
  const app = useAppStore()
  const settings = app.settings
  const [mcpStatuses, setMcpStatuses] = useState<McpServerStatus[]>([])
  const [section, setSection] = useState<SectionId>('general')

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

  const sections: Array<{ id: SectionId; label: string; icon: React.ReactNode }> = [
    { id: 'general', label: t('sec_general'), icon: <SlidersHorizontal size={15} /> },
    { id: 'workspace', label: t('sec_workspace'), icon: <FolderOpen size={15} /> },
    { id: 'models', label: t('sec_models'), icon: <Cpu size={15} /> },
    { id: 'integrations', label: t('sec_integrations'), icon: <Plug size={15} /> },
    { id: 'security', label: t('sec_security'), icon: <ShieldAlert size={15} /> },
    { id: 'telegraph', label: t('sec_telegraph'), icon: <Zap size={15} /> },
  ]

  return (
    <div className="flex-1 overflow-hidden">
      <div className="max-w-4xl mx-auto px-6 py-6 h-full flex flex-col">
        <h2 className="text-base font-medium leading-6 mb-4 shrink-0">{t('settings_title')}</h2>
        <div className="flex gap-5 flex-1 min-h-0">
          {/* section nav */}
          <nav className="shrink-0 w-[176px] flex flex-col gap-0.5 overflow-y-auto">
            {sections.map((s) => (
              <button
                key={s.id}
                onClick={() => setSection(s.id)}
                className={`flex items-center gap-2.5 min-h-9 px-3 rounded-md text-[13px] text-left cursor-pointer bg-transparent border-none transition-colors duration-100 ${
                  section === s.id
                    ? 'text-ink bg-[var(--hal-specific-sidebar-nav-item-active)] font-medium'
                    : 'text-muted hover:text-ink hover:bg-[var(--hal-specific-sidebar-nav-item-hover)]'
                }`}
              >
                <span className={section === s.id ? 'text-[color:var(--hal-alias-state-business-primary)]' : 'text-[color:var(--hal-alias-label-tertiary)]'}>{s.icon}</span>
                <span className="truncate">{s.label}</span>
              </button>
            ))}
            <div className="mt-auto px-3 pt-4 text-[10.5px] text-faint leading-relaxed">
              Halis Code v0.3.0
              <br />
              local-first · TypeScript 7
            </div>
          </nav>

          {/* section content */}
          <div className="flex-1 min-w-0 overflow-y-auto pb-6">
            <div key={section} className="space-y-4 fade-in">
              {section === 'general' ? <GeneralSection /> : null}
              {section === 'workspace' ? <WorkspaceSection /> : null}
              {section === 'models' ? <ModelsSection /> : null}
              {section === 'integrations' ? <IntegrationsSection configs={settings.mcpServers ?? []} statuses={mcpStatuses} onChange={(configs) => void app.setSettings({ mcpServers: configs })} /> : null}
              {section === 'security' ? <SecuritySection /> : null}
              {section === 'telegraph' ? <TelegraphSection /> : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function GeneralSection() {
  const t = useT()
  const app = useAppStore()
  const settings = app.settings!
  return (
    <>
      <Card title={t('settings_language')}>
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
      </Card>

      <Card title={t('settings_theme')} hint={t('settings_theme_hint')} accent={<Badge color="#81858c">{(settings.theme ?? 'light') === 'dark' ? t('theme_dark') : t('theme_light')}</Badge>}>
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
      </Card>
    </>
  )
}

function WorkspaceSection() {
  const t = useT()
  const app = useAppStore()
  return (
    <Card title={t('settings_workspace')} hint={t('settings_workspace_hint')} accent={app.workspace.isGit ? <Badge color="#22c55e">git</Badge> : undefined}>
      <div className="flex gap-2">
        <Input readOnly value={app.workspace.workspace} className="font-mono !text-xs" />
        <Button onClick={() => void app.pickWorkspace()}>{t('pick_workspace')}</Button>
      </div>
    </Card>
  )
}

function IntegrationsSection({ configs, statuses, onChange }: { configs: McpServerConfig[]; statuses: McpServerStatus[]; onChange: (configs: McpServerConfig[]) => void }) {
  const t = useT()
  const app = useAppStore()
  const settings = app.settings!
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
    <>
      <Card title={t('mcp_title')} hint={t('mcp_hint')}>
        <div className="flex items-center gap-2 mb-3">
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
        {configs.length ? (
          <div className="mt-3 flex items-center gap-3">
            <Button size="sm" onClick={() => void bridge.mcpSetServers(configs)}>
              {t('mcp_apply')}
            </Button>
            <span className="text-[11px] text-faint">{t('mcp_save_note')}</span>
          </div>
        ) : null}
      </Card>

      <Card title={t('settings_websearch')} hint={t('settings_websearch_hint')}>
        <DraftInput
          type="password"
          placeholder="TAVILY_API_KEY (optional)"
          value={settings.tavilyApiKey ?? ''}
          onCommit={(next) => void app.setSettings({ tavilyApiKey: next })}
          className="font-mono !text-xs"
        />
      </Card>
    </>
  )
}

function SecuritySection() {
  const t = useT()
  const app = useAppStore()
  const settings = app.settings!
  return (
    <>
      <Card title={t('approval_title')}>
        <Toggle checked={settings.autoApproveAll} onChange={(v) => void app.setSettings({ autoApproveAll: v })} label={t('settings_autoapprove')} />
        <p className="text-[11px] text-faint mt-2.5">{t('settings_restart_note')}</p>
      </Card>

      <Card
        title={t('settings_ponytail')}
        hint={t('settings_ponytail_hint')}
        accent={<Badge color={settings.ponytailEnabled ? '#3ED598' : '#81858c'}>{settings.ponytailEnabled ? 'on' : 'off'}</Badge>}
      >
        <div className={settings.ponytailEnabled ? 'rounded-xl -m-1 p-1 border-[0.5px] border-signal/30 bg-signal/5' : ''}>
          <Toggle checked={settings.ponytailEnabled === true} onChange={(v) => void app.setSettings({ ponytailEnabled: v })} label={t('settings_ponytail')} />
          <p className="text-[11px] text-faint mt-2.5">{t('settings_restart_note')}</p>
        </div>
      </Card>
    </>
  )
}

function TelegraphSection() {
  const t = useT()
  const app = useAppStore()
  const settings = app.settings!
  const net = TELEGRAPH_NETWORKS[settings.telegraph.networkId]
  return (
    <>
      <Card
        title={t('settings_telegraph_toggle')}
        hint={t('settings_telegraph_toggle_hint')}
        accent={<Badge color={settings.telegraphEnabled === false ? '#f59e0b' : '#3ED598'}>{settings.telegraphEnabled === false ? 'off' : 'on'}</Badge>}
      >
        <div className="flex items-center gap-2.5 mb-1">
          {settings.telegraphEnabled === false ? <ZapOff size={15} className="text-amber" /> : <Zap size={15} className="text-cyan" />}
          <Toggle checked={settings.telegraphEnabled !== false} onChange={(v) => void app.setSettings({ telegraphEnabled: v })} label={t('settings_telegraph_toggle')} />
        </div>
      </Card>

      {settings.telegraphEnabled !== false ? (
        <Card title={t('tg_network')}>
          <Select
            value={settings.telegraph.networkId}
            onChange={(e) => void app.setSettings({ telegraph: { ...settings.telegraph, networkId: e.target.value } })}
            className="max-w-xs"
          >
            {Object.entries(TELEGRAPH_NETWORKS).map(([id, n]) => (
              <option key={id} value={id}>
                {n.label}
              </option>
            ))}
          </Select>
          <p className="text-[11px] text-faint mt-2 font-mono">
            chain {net?.chainId} · USDC {net?.usdcAddress.slice(0, 10)}…
          </p>
        </Card>
      ) : null}
    </>
  )
}
