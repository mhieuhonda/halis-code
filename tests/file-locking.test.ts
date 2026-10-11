/** File locking: hard locks exclude, advisory locks warn. */
import { describe, expect, it } from 'vitest'
import { FileLockManager, isLogLikePath, isStateFilePath } from '@main/harness/file-locking'

describe('FileLockManager', () => {
  it('grants a hard lock exclusively', () => {
    const locks = new FileLockManager()
    expect(locks.acquire('a.ts', 'a1', 'Rin', 'hard').ok).toBe(true)
    expect(() => locks.acquire('a.ts', 'a2', 'Bao', 'hard')).toThrow(/locked by Rin/)
  })

  it('releasing lets the next agent in', () => {
    const locks = new FileLockManager()
    locks.acquire('a.ts', 'a1', 'Rin', 'hard')
    locks.release('a.ts', 'a1')
    expect(locks.acquire('a.ts', 'a2', 'Bao', 'hard').ok).toBe(true)
  })

  it('same agent can re-acquire its own hard lock', () => {
    const locks = new FileLockManager()
    locks.acquire('a.ts', 'a1', 'Rin', 'hard')
    expect(locks.acquire('a.ts', 'a1', 'Rin', 'hard').ok).toBe(true)
  })

  it('advisory locks allow multiple holders but warn', () => {
    const locks = new FileLockManager()
    locks.acquire('app.log', 'a1', 'Rin', 'advisory')
    const second = locks.acquire('app.log', 'a2', 'Bao', 'advisory')
    expect(second.ok).toBe(true)
    expect(second.warning).toMatch(/Rin/)
    expect(locks.holders('app.log')).toHaveLength(2)
  })

  it('releaseAllFor drops every lock of an agent', () => {
    const locks = new FileLockManager()
    locks.acquire('a.ts', 'a1', 'Rin', 'hard')
    locks.acquire('b.ts', 'a1', 'Rin', 'hard')
    locks.acquire('c.ts', 'a2', 'Bao', 'hard')
    locks.releaseAllFor('a1')
    expect(locks.list().map((l) => l.holderAgentId)).toEqual(['a2'])
  })
})

describe('lock classification helpers', () => {
  it('treats log-like paths as advisory candidates', () => {
    expect(isLogLikePath('debug.log')).toBe(true)
    expect(isLogLikePath('logs/out.txt.log')).toBe(true)
    expect(isLogLikePath('src/app.ts')).toBe(false)
  })
  it('treats .halis state files as hard-lock candidates', () => {
    expect(isStateFilePath('workspace/.halis/task-board.json')).toBe(true)
    expect(isStateFilePath('src/main.ts')).toBe(false)
  })
})
