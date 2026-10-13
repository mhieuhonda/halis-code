import { app } from 'electron'
import { join } from 'node:path'

export const paths = {
  get userData(): string {
    return app.getPath('userData')
  },
  get settingsFile(): string {
    return join(this.userData, 'settings.json')
  },
  get keysFile(): string {
    return join(this.userData, 'keys.bin')
  },
  get swarmFile(): string {
    return join(this.userData, 'swarm.json')
  },
  get sessionsDir(): string {
    return join(this.userData, 'sessions')
  },
  get receiptsFile(): string {
    return join(this.userData, 'telegraph-receipts.json')
  },
  get approvalRulesFile(): string {
    return join(this.userData, 'approval-rules.json')
  },
  sessionFile(sessionId: string): string {
    // Session ids come from the renderer over IPC; reject anything that is
    // not a plain generated id ("../../settings" must never reach the path).
    if (!/^[\w-]+$/.test(sessionId)) {
      throw new Error(`Invalid session id: ${sessionId.slice(0, 40)}`)
    }
    return join(this.sessionsDir, `${sessionId}.json`)
  },
  /** Workspace-local state directory (task board, lock journal). */
  halisDir(workspace: string): string {
    return join(workspace, '.halis')
  },
  taskBoardFile(workspace: string): string {
    return join(this.halisDir(workspace), 'task-board.json')
  },
  /** Full tool outputs spilled to disk. */
  get toolOutputDir(): string {
    return join(this.userData, 'tool-outputs')
  },
}
