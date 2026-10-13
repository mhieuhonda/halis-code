/** App-wide store: settings, model catalog, key status, workspace. */
import { create } from 'zustand'
import type { AppSettings, AppTheme, CatalogSnapshot, ProviderInfo } from '@shared/types'
import { bridge } from '../lib/ipc'

/** Paint the saved theme onto the document (dark = body[data-dark-theme]). */
export function applyTheme(theme: AppTheme | undefined): void {
  if (theme === 'dark') document.body.setAttribute('data-dark-theme', '')
  else document.body.removeAttribute('data-dark-theme')
}

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
    applyTheme(settings.theme)
    set({ settings })
  },

  setSettings: async (patch) => {
    try {
      const settings = (await bridge.settingsSet(patch)) as AppSettings
      if (patch.theme) applyTheme(settings.theme)
      set({ settings })
      await get().loadWorkspace()
    } catch (err) {
      // A refused patch (e.g. workspace switch while a turn runs) must reach
      // the user — every caller is fire-and-forget `void setSettings(...)`.
      window.dispatchEvent(
        new CustomEvent('halis:toast', { detail: { message: err instanceof Error ? err.message : String(err), kind: 'error' } }),
      )
    }
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
    try {
      const path = (await bridge.workspacePick()) as string | null
      if (path) {
        await get().loadWorkspace()
      }
    } catch (err) {
      window.dispatchEvent(
        new CustomEvent('halis:toast', { detail: { message: err instanceof Error ? err.message : String(err), kind: 'error' } }),
      )
    }
  },
}))

/** Provider lookup helper. */
export function useProvider(providerId: string | undefined): ProviderInfo | undefined {
  return useAppStore((s) => (providerId ? s.catalog?.providers.find((p) => p.id === providerId) : undefined))
}
