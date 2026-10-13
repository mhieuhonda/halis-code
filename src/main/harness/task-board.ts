/**
 * Shared Task Board — the swarm's coordination surface. Agents claim a task
 * before working on it; claims are serialized through a hard file lock on
 * the board file itself so two agents can never grab the same task.
 */
import type { BoardTask, TaskStatus } from '@shared/types'
import { existsSync, readFileSync } from 'node:fs'
import { newId } from '../util/id'
import { writeJson } from '../util/json'
import { FileLockManager } from './file-locking'

export class TaskBoard {
  private tasks: BoardTask[] = []
  private hooks: { onChanged?: (tasks: BoardTask[]) => void } = {}
  private systemAgentId = 'system'
  private systemAgentName = 'Harness'

  constructor(
    private readonly boardFile: string,
    private readonly locks: FileLockManager,
  ) {}

  setHooks(hooks: { onChanged?: (tasks: BoardTask[]) => void }): void {
    this.hooks = hooks
  }

  private load(): void {
    try {
      if (existsSync(this.boardFile)) {
        const parsed: unknown = JSON.parse(readFileSync(this.boardFile, 'utf8'))
        // Wrong-shape JSON (hand-edited) must degrade to an empty board, not
        // brick every task-board tool call for the rest of the run.
        this.tasks = Array.isArray(parsed) ? (parsed as BoardTask[]) : []
      }
    } catch (err) {
      console.warn('[halis] task board load failed:', err)
      this.tasks = []
    }
  }

  private persist(): void {
    writeJson(this.boardFile, this.tasks)
    this.hooks.onChanged?.(this.tasks)
  }

  /** Read-modify-write under the board's hard lock. */
  private transaction<T>(agentId: string, agentName: string, fn: () => T): T {
    this.locks.acquire(this.boardFile, agentId || this.systemAgentId, agentName || this.systemAgentName, 'hard')
    try {
      this.load()
      const result = fn()
      this.persist()
      return result
    } finally {
      this.locks.release(this.boardFile, agentId || this.systemAgentId)
    }
  }

  all(): BoardTask[] {
    this.load()
    return [...this.tasks]
  }

  get(taskId: string): BoardTask | undefined {
    return this.all().find((t) => t.id === taskId)
  }

  /**
   * Shared task lookup for tool calls: full id, id suffix (task_board_list
   * renders ids as the last 6 chars, e.g. "#4f2a1b") or exact title
   * (case-insensitive). Suffix must be non-empty — ''.endsWith('') is true
   * and would match the first task randomly.
   */
  private findTask(taskId: string): BoardTask | undefined {
    const needle = taskId.trim()
    if (!needle) return undefined
    const lower = needle.toLowerCase()
    return this.tasks.find(
      (t) => t.id === needle || (needle.length < t.id.length && t.id.endsWith(needle)) || t.title.toLowerCase() === lower,
    )
  }

  create(title: string, description?: string, createdBy = 'user', agentId = '', agentName = ''): BoardTask {
    return this.transaction(agentId, agentName, () => {
      const task: BoardTask = {
        id: newId('task'),
        title: title.trim(),
        description: description?.trim() || undefined,
        status: 'todo',
        createdBy,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      this.tasks.push(task)
      return task
    })
  }

  update(taskId: string, patch: Partial<BoardTask>, agentId = '', agentName = ''): BoardTask {
    return this.transaction(agentId, agentName, () => {
      const task = this.findTask(taskId)
      if (!task) throw new Error(`Task not found: ${taskId}`)
      if (patch.status) task.status = patch.status
      if (patch.title !== undefined) task.title = patch.title
      if (patch.description !== undefined) task.description = patch.description
      if (patch.assignee !== undefined) {
        task.assignee = patch.assignee
        task.assigneeName = patch.assigneeName
        if (patch.assignee && task.status === 'todo') task.status = 'in_progress'
      }
      if (patch.blockedReason !== undefined) {
        task.blockedReason = patch.blockedReason
        if (patch.blockedReason && task.status !== 'done') task.status = 'blocked'
        // Clearing the reason must UN-block: leaving the status stuck at
        // 'blocked' with an invisible empty reason makes the task look
        // dead on the board forever.
        else if (!patch.blockedReason && task.status === 'blocked') task.status = task.assignee ? 'in_progress' : 'todo'
      }
      task.updatedAt = Date.now()
      return task
    })
  }

  /** Claim semantics: atomic take, fails if another agent already holds it. */
  claim(taskId: string, agentId: string, agentName: string): BoardTask {
    return this.transaction(agentId, agentName, () => {
      const task = this.findTask(taskId)
      if (!task) throw new Error(`Task not found: ${taskId}`)
      if (task.status === 'done') throw new Error(`Task ${task.title} is already done.`)
      if (task.assignee && task.assignee !== agentId) {
        throw new Error(`Task ${task.title} is already claimed by ${task.assigneeName ?? 'another agent'}.`)
      }
      if (task.assignee === agentId) return task
      task.assignee = agentId
      task.assigneeName = agentName
      task.status = 'in_progress'
      task.updatedAt = Date.now()
      return task
    })
  }

  complete(taskId: string, agentId: string, agentName: string): BoardTask {
    return this.update(taskId, { status: 'done' }, agentId, agentName)
  }

  /** Board snapshot for prompts. */
  renderForPrompt(): string {
    const tasks = this.all()
    if (!tasks.length) return 'Task board is empty.'
    const lines = tasks.map((t) => {
      const assignee = t.assigneeName ? ` → ${t.assigneeName}` : ''
      return `- [${t.status}] ${t.title}${assignee}${t.blockedReason ? ` (blocked: ${t.blockedReason})` : ''}`
    })
    return lines.join('\n')
  }

  clear(): void {
    this.tasks = []
    this.persist()
  }
}

export type { TaskStatus }
