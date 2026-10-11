/**
 * The preload bridge contract, shared by main (implementation) and renderer
 * (consumer). Pure types — no Electron imports.
 */
import type {
  AgentConfig,
  AgentRole,
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

export interface HalisBridge {
  /* settings */
  settingsGet(): Promise<AppSettings>
  settingsSet(patch: Partial<AppSettings>): Promise<AppSettings>
  workspacePick(): Promise<string | null>
  workspaceStatus(): Promise<{ workspace: string; exists: boolean; isGit: boolean; fileCount: number }>

  /* models & keys */
  modelCatalog(): Promise<CatalogSnapshot>
  modelKeyStatus(): Promise<Record<string, boolean>>
  modelSaveKey(providerId: string, key: string): Promise<{ ok: boolean }>
  modelRemoveKey(providerId: string): Promise<void>
  modelTestKey(modelId: string): Promise<{ ok: boolean; detail: string }>
  modelValidateAgentKey(candidate: { apiKey: string; modelId: string; agentId: string; existingAgents: AgentConfig[] }): Promise<{ conflict: boolean; agentName?: string; message: string }>

  /* sessions */
  sessionList(): Promise<SessionMeta[]>
  sessionNew(mode: ChatMode, title?: string, modelId?: string): Promise<Session>
  sessionGet(id: string): Promise<Session | null>
  sessionDelete(id: string): Promise<void>
  sessionRename(id: string, title: string): Promise<void>

  /* chat */
  chatSend(params: { sessionId: string; text: string; modelId?: string }): Promise<{ ok: boolean; error?: string }>
  chatStop(sessionId: string): Promise<void>

  /* swarm */
  swarmGetConfig(): Promise<SwarmConfig>
  swarmSaveConfig(config: SwarmConfig): Promise<{ ok: boolean; error?: string; warnings: string[] }>
  swarmValidate(config: SwarmConfig): Promise<{ ok: boolean; errors: string[]; warnings: string[] }>
  swarmRoles(): Promise<{ roles: AgentRole[] }>

  /* approvals */
  approvalRespond(requestId: string, response: 'allow' | 'always' | 'reject'): Promise<boolean>
  approvalList(): Promise<ApprovalRequest[]>

  /* task board */
  taskBoardGet(): Promise<BoardTask[]>
  taskBoardCreate(title: string, description?: string): Promise<BoardTask>
  taskBoardUpdate(taskId: string, patch: Partial<BoardTask>): Promise<BoardTask>
  taskBoardClaim(taskId: string, agentId: string, agentName: string): Promise<{ ok: boolean; error?: string }>

  /* locks */
  locksList(): Promise<Array<{ path: string; holderAgentId: string; holderName: string; mode: string; acquiredAt: number }>>
  locksRelease(path: string): Promise<void>

  /* telegraph */
  tgStatus(): Promise<TelegraphStatus>
  tgCreateWallet(): Promise<{ address: string; privateKey: string }>
  tgImportWallet(privateKey: string): Promise<{ address: string }>
  tgExportWallet(): Promise<{ privateKey: string } | null>
  tgMiners(): Promise<TelegraphMiner[]>
  tgIntents(): Promise<Array<{ id: string; label?: string }>>
  tgAsk(params: { query: string; sessionId?: string }): Promise<TelegraphAskResult & { error?: string }>
  tgReceipts(): Promise<TelegraphReceipt[]>
  tgVerifySignal(signalHash: string): Promise<{ found: boolean; detail: string }>

  /* live events */
  onEvent(callback: (event: import('./types').HarnessEvent) => void): () => void
}
