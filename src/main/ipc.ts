/**
 * IPC surface: thin, typed wrappers around the HalisApp runtime.
 */
import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { AppSettings, ChatMode, McpServerConfig, QuestionAnswer, SwarmConfig } from '@shared/types'
import { IPC } from '@shared/ipc'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { HalisApp } from './app-runtime'
import { SWARM_ROLES } from './swarm/roles'
import { modelCatalog } from './models/catalog'
import { testMcpConfig } from './harness/mcp'
import { importWallet, createBurnerWallet } from './telegraph/wallet'
import { listMiners, listIntents, verifySignal } from './telegraph/client'

export function registerIpc(app: HalisApp, getWindow: () => BrowserWindow | null): void {
  const send = (channel: string, payload: unknown) => {
    const win = getWindow()
    if (!win || win.isDestroyed()) return
    win.webContents.send(channel, payload)
  }

  app.setBroadcaster((event) => send(IPC.event, event))

  /* ---------------- settings ---------------- */
  ipcMain.handle(IPC.settingsGet, () => app.settings())
  ipcMain.handle(IPC.settingsSet, (_e, patch: Partial<AppSettings>) => app.updateSettings(patch))
  ipcMain.handle(IPC.workspacePick, async () => {
    const win = getWindow()
    // The window can be gone (closed while a picker promise is in flight) —
    // a bare `win!` here turned the picker into an unhandled TypeError.
    if (!win || win.isDestroyed()) return null
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })
    if (result.canceled || !result.filePaths[0]) return null
    app.updateSettings({ workspace: result.filePaths[0] })
    return result.filePaths[0]
  })
  ipcMain.handle(IPC.workspaceStatus, () => {
    try {
      const ws = app.effectiveWorkspace()
      const isGit = existsSync(join(ws, '.git'))
      let fileCount = 0
      try {
        fileCount = readdirSync(ws).length
      } catch {
        fileCount = 0
      }
      return { workspace: ws, exists: existsSync(ws), isGit, fileCount }
    } catch (err) {
      return { workspace: '', exists: false, isGit: false, fileCount: 0, error: String(err) }
    }
  })

  /* ---------------- models & keys ---------------- */
  ipcMain.handle(IPC.modelCatalog, () => modelCatalog.get())
  ipcMain.handle(IPC.modelKeyStatus, () => {
    const status = app.vault.statusAll()
    const providers = modelCatalog.get().providers
    const out: Record<string, boolean> = {}
    for (const p of providers) out[p.id] = !!status[p.id] || !!p.keyless
    return out
  })
  ipcMain.handle(IPC.modelSaveKey, (_e, providerId: string, key: string) => {
    app.vault.set(providerId, key)
    return { ok: true }
  })
  ipcMain.handle(IPC.modelRemoveKey, (_e, providerId: string) => app.vault.remove(providerId))
  ipcMain.handle(IPC.modelTestKey, async (_e, modelId: string, keyOverride?: string) => app.dispatcher.testModel(modelId, keyOverride))
  ipcMain.handle(IPC.modelValidateAgentKey, (_e, candidate: { apiKey: string; modelId: string; agentId: string; existingAgents: Array<{ id: string; name: string; modelId: string; apiKey?: string }> }) => {
    if (!candidate.apiKey) return { conflict: false, message: 'No key entered yet.' }
    for (const other of candidate.existingAgents ?? []) {
      if (other.id === candidate.agentId) continue
      if (other.apiKey && other.apiKey === candidate.apiKey && other.modelId !== candidate.modelId) {
        return {
          conflict: true,
          agentName: other.name,
          message: `This API key is already used by "${other.name}" with a different model. Sharing one key across models multiplies rate-limit risk: when the provider throttles, both agents stall at once. Keep it only if you accept that risk.`,
        }
      }
    }
    return { conflict: false, message: 'OK' }
  })

  /* ---------------- sessions ---------------- */
  ipcMain.handle(IPC.sessionList, () => app.sessions.list())
  ipcMain.handle(IPC.sessionNew, (_e, mode: ChatMode, title?: string, modelId?: string) => {
    // The renderer is the trust boundary (it renders untrusted model output)
    // — never let an arbitrary mode string flow into routing heuristics.
    const safeMode: ChatMode = mode === 'swarm' ? 'swarm' : 'agent'
    return app.sessions.create(safeMode, typeof title === 'string' ? title : undefined, typeof modelId === 'string' ? modelId : undefined)
  })
  ipcMain.handle(IPC.sessionGet, (_e, id: string) => app.sessions.get(id))
  ipcMain.handle(IPC.sessionDelete, (_e, id: string) => app.deleteSession(id))
  ipcMain.handle(IPC.sessionRename, (_e, id: string, title: string) => app.renameSession(id, title))

  /* ---------------- chat ---------------- */
  ipcMain.handle(IPC.chatSend, (_e, params: { sessionId: string; text: string; modelId?: string }) => {
    // Shape-check at the boundary: a malformed payload must fail cleanly,
    // not as a raw TypeError from deep inside the turn machinery.
    if (!params || typeof params !== 'object') return { ok: false, error: 'Invalid send payload.' }
    if (typeof params.sessionId !== 'string' || !params.sessionId) return { ok: false, error: 'Invalid session id.' }
    if (typeof params.text !== 'string' || !params.text.trim()) return { ok: false, error: 'Message text is required.' }
    if (params.modelId !== undefined && typeof params.modelId !== 'string') return { ok: false, error: 'Invalid model id.' }
    return app.send(params)
  })
  ipcMain.handle(IPC.chatStop, (_e, sessionId: string) => app.stop(sessionId))
  ipcMain.handle(IPC.chatRunningSessions, () => app.runningSessionIds())

  /* ---------------- swarm ---------------- */
  ipcMain.handle(IPC.swarmGetConfig, () => app.getSwarmConfig())
  ipcMain.handle(IPC.swarmSaveConfig, (_e, config: SwarmConfig) => app.saveSwarmConfig(config))
  ipcMain.handle(IPC.swarmValidate, (_e, config: SwarmConfig) => app.validateSwarm(config))
  ipcMain.handle(IPC.swarmRoles, () => ({ roles: SWARM_ROLES }))

  /* ---------------- approvals ---------------- */
  ipcMain.handle(IPC.approvalRespond, (_e, requestId: string, response: 'allow' | 'always' | 'reject', answers?: QuestionAnswer[]) => {
    // Whitelist the response: approvals.respond treats anything other than
    // the literal 'reject' as ALLOW — an unchecked string from a compromised
    // renderer would auto-approve every pending card.
    const safe: 'allow' | 'always' | 'reject' = response === 'allow' ? 'allow' : response === 'always' ? 'always' : response === 'reject' ? 'reject' : 'reject'
    return app.approvals.respond(typeof requestId === 'string' ? requestId : '', safe, Array.isArray(answers) ? answers : undefined)
  })
  ipcMain.handle(IPC.approvalList, () => app.approvals.pendingRequests())

  /* ---------------- mcp ---------------- */
  ipcMain.handle(IPC.mcpStatuses, () => app.mcpStatuses())
  ipcMain.handle(IPC.mcpSetServers, (_e, configs: McpServerConfig[]) => app.setMcpServers(configs))
  ipcMain.handle(IPC.mcpTest, (_e, config: McpServerConfig) => testMcpConfig(config))

  /* ---------------- reminders ---------------- */
  ipcMain.handle(IPC.scheduleList, (_e, sessionId: string) => app.schedules.forSession(sessionId))
  ipcMain.handle(IPC.scheduleDelete, (_e, id: string) => app.schedules.remove(id))

  /* ---------------- jobs ---------------- */
  ipcMain.handle(IPC.jobList, () => app.jobs.list())

  /* ---------------- task board ---------------- */
  ipcMain.handle(IPC.taskBoardGet, () => {
    const { taskBoard } = app.ensureWorkspace()
    return taskBoard.all()
  })
  ipcMain.handle(IPC.taskBoardCreate, (_e, title: string, description?: string) => {
    const { taskBoard } = app.ensureWorkspace()
    return taskBoard.create(title, description, 'user')
  })
  ipcMain.handle(IPC.taskBoardUpdate, (_e, taskId: string, patch: { status?: string; blockedReason?: string }) => {
    const { taskBoard } = app.ensureWorkspace()
    return taskBoard.update(taskId, patch as never)
  })
  ipcMain.handle(IPC.taskBoardClaim, (_e, taskId: string, agentId: string, agentName: string) => {
    const { taskBoard } = app.ensureWorkspace()
    try {
      taskBoard.claim(taskId, agentId, agentName)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  /* ---------------- locks ---------------- */
  ipcMain.handle(IPC.locksList, () => app.locks.list())
  ipcMain.handle(IPC.locksRelease, (_e, path: string) => app.locks.releasePath(path))

  /* ---------------- telegraph ---------------- */
  // Every Telegraph handler refuses when the Settings master switch is off:
  // no wallet ops, no discovery, no paid asks — the whole protocol surface
  // goes dark until it is turned back on.
  const requireTelegraph = () => {
    if (!app.telegraphEnabled()) throw new Error('Telegraph is disabled in Settings. Turn it back on to use the network.')
  }
  ipcMain.handle(IPC.tgStatus, () => app.telegraphStatus())
  ipcMain.handle(IPC.tgCreateWallet, () => {
    requireTelegraph()
    const wallet = createBurnerWallet()
    // The key lives in the OS-keychain-encrypted vault — settings.json never
    // holds wallet secrets. Only the ADDRESS crosses to the renderer: the
    // renderer heap renders untrusted model output, and the import handler
    // deliberately returns {address} only for the same reason.
    app.walletKeySet(wallet.privateKey)
    return { address: wallet.address }
  })
  ipcMain.handle(IPC.tgImportWallet, (_e, privateKey: string) => {
    requireTelegraph()
    const wallet = importWallet(privateKey)
    app.walletKeySet(wallet.privateKey)
    return { address: wallet.address }
  })
  ipcMain.handle(IPC.tgExportWallet, () => {
    requireTelegraph()
    const key = app.walletKey()
    return key ? { privateKey: key } : null
  })
  ipcMain.handle(IPC.tgMiners, () => {
    requireTelegraph()
    return listMiners(app.telegraphNetwork())
  })
  ipcMain.handle(IPC.tgIntents, async () => {
    requireTelegraph()
    const intents = await listIntents(app.telegraphNetwork())
    return intents.map((i) => ({ id: i.id, label: i.label, minerCount: i.minerCount }))
  })
  ipcMain.handle(IPC.tgAsk, async (_e, params: { query: string; sessionId?: string }) => {
    try {
      requireTelegraph()
      if (!params || typeof params.query !== 'string' || !params.query.trim()) {
        return { error: 'A query is required.' }
      }
      const result = await app.telegraphAsk(params.query, typeof params.sessionId === 'string' ? params.sessionId : undefined)
      return result as object
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })
  ipcMain.handle(IPC.tgReceipts, () => app.ledger.all())
  ipcMain.handle(IPC.tgVerifySignal, (_e, signalHash: string) => {
    requireTelegraph()
    return verifySignal(app.telegraphNetwork(), signalHash)
  })
}
