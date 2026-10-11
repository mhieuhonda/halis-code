/** Telegraph store: wallet status, receipts, miners, intents. */
import { create } from 'zustand'
import type { TelegraphAskResult, TelegraphMiner, TelegraphReceipt, TelegraphStatus } from '@shared/types'
import { bridge } from '../lib/ipc'

interface TelegraphState {
  status: TelegraphStatus | null
  receipts: TelegraphReceipt[]
  miners: TelegraphMiner[]
  intents: Array<{ id: string; label?: string }>
  busy: boolean
  lastAsk: (TelegraphAskResult & { error?: string }) | null
  loadStatus: () => Promise<void>
  loadReceipts: () => Promise<void>
  loadMiners: () => Promise<void>
  loadIntents: () => Promise<void>
  createWallet: () => Promise<void>
  importWallet: (privateKey: string) => Promise<string | undefined>
  ask: (query: string) => Promise<void>
  verify: (signalHash: string) => Promise<{ found: boolean; detail: string }>
  refreshAll: () => Promise<void>
}

export const useTelegraphStore = create<TelegraphState>((set, get) => ({
  status: null,
  receipts: [],
  miners: [],
  intents: [],
  busy: false,
  lastAsk: null,

  loadStatus: async () => {
    const status = (await bridge.tgStatus()) as TelegraphStatus
    set({ status })
  },

  loadReceipts: async () => {
    const receipts = (await bridge.tgReceipts()) as TelegraphReceipt[]
    set({ receipts })
  },

  loadMiners: async () => {
    try {
      const miners = (await bridge.tgMiners()) as TelegraphMiner[]
      set({ miners })
    } catch {
      set({ miners: [] })
    }
  },

  loadIntents: async () => {
    try {
      const intents = (await bridge.tgIntents()) as Array<{ id: string; label?: string }>
      set({ intents })
    } catch {
      set({ intents: [] })
    }
  },

  createWallet: async () => {
    set({ busy: true })
    try {
      await bridge.tgCreateWallet()
      await get().loadStatus()
    } finally {
      set({ busy: false })
    }
  },

  importWallet: async (privateKey) => {
    set({ busy: true })
    try {
      const result = (await bridge.tgImportWallet(privateKey)) as { address: string }
      await get().loadStatus()
      return result.address
    } catch (err) {
      return err instanceof Error ? err.message : String(err)
    } finally {
      set({ busy: false })
    }
  },

  ask: async (query) => {
    set({ busy: true, lastAsk: null })
    try {
      const result = (await bridge.tgAsk({ query })) as TelegraphAskResult & { error?: string }
      set({ lastAsk: result })
      await get().loadReceipts()
      await get().loadStatus()
    } finally {
      set({ busy: false })
    }
  },

  verify: async (signalHash) => {
    return (await bridge.tgVerifySignal(signalHash)) as { found: boolean; detail: string }
  },

  refreshAll: async () => {
    await Promise.all([get().loadStatus(), get().loadReceipts(), get().loadMiners(), get().loadIntents()])
  },
}))
