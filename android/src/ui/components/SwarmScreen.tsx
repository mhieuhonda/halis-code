/**
 * Swarm tab — team builder. Roster with per-agent editor (name, avatar,
 * color, role, model, key, permissions, prompt), stock formations, save
 * with validation. Shell/edit permissions stay off on Android.
 */
import { useEffect, useState } from 'react'
import { ChevronDown, Plus, Save, Trash2, Users } from 'lucide-react'
import type { AgentConfig } from '@shared/types'
import { useSwarmStore } from '../stores/swarm'
import { useAppStore } from '../stores/app'
import { useT } from '../i18n'
import { Sheet, pushToast } from './ui'
import { ModelPicker } from './ModelPicker'
import { SWARM_FORMATIONS } from '@shared/formations'
import { AVATAR_CHOICES, AGENT_COLORS } from '@core/swarm/roles'
import { bridge } from '../lib/bridge'

export function SwarmScreen() {
  const t = useT()
  const lang = useAppStore((s) => s.settings?.language ?? 'en')
  const config = useSwarmStore((s) => s.config)
  const roles = useSwarmStore((s) => s.roles)
  const loaded = useSwarmStore((s) => s.loaded)
  const load = useSwarmStore((s) => s.load)
  const addAgent = useSwarmStore((s) => s.addAgent)
  const removeAgent = useSwarmStore((s) => s.removeAgent)
  const updateAgent = useSwarmStore((s) => s.updateAgent)
  const applyFormation = useSwarmStore((s) => s.applyFormation)
  const setMaxRounds = useSwarmStore((s) => s.setMaxRounds)
  const save = useSwarmStore((s) => s.save)
  const regeneratePrompt = useSwarmStore((s) => s.regeneratePrompt)
  const [editing, setEditing] = useState<string | null>(null)
  const [pickerFor, setPickerFor] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])

  useEffect(() => {
    void load()
  }, [load])

  const roleName = (roleId: string) => {
    const role = roles.find((r) => r.id === roleId)
    return role ? (lang === 'vi' ? role.nameVi : role.name) : roleId
  }

  const doSave = async () => {
    const validation = await bridge.swarmValidate(config)
    if (validation.ok) {
      const result = await save()
      if (result.ok) {
        setWarnings(result.warnings)
        pushToast(t('team_saved'))
      } else pushToast(result.error ?? 'Save failed', 'error')
      return
    }
    // Duplicate-key warnings resolve through a confirm; errors surface as a toast.
    const warningsOnly = validation.errors.filter((e) => e.includes('rate-limit risk'))
    if (warningsOnly.length && confirm(warningsOnly.join('\n') + '\n\n' + t('use_anyway') + '?')) {
      const result = await save()
      if (result.ok) {
        setWarnings(result.warnings)
        pushToast(t('team_saved'))
      }
      return
    }
    pushToast(validation.errors.join(' '), 'error')
  }

  return (
    <>
      <div className="topbar safe-top">
        <Users size={19} style={{ color: 'var(--hal-accent)' }} />
        <b className="grow">{t('swarm_setup_title')}</b>
        <button className="btn btn-primary btn-sm" disabled={!loaded} onClick={() => void doSave()}>
          <Save size={15} /> {t('save_team')}
        </button>
      </div>

      <div className="screen">
        {!loaded ? (
          <div className="hint" style={{ textAlign: 'center', padding: 30 }}>
            <span className="spinner" />
          </div>
        ) : (
          <>
            <div className="hint" style={{ marginBottom: 12 }}>{t('swarm_setup_subtitle')}</div>

            {!config.agents.length ? <div className="hint" style={{ textAlign: 'center', padding: 16 }}>{t('team_empty')}</div> : null}

            {config.agents.map((agent) => (
              <div key={agent.id} className="card" style={{ padding: 12, marginBottom: 10 }}>
                <div className="row" style={{ gap: 10 }}>
                  <span style={{ width: 34, height: 34, borderRadius: 11, background: agent.color, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, flex: '0 0 auto' }}>
                    {agent.avatar || agent.name.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="grow" style={{ minWidth: 0 }} onClick={() => setEditing(editing === agent.id ? null : agent.id)}>
                    <div style={{ fontWeight: 650, fontSize: 14.5 }}>
                      {agent.name} {agent.roleId === 'chief-of-staff' ? '🧭' : ''}
                    </div>
                    <div className="hint" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {roleName(agent.roleId)} · {agent.modelId.split('/').pop()}
                      {agent.enabled ? '' : ' · off'}
                    </div>
                  </div>
                  <button className="icon-btn" style={{ width: 34, height: 34 }} onClick={() => setEditing(editing === agent.id ? null : agent.id)} aria-label="edit">
                    <ChevronDown size={17} style={{ transform: editing === agent.id ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }} />
                  </button>
                  <button className="icon-btn" style={{ width: 34, height: 34 }} onClick={() => removeAgent(agent.id)} aria-label="remove">
                    <Trash2 size={16} />
                  </button>
                </div>

                {editing === agent.id ? (
                  <div style={{ marginTop: 12 }}>
                    <label className="hint">{t('agent_name')}</label>
                    <input className="field" value={agent.name} onChange={(e) => updateAgent(agent.id, { name: e.target.value })} />

                    <label className="hint" style={{ display: 'block', marginTop: 10 }}>{t('agent_avatar')}</label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                      {AVATAR_CHOICES.slice(0, 14).map((emoji) => (
                        <button
                          key={emoji}
                          className={`chip ${agent.avatar === emoji ? 'chip-accent' : ''}`}
                          style={{ fontSize: 16, padding: '4px 9px', cursor: 'pointer' }}
                          onClick={() => updateAgent(agent.id, { avatar: emoji })}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>

                    <label className="hint" style={{ display: 'block', marginTop: 10 }}>{t('agent_color')}</label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {AGENT_COLORS.map((color) => (
                        <button
                          key={color}
                          style={{
                            width: 30,
                            height: 30,
                            borderRadius: 10,
                            background: color,
                            border: agent.color === color ? '2.5px solid var(--hal-ink)' : 'none',
                            cursor: 'pointer',
                          }}
                          onClick={() => updateAgent(agent.id, { color })}
                          aria-label={color}
                        />
                      ))}
                    </div>

                    <label className="hint" style={{ display: 'block', marginTop: 10 }}>{t('agent_role')}</label>
                    <select className="field" value={agent.roleId} onChange={(e) => updateAgent(agent.id, { roleId: e.target.value })}>
                      {roles.map((role) => (
                        <option key={role.id} value={role.id}>
                          {lang === 'vi' ? `${role.emoji} ${role.nameVi}` : `${role.emoji} ${role.name}`}
                        </option>
                      ))}
                    </select>

                    <label className="hint" style={{ display: 'block', marginTop: 10 }}>{t('agent_model')}</label>
                    <button className="field" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => setPickerFor(agent.id)}>
                      {agent.modelId}
                    </button>

                    <label className="hint" style={{ display: 'block', marginTop: 10 }}>{t('agent_key')}</label>
                    <input
                      className="field"
                      style={{ fontFamily: 'monospace', fontSize: 13 }}
                      type="password"
                      placeholder={t('key_placeholder_vault')}
                      value={agent.apiKey ?? ''}
                      onChange={(e) => updateAgent(agent.id, { apiKey: e.target.value })}
                    />

                    <label className="hint" style={{ display: 'block', marginTop: 12 }}>{t('agent_permissions')}</label>
                    <PermToggle label={t('enabled')} on={agent.enabled} onChange={(v) => updateAgent(agent.id, { enabled: v })} />
                    <PermToggle label={t('perm_readonly')} on={agent.permissions.readOnly} onChange={(v) => updateAgent(agent.id, { permissions: { ...agent.permissions, readOnly: v } })} />
                    <PermToggle label={t('perm_telegraph')} on={agent.permissions.canUseTelegraph} onChange={(v) => updateAgent(agent.id, { permissions: { ...agent.permissions, canUseTelegraph: v } })} />
                    <div className="row" style={{ marginTop: 6 }}>
                      <span className="hint grow">{t('perm_usdclimit')}</span>
                      <input
                        className="field"
                        style={{ width: 90, minHeight: 36 }}
                        type="number"
                        step="0.01"
                        min={0}
                        value={agent.permissions.usdcAutoApproveUpTo}
                        onChange={(e) => updateAgent(agent.id, { permissions: { ...agent.permissions, usdcAutoApproveUpTo: Number(e.target.value) || 0 } })}
                      />
                    </div>

                    <label className="hint" style={{ display: 'block', marginTop: 12 }}>{t('agent_prompt')}</label>
                    <textarea className="field" rows={5} style={{ fontSize: 13 }} value={agent.systemPrompt ?? ''} onChange={(e) => updateAgent(agent.id, { systemPrompt: e.target.value })} />
                    <button className="btn btn-sm" style={{ marginTop: 6 }} onClick={() => regeneratePrompt(agent.id)}>
                      {t('generate_prompt')}
                    </button>
                  </div>
                ) : null}
              </div>
            ))}

            <button className="btn" style={{ width: '100%', marginBottom: 14 }} disabled={config.agents.length >= 20} onClick={() => addAgent()}>
              <Plus size={16} /> {t('add_agent')}
            </button>

            <div style={{ fontWeight: 650, fontSize: 14, marginBottom: 8 }}>{t('formation_title')}</div>
            {SWARM_FORMATIONS.map((f) => (
              <div key={f.id} className="card" style={{ padding: 12, marginBottom: 8 }}>
                <div style={{ fontWeight: 650 }}>
                  {f.emoji} {lang === 'vi' ? f.nameVi : f.name}
                </div>
                <div className="hint" style={{ margin: '3px 0 8px' }}>{lang === 'vi' ? f.descriptionVi : f.description}</div>
                <button
                  className="btn btn-sm"
                  onClick={() => applyFormation(f.slots.map((s) => s.roleId), f.slots.map((s) => s.name))}
                >
                  {t('formation_apply')}
                </button>
              </div>
            ))}

            <div className="row" style={{ marginTop: 14 }}>
              <span className="hint grow">{t('rounds_label')}</span>
              <input className="field" style={{ width: 80, minHeight: 38 }} type="number" min={1} max={8} value={config.maxRounds} onChange={(e) => setMaxRounds(Number(e.target.value) || 4)} />
            </div>
            {config.plannerCoordination ? <div className="hint" style={{ marginTop: 8 }}>{t('chief_hint')}</div> : null}
            {warnings.length ? (
              <div className="card" style={{ padding: 10, marginTop: 10, borderColor: 'var(--hal-amber)' }}>
                {warnings.map((w, i) => (
                  <div key={i} className="hint">
                    ⚠ {w}
                  </div>
                ))}
              </div>
            ) : null}
          </>
        )}
      </div>

      <ModelPicker
        open={!!pickerFor}
        onClose={() => setPickerFor(null)}
        currentId={config.agents.find((a) => a.id === pickerFor)?.modelId}
        onPick={(m) => {
          if (pickerFor) updateAgent(pickerFor, { modelId: m.id })
        }}
      />
    </>
  )
}

function PermToggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="row" style={{ padding: '6px 0', fontSize: 13.5, cursor: 'pointer' }}>
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} style={{ width: 18, height: 18, accentColor: 'var(--hal-accent)' }} />
      {label}
    </label>
  )
}

export type { AgentConfig }
