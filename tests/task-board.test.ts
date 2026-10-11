/** Task board: atomic claims, status transitions, persistence. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileLockManager } from '@main/harness/file-locking'
import { TaskBoard } from '@main/harness/task-board'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'halis-tb-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function board(): TaskBoard {
  return new TaskBoard(join(dir, 'task-board.json'), new FileLockManager())
}

describe('TaskBoard', () => {
  it('creates tasks as todo', () => {
    const b = board()
    const task = b.create('Write the parser', 'parse ts config', 'user')
    expect(task.status).toBe('todo')
    expect(task.title).toBe('Write the parser')
  })

  it('claims atomically — second agent loses', () => {
    const b = board()
    const task = b.create('Implement auth')
    expect(b.claim(task.id, 'a1', 'Rin').status).toBe('in_progress')
    expect(() => b.claim(task.id, 'a2', 'Bao')).toThrow(/already claimed by Rin/)
  })

  it('re-claiming your own task is a no-op', () => {
    const b = board()
    const task = b.create('Implement auth')
    b.claim(task.id, 'a1', 'Rin')
    expect(b.claim(task.id, 'a1', 'Rin').status).toBe('in_progress')
  })

  it('cannot claim a done task', () => {
    const b = board()
    const task = b.create('Done thing')
    b.claim(task.id, 'a1', 'Rin')
    b.complete(task.id, 'a1', 'Rin')
    expect(() => b.claim(task.id, 'a2', 'Bao')).toThrow(/already done/)
  })

  it('updates status and blocked reasons', () => {
    const b = board()
    const task = b.create('Blocked thing')
    const updated = b.update(task.id, { blockedReason: 'waiting on API key' })
    expect(updated.status).toBe('blocked')
    const cleared = b.update(task.id, { status: 'todo' })
    expect(cleared.status).toBe('todo')
  })

  it('persists across board instances', () => {
    const b1 = board()
    const task = b1.create('Survives restarts')
    b1.claim(task.id, 'a1', 'Rin')
    const b2 = board()
    const reloaded = b2.get(task.id)
    expect(reloaded?.assigneeName).toBe('Rin')
    expect(reloaded?.status).toBe('in_progress')
  })

  it('renders a prompt summary', () => {
    const b = board()
    b.create('First')
    b.create('Second')
    const text = b.renderForPrompt()
    expect(text).toMatch(/\[todo\] First/)
    expect(text).toMatch(/\[todo\] Second/)
  })
})
