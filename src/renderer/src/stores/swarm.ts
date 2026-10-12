/** Swarm store: team config + roles. */
import { create } from 'zustand'
import type { AgentConfig, AgentRole, SwarmConfig } from '@shared/types'
import { bridge } from '../lib/ipc'
import { translate } from '../i18n'

interface SwarmState {
  config: SwarmConfig
  roles: AgentRole[]
  loaded: boolean
  load: () => Promise<void>
  updateAgent: (id: string, patch: Partial<AgentConfig>) => void
  addAgent: (role?: string) => void
  removeAgent: (id: string) => void
  setMaxRounds: (n: number) => void
  save: () => Promise<{ ok: boolean; error?: string; warnings: string[] }>
  /** Regenerate an agent's system prompt from its role. */
  regeneratePrompt: (id: string) => void
}

const FALLBACK_ROLE: AgentRole = {
  id: 'coder',
  name: 'Coder',
  nameVi: 'Lập trình',
  emoji: '💻',
  priority: 3,
  defaultPermissions: {},
  prompt: 'You are a member of a coding swarm. Follow the objective, coordinate through the planner, address teammates with @Name, and use the task board for shared work.',
  promptVi: 'Bạn là thành viên của một swarm lập trình. Bám sát mục tiêu, phối hợp qua planner, gọi teammate bằng @Tên, và dùng task board cho công việc chung.',
}

function blankAgent(roles: AgentRole[], existing: AgentConfig[], index: number): AgentConfig {
  const role = roles.find((r) => r.id === 'coder') ?? roles[0] ?? FALLBACK_ROLE
  const colors = ['#7C6CFF', '#4ADE80', '#38BDF8', '#F472B6', '#FBBF24', '#2DD4BF', '#F97316', '#A78BFA']
  const avatars = ['🤖', '🧭', '📐', '⌨️', '🔍', '🛡️', '🧪', '⚙️', '📚', '📝', '🦾', '🧠', '🐙', '🦊', '🐝', '⚡']
  let name = `Agent${index + 1}`
  let n = index + 1
  while (existing.some((a) => a.name.toLowerCase() === name.toLowerCase())) {
    n += 1
    name = `Agent${n}`
  }
  return {
    id: `ag_${Math.random().toString(36).slice(2, 10)}`,
    name,
    avatar: avatars[index % avatars.length]!,
    color: colors[index % colors.length]!,
    roleId: role.id,
    modelId: 'pollinations/openai-fast',
    apiKey: '',
    permissions: {
      readOnly: !!role.defaultPermissions.readOnly,
      autoApproveEdits: !!role.defaultPermissions.autoApproveEdits,
      canRunShell: role.defaultPermissions.canRunShell !== false,
      autoApproveShell: !!role.defaultPermissions.autoApproveShell,
      canUseTelegraph: role.defaultPermissions.canUseTelegraph !== false,
      usdcAutoApproveUpTo: role.defaultPermissions.usdcAutoApproveUpTo ?? 0,
    },
    systemPrompt: role.prompt,
    enabled: true,
  }
}

export const useSwarmStore = create<SwarmState>((set, get) => ({
  config: { agents: [], maxRounds: 4, plannerCoordination: true },
  roles: [],
  loaded: false,

  load: async () => {
    const config = (await bridge.swarmGetConfig()) as SwarmConfig
    const rolesResult = (await bridge.swarmRoles()) as { roles: AgentRole[] }
    set({ config, roles: rolesResult.roles, loaded: true })
  },

  updateAgent: (id, patch) => {
    set((state) => ({
      config: {
        ...state.config,
        agents: state.config.agents.map((a) => {
          if (a.id !== id) return a
          const next = { ...a, ...patch }
          // Rule: changing the model clears the key — it must be re-entered.
          if (patch.modelId !== undefined && patch.modelId !== a.modelId) {
            next.apiKey = ''
            next.duplicateKeyAck = false
          }
          // Prompt follows the role unless the user edited it manually —
          // regenerating is explicit, so switching role keeps the old text
          // only when it was customized; simplest: keep behavior predictable.
          if (patch.roleId !== undefined && patch.roleId !== a.roleId) {
            const role = get().roles.find((r) => r.id === patch.roleId)
            if (role && !a.systemPrompt) next.systemPrompt = role.prompt
          }
          return next
        }),
      },
    }))
  },

  addAgent: (role) => {
    const { config, roles } = get()
    if (config.agents.length >= 20) return
    const agent = blankAgent(roles, config.agents, config.agents.length)
    if (role) {
      const r = roles.find((x) => x.id === role)
      if (r) {
        agent.roleId = r.id
        agent.systemPrompt = r.prompt
      }
    }
    set({ config: { ...config, agents: [...config.agents, agent] } })
  },

  removeAgent: (id) => {
    set((state) => ({ config: { ...state.config, agents: state.config.agents.filter((a) => a.id !== id) } }))
  },

  setMaxRounds: (n) => {
    set((state) => ({ config: { ...state.config, maxRounds: Math.max(1, Math.min(8, n)) } }))
  },

  regeneratePrompt: (id) => {
    const { config, roles } = get()
    const agent = config.agents.find((a) => a.id === id)
    if (!agent) return
    const role = roles.find((r) => r.id === agent.roleId)
    if (!role) return
    set({
      config: {
        ...config,
        agents: config.agents.map((a) => (a.id === id ? { ...a, systemPrompt: role.prompt } : a)),
      },
    })
  },

  save: async () => {
    const result = (await bridge.swarmSaveConfig(get().config)) as { ok: boolean; error?: string; warnings: string[] }
    return result
  },
}))

export { translate }
