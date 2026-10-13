import type { AppSettings } from '@shared/types'
import { readJson, writeJson } from '../util/json'
import { paths } from './paths'

export const DEFAULT_SETTINGS: AppSettings = {
  language: 'en',
  theme: 'light',
  workspace: '',
  defaultModelId: 'opencode/ling-3.1-flash-free',
  telegraph: {
    networkId: 'base-sepolia',
    autoApproveUpTo: 0,
    dailyBudgetUsd: 5,
  },
  telegraphEnabled: true,
  autoApproveAll: false,
  ponytailEnabled: false,
  mcpServers: [],
  tavilyApiKey: '',
}

let current: AppSettings | null = null

export function getSettings(): AppSettings {
  if (!current) {
    const loaded = readJson<Partial<AppSettings>>(paths.settingsFile, {})
    current = {
      ...DEFAULT_SETTINGS,
      ...loaded,
      telegraph: { ...DEFAULT_SETTINGS.telegraph, ...(loaded.telegraph ?? {}) },
      // Absent key (older settings file) means the default: on.
      telegraphEnabled: loaded.telegraphEnabled ?? true,
      // Absent key (older settings file) means the default: off.
      ponytailEnabled: loaded.ponytailEnabled ?? false,
      // Absent key (older settings file) falls back to the light default.
      theme: loaded.theme === 'dark' ? 'dark' : 'light',
      mcpServers: (loaded.mcpServers ?? DEFAULT_SETTINGS.mcpServers).map((s) => ({ ...s })),
    }
  }
  return current
}

export function setSettings(patch: Partial<AppSettings>): AppSettings {
  const prev = getSettings()
  current = {
    ...prev,
    ...patch,
    telegraph: { ...prev.telegraph, ...(patch.telegraph ?? {}) },
    mcpServers: patch.mcpServers ? patch.mcpServers.map((s) => ({ ...s })) : prev.mcpServers,
  }
  // 0600: settings can carry a Tavily API key — keep it away from other
  // local users.
  writeJson(paths.settingsFile, current, { mode: 0o600 })
  return current
}

/** Runtime override used by unit tests. */
export function resetSettingsCache(): void {
  current = null
}
