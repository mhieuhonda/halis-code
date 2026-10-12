/**
 * IPC channel contract. Channel names + payload types shared between the
 * main process handlers and the renderer client.
 */
import type {
  AgentConfig,
  AppSettings,
  ApprovalRequest,
  BoardTask,
  CatalogSnapshot,
  ChatMode,
  Session,
  SessionMeta,
  SwarmConfig,
  TelegraphAskResult,
  TelegraphMiner,
  TelegraphReceipt,
  TelegraphStatus,
} from './types'

export const IPC = {
  /* app / settings */
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  workspacePick: 'workspace:pick',
  workspaceStatus: 'workspace:status',

  /* models & keys */
  modelCatalog: 'model:catalog',
  modelKeyStatus: 'model:key-status',
  modelSaveKey: 'model:save-key',
  modelRemoveKey: 'model:remove-key',
  modelTestKey: 'model:test-key',
  modelValidateAgentKey: 'model:validate-agent-key',

  /* sessions */
  sessionList: 'session:list',
  sessionNew: 'session:new',
  sessionGet: 'session:get',
  sessionDelete: 'session:delete',
  sessionRename: 'session:rename',

  /* chat */
  chatSend: 'chat:send',
  chatStop: 'chat:stop',

  /* swarm */
  swarmGetConfig: 'swarm:get-config',
  swarmSaveConfig: 'swarm:save-config',
  swarmValidate: 'swarm:validate',
  swarmRoles: 'swarm:roles',

  /* approvals */
  approvalRespond: 'approval:respond',
  approvalList: 'approval:list',

  /* mcp */
  mcpStatuses: 'mcp:statuses',
  mcpSetServers: 'mcp:set-servers',
  mcpTest: 'mcp:test',

  /* reminders */
  scheduleList: 'schedule:list',
  scheduleDelete: 'schedule:delete',

  /* background jobs */
  jobList: 'jobs:list',

  /* task board */
  taskBoardGet: 'taskboard:get',
  taskBoardCreate: 'taskboard:create',
  taskBoardUpdate: 'taskboard:update',
  taskBoardClaim: 'taskboard:claim',

  /* locks */
  locksList: 'locks:list',
  locksRelease: 'locks:release',

  /* telegraph */
  tgStatus: 'tg:status',
  tgCreateWallet: 'tg:create-wallet',
  tgImportWallet: 'tg:import-wallet',
  tgExportWallet: 'tg:export-wallet',
  tgMiners: 'tg:miners',
  tgIntents: 'tg:intents',
  tgAsk: 'tg:ask',
  tgReceipts: 'tg:receipts',
  tgVerifySignal: 'tg:verify-signal',

  /* events */
  event: 'halis:event',
} as const

/* ------------------------------------------------------------------ */

export interface IpcApi {
  settingsGet(): AppSettings
  settingsSet(patch: Partial<AppSettings>): AppSettings
  workspacePick(): string | null
  workspaceStatus(): { workspace: string; exists: boolean; isGit: boolean; fileCount: number }

  modelCatalog(): CatalogSnapshot
  modelKeyStatus(): Record<string, boolean>
  modelSaveKey(providerId: string, key: string): { ok: boolean; error?: string }
  modelRemoveKey(providerId: string): void
  modelTestKey(modelId: string): { ok: boolean; detail: string }
  modelValidateAgentKey(candidate: {
    apiKey: string
    modelId: string
    agentId: string
    existingAgents: AgentConfig[]
  }): { conflict: boolean; agentName?: string; message: string }

  sessionList(): SessionMeta[]
  sessionNew(mode: ChatMode, title?: string): Session
  sessionGet(sessionId: string): Session | null
  sessionDelete(sessionId: string): void
  sessionRename(sessionId: string, title: string): void

  chatSend(params: {
    sessionId: string
    text: string
    /** Agent mode: model override for this session. */
    modelId?: string
  }): { ok: boolean; error?: string }
  chatStop(sessionId: string): void

  swarmGetConfig(): SwarmConfig
  swarmSaveConfig(config: SwarmConfig): { ok: boolean; error?: string; warnings: string[] }
  swarmValidate(config: SwarmConfig): { ok: boolean; errors: string[]; warnings: string[] }
  swarmRoles(): { roles: unknown[] }

  approvalRespond(requestId: string, response: 'allow' | 'always' | 'reject'): void
  approvalList(): ApprovalRequest[]

  taskBoardGet(): BoardTask[]
  taskBoardCreate(title: string, description?: string): BoardTask
  taskBoardUpdate(taskId: string, patch: Partial<BoardTask>): BoardTask
  taskBoardClaim(taskId: string, agentId: string): { ok: boolean; error?: string }

  locksList(): Array<{ path: string; holderAgentId: string; holderName: string; mode: string; acquiredAt: number }>
  locksRelease(path: string): void

  tgStatus(): Promise<TelegraphStatus>
  tgCreateWallet(): Promise<{ address: string; privateKey: string }>
  tgImportWallet(privateKey: string): Promise<{ address: string }>
  tgExportWallet(): Promise<{ privateKey: string } | null>
  tgMiners(): Promise<TelegraphMiner[]>
  tgIntents(): Promise<Array<{ id: string; label?: string }>>
  tgAsk(params: { query: string; sessionId?: string }): Promise<TelegraphAskResult & { error?: string }>
  tgReceipts(): Promise<TelegraphReceipt[]>
  tgVerifySignal(signalHash: string): Promise<{ found: boolean; detail: string }>

  onEvent(callback: (event: unknown) => void): () => void
}

export interface KeyStatus {
  [providerId: string]: boolean
}
