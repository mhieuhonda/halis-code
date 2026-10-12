/** Swarm Setup — build the team: name, avatar, role, model, key, permissions, prompt. */
import { useEffect, useState } from 'react'
import { AlertTriangle, Check, ChevronDown, KeyRound, Plus, RefreshCw, Trash2, Wand2 } from 'lucide-react'
import type { AgentConfig } from '@shared/types'
import { useT } from '../../i18n'
import { useAppStore } from '../../stores/app'
import { useSwarmStore } from '../../stores/swarm'
import { Badge, Button, Input, Modal, Select, SectionTitle, Textarea, Toggle } from '../ui'
import { ModelPicker } from '../chat/Composer'

function AgentCard({ agent, index }: { agent: AgentConfig; index: number }) {
  const t = useT()
  const { updateAgent, removeAgent, regeneratePrompt, roles } = useSwarmStore()
  const catalog = useAppStore((s) => s.catalog)
  const keyStatus = useAppStore((s) => s.keyStatus)
  const [expanded, setExpanded] = useState(index < 2)
  const [keyDraft, setKeyDraft] = useState(agent.apiKey ?? '')
  const [dupWarn, setDupWarn] = useState<{ agentName: string; message: string } | null>(null)
  const [keyState, setKeyState] = useState<'idle' | 'testing' | 'ok' | 'bad'>('idle')

  const model = catalog?.models.find((m) => m.id === agent.modelId)
  const provider = catalog?.providers.find((p) => p.id === model?.providerId)
  const needsKey = !!provider && !provider.keyless
  // A provider key saved in Models & Keys covers this agent until a
  // per-agent key is entered — no forced re-entry in the swarm setup.
  const vaultHasKey = !!provider && !!(keyStatus[provider.id] ?? false)
  const role = roles.find((r) => r.id === agent.roleId)
  const language = useAppStore((s) => s.settings?.language ?? 'en')

  // Keep the draft in sync when the saved key changes from elsewhere
  // (config reload, model switch resetting it, …).
  useEffect(() => {
    setKeyDraft(agent.apiKey ?? '')
  }, [agent.apiKey])

  const saveKey = async () => {
    const trimmed = keyDraft.trim()
    if (!trimmed) return
    const validation = (await window.halis.modelValidateAgentKey({
      apiKey: trimmed,
      modelId: agent.modelId,
      agentId: agent.id,
      existingAgents: useSwarmStore.getState().config.agents,
    })) as { conflict: boolean; agentName?: string; message: string }
    if (validation.conflict) {
      setDupWarn({ agentName: validation.agentName ?? '', message: validation.message })
      return
    }
    updateAgent(agent.id, { apiKey: trimmed, duplicateKeyAck: false })
  }

  const testKey = async () => {
    setKeyState('testing')
    // Test with the exact key the agent will actually use at runtime:
    // its own key when present, otherwise the provider's vault key.
    const result = (await window.halis.modelTestKey(agent.modelId, agent.apiKey?.trim() || undefined)) as { ok: boolean; detail: string }
    setKeyState(result.ok ? 'ok' : 'bad')
  }

  return (
    <div className="rounded-2xl border border-line bg-panel2 overflow-hidden">
      {/* header row */}
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          className="w-10 h-10 rounded-xl flex items-center justify-center text-[20px] border cursor-pointer shrink-0"
          style={{ backgroundColor: `${agent.color}1a`, borderColor: `${agent.color}45` }}
          onClick={() => setExpanded(!expanded)}
          title={agent.name}
        >
          {agent.avatar}
        </button>
        <div className="flex-1 min-w-0">
          <Input
            value={agent.name}
            onChange={(e) => updateAgent(agent.id, { name: e.target.value.replace(/[^\w \-.àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴĐ]/gi, '') })}
            className="!bg-transparent !border-transparent !px-1 !py-0.5 font-semibold hover:!border-line focus:!bg-[#0d1119] !text-[14px]"
            placeholder={t('agent_name')}
            maxLength={24}
          />
          <div className="flex items-center gap-1.5 px-1 flex-wrap">
            <Badge color={agent.color}>{role ? (language === 'vi' ? role.nameVi : role.name) : agent.roleId}</Badge>
            <span className="text-[10.5px] text-faint font-mono truncate">{agent.modelId.split('/').pop()?.replace(/"/g, '')}</span>
            {needsKey && !agent.apiKey && !vaultHasKey ? <Badge color="#f59e0b">{t('key_needed')}</Badge> : null}
            {needsKey && agent.apiKey ? <Badge color="#22c55e">{t('key_saved')}</Badge> : null}
            {needsKey && !agent.apiKey && vaultHasKey ? <Badge color="#3b82f6">✓ key</Badge> : null}
          </div>
        </div>
        <Toggle checked={agent.enabled} onChange={(v) => updateAgent(agent.id, { enabled: v })} />
        <button className="text-faint hover:text-red cursor-pointer p-1" onClick={() => removeAgent(agent.id)} title={t('delete')}>
          <Trash2 size={14} />
        </button>
        <button className="text-faint hover:text-ink cursor-pointer p-1" onClick={() => setExpanded(!expanded)}>
          <ChevronDown size={15} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {expanded ? (
        <div className="border-t border-line px-4 py-4 space-y-4">
          {/* avatar + color */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-[11px] text-faint mb-1.5">{t('agent_avatar')}</div>
              <div className="flex flex-wrap gap-1">
                {['🤖', '🧭', '📐', '⌨️', '🔍', '🛡️', '🧪', '⚙️', '📚', '📝', '🦾', '🧠', '🐙', '🦊', '🐝', '⚡', '🌙', '🔥'].map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => updateAgent(agent.id, { avatar: emoji })}
                    className={`w-7 h-7 rounded-lg text-[15px] flex items-center justify-center border cursor-pointer transition-colors ${
                      agent.avatar === emoji ? 'border-signal/60 bg-signal/15' : 'border-transparent hover:border-line bg-panel3/50'
                    }`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-faint mb-1.5">{t('agent_color')}</div>
              <div className="flex flex-wrap gap-1.5">
                {['#8b5cf6', '#22c55e', '#3b82f6', '#F472B6', '#f59e0b', '#2DD4BF', '#F97316', '#A78BFA', '#EF4444', '#84CC16'].map((c) => (
                  <button
                    key={c}
                    onClick={() => updateAgent(agent.id, { color: c })}
                    className={`w-6 h-6 rounded-full border-2 cursor-pointer transition-transform ${agent.color === c ? 'border-white scale-110' : 'border-transparent'}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* role + model */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-[11px] text-faint mb-1.5">{t('agent_role')}</div>
              <Select
                value={agent.roleId}
                onChange={(e) => {
                  const r = roles.find((x) => x.id === e.target.value)
                  updateAgent(agent.id, {
                    roleId: e.target.value,
                    systemPrompt: r?.prompt ?? agent.systemPrompt,
                    permissions: {
                      ...agent.permissions,
                      readOnly: !!r?.defaultPermissions.readOnly,
                      canRunShell: r?.defaultPermissions.canRunShell !== false && !r?.defaultPermissions.readOnly,
                      canUseTelegraph: r?.defaultPermissions.canUseTelegraph !== false,
                      usdcAutoApproveUpTo: r?.defaultPermissions.usdcAutoApproveUpTo ?? 0,
                    },
                  })
                }}
              >
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.emoji} {language === 'vi' ? r.nameVi : r.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <div className="text-[11px] text-faint mb-1.5">{t('agent_model')}</div>
              <ModelPicker
                value={agent.modelId}
                // No apiKey here: updateAgent's provider check decides whether
                // the saved key survives (switching models WITHIN one provider
                // must keep it — the store already implements exactly that).
                onChange={(id) => updateAgent(agent.id, { modelId: id })}
              />
            </div>
          </div>

          {/* API key */}
          {needsKey ? (
            <div>
              <div className="flex items-center gap-1.5 text-[11px] text-faint mb-1.5">
                <KeyRound size={11} />
                {t('agent_key')}
                {model ? <span className="font-mono">({provider?.envKey ?? 'API key'})</span> : null}
              </div>
              <div className="flex gap-2">
                <Input
                  type="password"
                  value={keyDraft}
                  placeholder={vaultHasKey ? t('key_placeholder_vault') : t('enter_key')}
                  onChange={(e) => setKeyDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void saveKey()
                  }}
                />
                <Button size="sm" onClick={() => void saveKey()} disabled={!keyDraft.trim()}>
                  <Check size={13} /> {t('save')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void testKey()} disabled={!agent.apiKey && !vaultHasKey}>
                  {keyState === 'testing' ? t('testing') : t('test_model')}
                </Button>
              </div>
              <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                {agent.apiKey ? (
                  <span className="text-[11px] text-good">
                    ✓ {t('key_saved')} · {agent.apiKey.slice(0, 4)}…{agent.apiKey.slice(-4)}
                  </span>
                ) : vaultHasKey ? (
                  <span className="text-[11px] text-cyan">✓ {t('agent_key_vault')}</span>
                ) : (
                  <span className="text-[11px] text-amber">{t('agent_key_reenter')}</span>
                )}
                {keyState === 'ok' ? <span className="text-[11px] text-good">{t('test_ok')} ✓</span> : null}
                {keyState === 'bad' ? <span className="text-[11px] text-red">✗</span> : null}
                {provider?.docs ? (
                  <a
                    className="text-[11px] text-cyan hover:underline cursor-pointer"
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
          ) : (
            <div className="text-[11.5px] text-good">✓ {t('key_optional')}</div>
          )}

          {/* permissions */}
          <div>
            <div className="text-[11px] text-faint mb-2">{t('agent_permissions')}</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-xl bg-panel/60 border border-line px-3.5 py-3">
              <Toggle checked={agent.permissions.readOnly} onChange={(v) => updateAgent(agent.id, { permissions: { ...agent.permissions, readOnly: v } })} label={t('perm_readonly')} />
              <Toggle checked={agent.permissions.canRunShell} onChange={(v) => updateAgent(agent.id, { permissions: { ...agent.permissions, canRunShell: v } })} label={t('perm_shell')} />
              <Toggle checked={agent.permissions.autoApproveShell} onChange={(v) => updateAgent(agent.id, { permissions: { ...agent.permissions, autoApproveShell: v } })} label={t('perm_autoshell')} />
              <Toggle checked={agent.permissions.autoApproveEdits} onChange={(v) => updateAgent(agent.id, { permissions: { ...agent.permissions, autoApproveEdits: v } })} label={t('perm_autoedits')} />
              <Toggle checked={agent.permissions.canUseTelegraph} onChange={(v) => updateAgent(agent.id, { permissions: { ...agent.permissions, canUseTelegraph: v } })} label={t('perm_telegraph')} />
              <label className="flex items-center gap-2.5">
                <span className="text-[13px] text-muted">{t('perm_usdclimit')}</span>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={agent.permissions.usdcAutoApproveUpTo}
                  onChange={(e) => updateAgent(agent.id, { permissions: { ...agent.permissions, usdcAutoApproveUpTo: Number(e.target.value) || 0 } })}
                  className="!w-20 !py-1 !text-xs"
                />
              </label>
            </div>
          </div>

          {/* system prompt */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[11px] text-faint">{t('agent_prompt')}</div>
              <button className="inline-flex items-center gap-1 text-[11px] text-cyan hover:underline cursor-pointer" onClick={() => regeneratePrompt(agent.id)}>
                <RefreshCw size={11} /> {t('generate_prompt')}
              </button>
            </div>
            <Textarea
              value={agent.systemPrompt ?? ''}
              onChange={(e) => updateAgent(agent.id, { systemPrompt: e.target.value })}
              rows={6}
              className="font-mono !text-[11.5px]"
            />
          </div>

          <Modal open={!!dupWarn} onClose={() => setDupWarn(null)} title={<span className="flex items-center gap-2"><AlertTriangle size={15} className="text-amber" /> {t('dup_key_title')}</span>}>
            <p className="text-[13px] text-muted leading-relaxed mb-4">{dupWarn?.message}</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDupWarn(null)}>
                {t('cancel')}
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  updateAgent(agent.id, { apiKey: keyDraft.trim(), duplicateKeyAck: true })
                  setDupWarn(null)
                }}
              >
                <Wand2 size={13} /> {t('use_anyway')}
              </Button>
            </div>
          </Modal>
        </div>
      ) : null}
    </div>
  )
}

export function SwarmSetupView() {
  const t = useT()
  const swarm = useSwarmStore()
  const keyStatus = useAppStore((s) => s.keyStatus)
  const loadKeyStatus = useAppStore((s) => s.loadKeyStatus)
  const [errors, setErrors] = useState<string[]>([])
  const [saved, setSaved] = useState(false)
  const [warnings, setWarnings] = useState<string[]>([])

  useEffect(() => {
    if (!swarm.loaded) void swarm.load()
    // Refresh the vault status so agents already covered by a saved provider
    // key are not flagged as missing keys.
    void loadKeyStatus()
  }, [swarm.loaded])

  const missingKeys = swarm.config.agents.filter((a) => {
    // Cheap check: provider known from catalog; a key saved in the vault for
    // that provider satisfies the requirement, same as a per-agent key.
    const model = useAppStore.getState().catalog?.models.find((m) => m.id === a.modelId)
    const provider = useAppStore.getState().catalog?.providers.find((p) => p.id === model?.providerId)
    if (!provider || provider.keyless) return false
    if (a.apiKey?.trim()) return false
    return !(keyStatus[provider.id] ?? false)
  }).length

  const save = async () => {
    const validation = (await window.halis.swarmValidate(swarm.config)) as { ok: boolean; errors: string[]; warnings: string[] }
    setErrors(validation.errors)
    setWarnings(validation.warnings)
    if (!validation.ok) return
    const result = await swarm.save()
    if (result.ok) {
      setSaved(true)
      setTimeout(() => setSaved(false), 1800)
    }
  }
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-6">
        <SectionTitle hint={`${swarm.config.agents.length}/20`}>{t('swarm_setup_title')}</SectionTitle>
        <p className="text-[13px] text-muted mb-5 -mt-1">{t('swarm_setup_subtitle')}</p>

        {errors.length ? (
          <div className="rounded-xl border border-red/40 bg-red/5 p-3.5 mb-4">
            <div className="text-[12.5px] font-semibold text-red mb-1">{t('validation_errors')}</div>
            <ul className="list-disc pl-4 text-[12.5px] text-red/80 space-y-0.5">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {warnings.length && !errors.length ? (
          <div className="rounded-xl border border-amber/30 bg-amber/5 p-3.5 mb-4 text-[12.5px] text-amber/90 space-y-1">
            {warnings.map((w) => (
              <div key={w}>⚠ {w}</div>
            ))}
          </div>
        ) : null}

        <div className="space-y-3 mb-5">
          {swarm.config.agents.map((agent, i) => (
            <AgentCard key={agent.id} agent={agent} index={i} />
          ))}
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {swarm.config.agents.length < 20 ? (
            <>
              <Button variant="default" onClick={() => swarm.addAgent()}>
                <Plus size={14} /> {t('add_agent')}
              </Button>
              <Button variant="ghost" onClick={() => swarm.addAgent('planner')}>
                <Plus size={13} /> Planner
              </Button>
              <Button variant="ghost" onClick={() => swarm.addAgent('reviewer')}>
                <Plus size={13} /> Reviewer
              </Button>
            </>
          ) : (
            <span className="text-[12px] text-amber">{t('max_agents_reached')}</span>
          )}
        </div>

        <div className="flex items-center gap-4 mt-6 pt-5 border-t border-line flex-wrap">
          <label className="flex items-center gap-2 text-[13px] text-muted">
            {t('rounds_label')}
            <Input
              type="number"
              min={1}
              max={8}
              value={swarm.config.maxRounds}
              onChange={(e) => swarm.setMaxRounds(Number(e.target.value) || 4)}
              className="!w-16 !py-1"
            />
          </label>
          <Toggle
            checked={swarm.config.plannerCoordination}
            onChange={(v) => useSwarmStore.setState({ config: { ...swarm.config, plannerCoordination: v } })}
            label={t('planner_hint')}
          />
          <div className="ml-auto flex items-center gap-3">
            {missingKeys > 0 ? <span className="text-[12px] text-amber">{missingKeys} {t('missing_keys')}</span> : null}
            <Button variant="primary" onClick={() => void save()}>
              {saved ? <Check size={14} /> : null}
              {saved ? t('team_saved') : t('save_team')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
