/**
 * The bridge implementation — same HalisBridge contract as the desktop
 * preload, backed directly by the in-process HalisMobile runtime. Stores
 * and components keep the exact shape they have on desktop.
 */
import type { HalisBridge } from '@shared/bridge'
import type { HarnessEvent } from '@shared/types'
import { HalisMobile } from '@core/runtime'
import { SWARM_ROLES } from '@core/swarm/roles'

class MobileBridge implements HalisBridge {
  private listeners = new Set<(event: HarnessEvent) => void>()

  readonly app = new HalisMobile()

  constructor() {
    this.app.setBroadcaster((event) => {
      for (const listener of [...this.listeners]) {
        try {
          listener(event)
        } catch (err) {
          console.warn('[halis] bridge listener failed:', err)
        }
      }
    })
  }

  async boot(): Promise<void> {
    await this.app.startup()
  }

  onEvent(callback: (event: HarnessEvent) => void): () => void {
    this.listeners.add(callback)
    return () => this.listeners.delete(callback)
  }

  /* settings */
  async settingsGet() {
    return this.app.settings()
  }
  async settingsSet(patch: Parameters<HalisBridge['settingsSet']>[0]) {
    return this.app.updateSettings(patch)
  }
  async workspacePick() {
    return null // no folders on Android
  }
  async workspaceStatus() {
    return { workspace: '', exists: false, isGit: false, fileCount: 0 }
  }

  /* models & keys */
  async modelCatalog() {
    return this.app.modelCatalog()
  }
  async modelKeyStatus() {
    return this.app.modelKeyStatus()
  }
  async modelSaveKey(providerId: string, key: string) {
    return this.app.modelSaveKey(providerId, key)
  }
  async modelRemoveKey(providerId: string) {
    await this.app.modelRemoveKey(providerId)
  }
  async modelTestKey(modelId: string, keyOverride?: string) {
    return this.app.modelTestKey(modelId, keyOverride)
  }
  async modelValidateAgentKey(candidate: Parameters<HalisBridge['modelValidateAgentKey']>[0]) {
    return this.app.modelValidateAgentKey(candidate)
  }

  /* sessions */
  async sessionList() {
    return this.app.sessions.list()
  }
  async sessionNew(mode: 'agent' | 'swarm', title?: string, modelId?: string) {
    return this.app.sessions.create(mode, title, modelId)
  }
  async sessionGet(id: string) {
    return this.app.sessions.get(id)
  }
  async sessionDelete(id: string) {
    this.app.deleteSession(id)
  }
  async sessionRename(id: string, title: string) {
    this.app.renameSession(id, title)
  }

  /* chat */
  async chatSend(params: { sessionId: string; text: string; modelId?: string }) {
    return this.app.send(params)
  }
  async chatStop(sessionId: string) {
    this.app.stop(sessionId)
  }
  async chatRunningSessions() {
    return this.app.runningSessionIds()
  }

  /* swarm */
  async swarmGetConfig() {
    return this.app.getSwarmConfig()
  }
  async swarmSaveConfig(config: Parameters<HalisBridge['swarmSaveConfig']>[0]) {
    return this.app.saveSwarmConfig(config)
  }
  async swarmValidate(config: Parameters<HalisBridge['swarmValidate']>[0]) {
    return this.app.validateSwarm(config)
  }
  async swarmRoles() {
    return { roles: SWARM_ROLES }
  }

  /* approvals */
  async approvalRespond(requestId: string, response: 'allow' | 'always' | 'reject', answers?: import('@shared/types').QuestionAnswer[]) {
    return this.app.approvals.respond(requestId, response, answers)
  }
  async approvalList() {
    return this.app.approvals.pendingRequests()
  }

  /* MCP — desktop only. The mobile app keeps no MCP surface. */
  async mcpStatuses() {
    return []
  }
  async mcpSetServers() {
    return { ok: false, error: 'MCP servers are a desktop feature.' }
  }
  async mcpTest() {
    return { ok: false, detail: 'MCP servers are a desktop feature.', toolCount: 0 }
  }

  /* reminders */
  async scheduleList(sessionId: string) {
    return this.app.scheduleList(sessionId)
  }
  async scheduleDelete(id: string) {
    return this.app.scheduleDelete(id)
  }

  /* background jobs — desktop only (no terminal on Android). */
  async jobList() {
    return []
  }

  /* task board */
  async taskBoardGet() {
    return this.app.taskBoardGet()
  }
  async taskBoardCreate(title: string, description?: string) {
    return this.app.taskBoardCreate(title, description)
  }
  async taskBoardUpdate(taskId: string, patch: Parameters<HalisBridge['taskBoardUpdate']>[1]) {
    return this.app.taskBoardUpdate(taskId, patch)
  }
  async taskBoardClaim(taskId: string, agentId: string, agentName: string) {
    return this.app.taskBoardClaim(taskId, agentId, agentName)
  }

  /* locks — no file editing on Android, no locks either. */
  async locksList() {
    return []
  }
  async locksRelease() {}

  /* telegraph */
  async tgStatus() {
    return this.app.telegraphStatus()
  }
  async tgCreateWallet() {
    return this.app.createTelegraphWallet()
  }
  async tgImportWallet(privateKey: string) {
    return this.app.importTelegraphWallet(privateKey)
  }
  async tgExportWallet() {
    return this.app.exportTelegraphWallet()
  }
  async tgMiners() {
    return this.app.telegraphMiners()
  }
  async tgIntents() {
    return this.app.telegraphIntents()
  }
  async tgAsk(params: { query: string; sessionId?: string }) {
    try {
      return await this.app.telegraphAsk(params.query, params.sessionId)
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err), minerId: '', minerName: '', result: null, costUsd: 0, durationMs: 0 }
    }
  }
  async tgReceipts() {
    return this.app.telegraphReceipts()
  }
  async tgVerifySignal(signalHash: string) {
    return this.app.telegraphVerifySignal(signalHash)
  }
}

export const bridge = new MobileBridge()
export type { HalisBridge }
