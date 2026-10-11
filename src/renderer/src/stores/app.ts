/** App-wide store: settings, model catalog, key status, workspace. */
import { create } from 'zustand'
import type { AppSettings, CatalogSnapshot, ProviderInfo } from '@shared/types'
import { bridge } from '../lib/ipc'

interface AppState {
  settings: AppSettings | null
  catalog: CatalogSnapshot | null
  keyStatus: Record<string, boolean>
  workspace: { workspace: string; exists: boolean; isGit: boolean; fileCount: number }
  loadSettings: () => Promise<void>
  setSettings: (patch: Partial<AppSettings>) => Promise<void>
  loadCatalog: () => Promise<void>
  loadKeyStatus: () => Promise<void>
  loadWorkspace: () => Promise<void>
  pickWorkspace: () => Promise<void>
}

export const useAppStore = create<AppState>((set, get) => ({
  settings: null,
  catalog: null,
  keyStatus: {},
  workspace: { workspace: '', exists: false, isGit: false, fileCount: 0 },

  loadSettings: async () => {
    const settings = (await bridge.settingsGet()) as AppSettings
    set({ settings })
  },

  setSettings: async (patch) => {
    const settings = (await bridge.settingsSet(patch)) as AppSettings
    set({ settings })
    await get().loadWorkspace()
  },

  loadCatalog: async () => {
    const catalog = (await bridge.modelCatalog()) as CatalogSnapshot
    set({ catalog })
  },

  loadKeyStatus: async () => {
    const keyStatus = (await bridge.modelKeyStatus()) as Record<string, boolean>
    set({ keyStatus })
  },

  loadWorkspace: async () => {
    const workspace = (await bridge.workspaceStatus()) as AppState['workspace']
    set({ workspace })
  },

  pickWorkspace: async () => {
    const path = (await bridge.workspacePick()) as string | null
    if (path) {
      await get().loadWorkspace()
    }
  },
}))

/** Provider lookup helper. */
export function useProvider(providerId: string | undefined): ProviderInfo | undefined {
  return useAppStore((s) => (providerId ? s.catalog?.providers.find((p) => p.id === providerId) : undefined))
}
