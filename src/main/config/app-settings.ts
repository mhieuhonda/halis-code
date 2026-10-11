import type { AppSettings } from '@shared/types'
import { readJson, writeJson } from '../util/json'
import { paths } from './paths'

export const DEFAULT_SETTINGS: AppSettings = {
  language: 'en',
  workspace: '',
  defaultModelId: 'pollinations/openai-fast',
  telegraph: {
    networkId: 'base-sepolia',
    autoApproveUpTo: 0,
    dailyBudgetUsd: 5,
  },
  autoApproveAll: false,
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
  writeJson(paths.settingsFile, current)
  return current
}

/** Runtime override used by unit tests. */
export function resetSettingsCache(): void {
  current = null
}
