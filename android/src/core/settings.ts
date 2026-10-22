/** App settings — mobile defaults + persisted patching (IndexedDB). */
import type { AppSettings } from '@shared/types'
import { kvGet, kvSet } from './storage'

const KEY = 'app-settings'

export const DEFAULT_SETTINGS: AppSettings = {
  language: 'en',
  theme: 'light',
  workspace: '',
  defaultModelId: 'opencode/ling-3.1-flash-free',
  telegraph: {
    networkId: 'base-sepolia',
    autoApproveUpTo: 0,
    dailyBudgetUsd: 1,
  },
  telegraphEnabled: true,
  autoApproveAll: false,
  ponytailEnabled: false,
  mcpServers: [],
}

let cache: AppSettings | null = null

export async function loadSettings(): Promise<AppSettings> {
  if (cache) return cache
  const stored = await kvGet<Partial<AppSettings>>(KEY, {})
  cache = { ...DEFAULT_SETTINGS, ...stored, telegraph: { ...DEFAULT_SETTINGS.telegraph, ...(stored.telegraph ?? {}) } }
  return cache
}

export async function getSettings(): Promise<AppSettings> {
  return loadSettings()
}

/** Synchronous read of the already-loaded snapshot (defaults before load). */
export function currentSettingsSync(): AppSettings {
  return cache ?? DEFAULT_SETTINGS
}

/** Merge-patch and persist. Returns the next settings object. */
export async function setSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await loadSettings()
  cache = { ...current, ...patch, telegraph: { ...current.telegraph, ...(patch.telegraph ?? {}) } }
  await kvSet(KEY, cache)
  return cache
}
