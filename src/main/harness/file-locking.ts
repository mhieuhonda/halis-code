/**
 * File locking — keeps a swarm from trampling itself.
 *
 *  - hard locks: exclusive. Editing a file takes a hard lock for the agent
 *    until its turn ends; state files (.halis/*.json) are always hard-locked
 *    around read-modify-write cycles.
 *  - advisory locks: shared bookkeeping. Log-style files can have several
 *    writers; the harness records them and surfaces conflicts as warnings
 *    instead of blocking.
 */
import type { LockInfo } from '@shared/types'

export class FileLockManager {
  private locks = new Map<string, Map<string, LockInfo>>() // path -> holderAgentId -> info
  private hooks: { onChanged?: (locks: LockInfo[]) => void } = {}

  setHooks(hooks: { onChanged?: (locks: LockInfo[]) => void }): void {
    this.hooks = hooks
  }

  private emit(): void {
    this.hooks.onChanged?.(this.list())
  }

  list(): LockInfo[] {
    const out: LockInfo[] = []
    for (const holders of this.locks.values()) out.push(...holders.values())
    return out.sort((a, b) => a.acquiredAt - b.acquiredAt)
  }

  holders(path: string): LockInfo[] {
    return [...(this.locks.get(path)?.values() ?? [])]
  }

  /**
   * Acquire a lock. Returns a warning string for advisory collisions;
   * throws for hard-lock conflicts.
   */
  acquire(path: string, agentId: string, agentName: string, mode: 'hard' | 'advisory'): { ok: true; warning?: string } {
    let holders = this.locks.get(path)
    if (!holders) {
      holders = new Map()
      this.locks.set(path, holders)
    }
    const others = [...holders.values()].filter((l) => l.holderAgentId !== agentId)
    if (mode === 'hard' && others.length) {
      const other = others[0]!
      throw new Error(
        `File is locked by ${other.holderName} (hard lock since ${new Date(other.acquiredAt).toLocaleTimeString()}). Wait for them to finish or coordinate through the planner.`,
      )
    }
    // Advisory must still YIELD to an existing hard lock: "hard = exclusive"
    // is the whole contract, and an advisory write through a hard-locked file
    // (a log file being patched by another agent) lost updates silently.
    if (mode === 'advisory' && others.some((o) => o.mode === 'hard')) {
      const other = others.find((o) => o.mode === 'hard')!
      throw new Error(
        `File is locked by ${other.holderName} (hard lock since ${new Date(other.acquiredAt).toLocaleTimeString()}). Wait for them to finish or coordinate through the planner.`,
      )
    }
    if (mode === 'advisory' && others.length) {
      const names = others.map((o) => o.holderName).join(', ')
      holders.set(agentId, { path, holderAgentId: agentId, holderName: agentName, mode, acquiredAt: Date.now() })
      this.emit()
      return { ok: true, warning: `Note: ${names} also holds an advisory lock on this file — coordinate your writes.` }
    }
    holders.set(agentId, { path, holderAgentId: agentId, holderName: agentName, mode, acquiredAt: Date.now() })
    this.emit()
    return { ok: true }
  }

  release(path: string, agentId: string): void {
    const holders = this.locks.get(path)
    if (!holders) return
    holders.delete(agentId)
    if (!holders.size) this.locks.delete(path)
    this.emit()
  }

  releaseAllFor(agentId: string): void {
    for (const [path, holders] of this.locks) {
      holders.delete(agentId)
      if (!holders.size) this.locks.delete(path)
    }
    this.emit()
  }

  releasePath(path: string): void {
    this.locks.delete(path)
    this.emit()
  }

  clear(): void {
    this.locks.clear()
    this.emit()
  }

  /** Advisory lock helper for append-style log writes. */
  withAdvisory<T>(path: string, agentId: string, agentName: string, fn: () => T): { result: T; warning?: string } {
    const { warning } = this.acquire(path, agentId, agentName, 'advisory')
    try {
      return { result: fn(), warning }
    } finally {
      this.release(path, agentId)
    }
  }
}

export function isLogLikePath(path: string): boolean {
  // The segment must START with `log(s)` — the old bare `logs?\//` test
  // matched anywhere ("catalogs/…", "backlogs/x.md") and silently demoted
  // regular files to advisory locking.
  return /\.(log|txt\.log|out|err)$/i.test(path) || /(^|[\\/])logs?[\\/]/i.test(path)
}

/** Files whose corruption would break the harness itself: always hard-locked. */
export function isStateFilePath(path: string): boolean {
  return /[/\\]\.halis[/\\]/.test(path)
}
