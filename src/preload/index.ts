/**
 * Preload bridge — exposes a minimal, typed API to the renderer via
 * contextBridge. No Node primitives leak through.
 */
import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc'
import type { HalisBridge } from '@shared/bridge'
import type { HarnessEvent } from '@shared/types'

const api: HalisBridge = {
  /* settings */
  settingsGet: () => ipcRenderer.invoke(IPC.settingsGet),
  settingsSet: (patch) => ipcRenderer.invoke(IPC.settingsSet, patch),
  workspacePick: () => ipcRenderer.invoke(IPC.workspacePick),
  workspaceStatus: () => ipcRenderer.invoke(IPC.workspaceStatus),

  /* models & keys */
  modelCatalog: () => ipcRenderer.invoke(IPC.modelCatalog),
  modelKeyStatus: () => ipcRenderer.invoke(IPC.modelKeyStatus),
  modelSaveKey: (providerId, key) => ipcRenderer.invoke(IPC.modelSaveKey, providerId, key),
  modelRemoveKey: (providerId) => ipcRenderer.invoke(IPC.modelRemoveKey, providerId),
  modelTestKey: (modelId) => ipcRenderer.invoke(IPC.modelTestKey, modelId),
  modelValidateAgentKey: (candidate) => ipcRenderer.invoke(IPC.modelValidateAgentKey, candidate),

  /* sessions */
  sessionList: () => ipcRenderer.invoke(IPC.sessionList),
  sessionNew: (mode, title, modelId) => ipcRenderer.invoke(IPC.sessionNew, mode, title, modelId),
  sessionGet: (id) => ipcRenderer.invoke(IPC.sessionGet, id),
  sessionDelete: (id) => ipcRenderer.invoke(IPC.sessionDelete, id),
  sessionRename: (id, title) => ipcRenderer.invoke(IPC.sessionRename, id, title),

  /* chat */
  chatSend: (params) => ipcRenderer.invoke(IPC.chatSend, params),
  chatStop: (sessionId) => ipcRenderer.invoke(IPC.chatStop, sessionId),

  /* swarm */
  swarmGetConfig: () => ipcRenderer.invoke(IPC.swarmGetConfig),
  swarmSaveConfig: (config) => ipcRenderer.invoke(IPC.swarmSaveConfig, config),
  swarmValidate: (config) => ipcRenderer.invoke(IPC.swarmValidate, config),
  swarmRoles: () => ipcRenderer.invoke(IPC.swarmRoles),

  /* approvals */
  approvalRespond: (requestId, response, answers) => ipcRenderer.invoke(IPC.approvalRespond, requestId, response, answers),
  approvalList: () => ipcRenderer.invoke(IPC.approvalList),

  /* mcp */
  mcpStatuses: () => ipcRenderer.invoke(IPC.mcpStatuses),
  mcpSetServers: (configs) => ipcRenderer.invoke(IPC.mcpSetServers, configs),
  mcpTest: (config) => ipcRenderer.invoke(IPC.mcpTest, config),

  /* reminders */
  scheduleList: (sessionId) => ipcRenderer.invoke(IPC.scheduleList, sessionId),
  scheduleDelete: (id) => ipcRenderer.invoke(IPC.scheduleDelete, id),

  /* jobs */
  jobList: () => ipcRenderer.invoke(IPC.jobList),

  /* task board */
  taskBoardGet: () => ipcRenderer.invoke(IPC.taskBoardGet),
  taskBoardCreate: (title, description) => ipcRenderer.invoke(IPC.taskBoardCreate, title, description),
  taskBoardUpdate: (taskId, patch) => ipcRenderer.invoke(IPC.taskBoardUpdate, taskId, patch),
  taskBoardClaim: (taskId, agentId, agentName) => ipcRenderer.invoke(IPC.taskBoardClaim, taskId, agentId, agentName),

  /* locks */
  locksList: () => ipcRenderer.invoke(IPC.locksList),
  locksRelease: (path) => ipcRenderer.invoke(IPC.locksRelease, path),

  /* telegraph */
  tgStatus: () => ipcRenderer.invoke(IPC.tgStatus),
  tgCreateWallet: () => ipcRenderer.invoke(IPC.tgCreateWallet),
  tgImportWallet: (privateKey) => ipcRenderer.invoke(IPC.tgImportWallet, privateKey),
  tgExportWallet: () => ipcRenderer.invoke(IPC.tgExportWallet),
  tgMiners: () => ipcRenderer.invoke(IPC.tgMiners),
  tgIntents: () => ipcRenderer.invoke(IPC.tgIntents),
  tgAsk: (params) => ipcRenderer.invoke(IPC.tgAsk, params),
  tgReceipts: () => ipcRenderer.invoke(IPC.tgReceipts),
  tgVerifySignal: (signalHash) => ipcRenderer.invoke(IPC.tgVerifySignal, signalHash),

  /* live events */
  onEvent: (callback: (event: HarnessEvent) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, event: HarnessEvent) => callback(event)
    ipcRenderer.on(IPC.event, listener)
    return () => ipcRenderer.removeListener(IPC.event, listener)
  },
}

contextBridge.exposeInMainWorld('halis', api)
