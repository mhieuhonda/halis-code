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
  sessionFile(sessionId: string): string {
    return join(this.sessionsDir, `${sessionId}.json`)
  },
  /** Workspace-local state directory (task board, lock journal). */
  halisDir(workspace: string): string {
    return join(workspace, '.halis')
  },
  taskBoardFile(workspace: string): string {
    return join(this.halisDir(workspace), 'task-board.json')
  },
}
