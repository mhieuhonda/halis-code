/**
 * Shared Task Board — mobile edition. Same semantics as desktop minus the
 * file-lock layer (single process, single device): mutations are plain
 * read-modify-write over an in-memory list persisted to IndexedDB.
 */
import type { BoardTask, TaskStatus } from '@shared/types'
import { readJson, writeJson } from './storage'
import { newId } from './util/id'

const STORE_KEY = 'task-board'

export class TaskBoard {
  private tasks: BoardTask[] = []
  private hooks: { onChanged?: (tasks: BoardTask[]) => void } = {}
  private loaded = false

  setHooks(hooks: { onChanged?: (tasks: BoardTask[]) => void }): void {
    this.hooks = hooks
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    try {
      const parsed = await readJson<unknown>(STORE_KEY, [])
      this.tasks = Array.isArray(parsed) ? (parsed as BoardTask[]) : []
    } catch {
      this.tasks = []
    }
  }

  private async persist(): Promise<void> {
    await writeJson(STORE_KEY, this.tasks)
    this.hooks.onChanged?.(this.tasks)
  }

  async all(): Promise<BoardTask[]> {
    await this.ensureLoaded()
    return [...this.tasks]
  }

  async get(taskId: string): Promise<BoardTask | undefined> {
    return (await this.all()).find((t) => t.id === taskId)
  }

  private findTask(taskId: string): BoardTask | undefined {
    const needle = taskId.trim()
    if (!needle) return undefined
    const lower = needle.toLowerCase()
    return this.tasks.find(
      (t) => t.id === needle || (needle.length < t.id.length && t.id.endsWith(needle)) || t.title.toLowerCase() === lower,
    )
  }

  async create(title: string, description?: string, createdBy = 'user', agentId = '', agentName = ''): Promise<BoardTask> {
    await this.ensureLoaded()
    const task: BoardTask = {
      id: newId('task'),
      title: title.trim(),
      description: description?.trim() || undefined,
      status: 'todo',
      createdBy,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    void agentId
    void agentName
    this.tasks.push(task)
    await this.persist()
    return task
  }

  async update(taskId: string, patch: Partial<BoardTask>, agentId = '', agentName = ''): Promise<BoardTask> {
    await this.ensureLoaded()
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
      else if (!patch.blockedReason && task.status === 'blocked') task.status = task.assignee ? 'in_progress' : 'todo'
    }
    task.updatedAt = Date.now()
    void agentId
    void agentName
    await this.persist()
    return task
  }

  /** Claim semantics: atomic take, fails if another agent already holds it. */
  async claim(taskId: string, agentId: string, agentName: string): Promise<BoardTask> {
    await this.ensureLoaded()
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
    await this.persist()
    return task
  }

  async complete(taskId: string, agentId: string, agentName: string): Promise<BoardTask> {
    return this.update(taskId, { status: 'done' }, agentId, agentName)
  }

  /** Board snapshot for prompts. */
  async renderForPrompt(): Promise<string> {
    const tasks = await this.all()
    if (!tasks.length) return 'Task board is empty.'
    const lines = tasks.map((t) => {
      const assignee = t.assigneeName ? ` → ${t.assigneeName}` : ''
      return `- [${t.status}] ${t.title}${assignee}${t.blockedReason ? ` (blocked: ${t.blockedReason})` : ''}`
    })
    return lines.join('\n')
  }

  async clear(): Promise<void> {
    this.tasks = []
    await this.persist()
  }
}

export type { TaskStatus }
