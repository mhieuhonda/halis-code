/** Regression tests for the deep-scan fixes (security + correctness). */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSandbox, SandboxError } from '@main/harness/sandbox'
import { fuzzyReplace } from '@main/harness/util/edit-match'
import { buildSelector } from '@main/harness/schedules'
import { JobRegistry } from '@main/harness/jobs'
import { ApprovalManager } from '@main/harness/approvals'
import { TaskBoard } from '@main/harness/task-board'
import { FileLockManager } from '@main/harness/file-locking'
import { sanitize } from '@main/harness/mcp'

let ws: string
let outside: string

beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), 'halis-fix-ws-'))
  outside = mkdtempSync(join(tmpdir(), 'halis-fix-out-'))
})

afterEach(() => {
  rmSync(ws, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
})

describe('sandbox symlink escape through a non-existent leaf', () => {
  it('rejects writes through a symlinked parent when the leaf does not exist', () => {
    mkdirSync(join(outside, 'drop'))
    symlinkSync(join(outside, 'drop'), join(ws, 'escape-link'))
    const sandbox = createSandbox(ws)
    expect(() => sandbox.safePath('escape-link/pwned.txt')).toThrow(SandboxError)
    expect(() => sandbox.safePath('escape-link/sub/deep.txt')).toThrow(SandboxError)
  })

  it('still allows creating normal new files inside the workspace', () => {
    const sandbox = createSandbox(ws)
    expect(sandbox.safePath('src/newfile.ts')).toBe(join(ws, 'src', 'newfile.ts'))
    expect(sandbox.safePath('brand-new.txt')).toBe(join(ws, 'brand-new.txt'))
  })
})

describe('fuzzyReplace fixes', () => {
  it('does not interpret $& and friends in new_string (tier 1)', () => {
    const result = fuzzyReplace('foo bar', 'foo', '[$&][$`][$\']', false)
    expect(result.content).toBe('[$&][$`][$\'] bar')
    expect(result.strategy).toBe('exact')
  })

  it('keeps unicode outside the replaced span untouched (tier 2)', () => {
    // NFD "café" on disk vs NFC needle: tier 1 misses, tier 2 hits — and the
    // curly-quoted note elsewhere must keep its exact bytes.
    const before = 'cafe\u0301 special\nplain line\n\u201Ccurly\u201D note'
    const result = fuzzyReplace(before, 'caf\u00E9 special', 'CAF\u00C9 SPECIAL', false)
    expect(result.strategy).toBe('normalized')
    expect(result.content).toContain('\u201Ccurly\u201D note')
    expect(result.content).toContain('plain line')
    expect(result.content).toContain('CAF\u00C9 SPECIAL')
  })

  it('preserves per-line endings when the needle spans a CRLF boundary (tier 3)', () => {
    const before = 'alpha\r\nbeta\r\nmatch me\r\ngamma\n'
    const result = fuzzyReplace(before, 'beta\nmatch me', 'beta\nreplaced', false)
    expect(result.strategy).toBe('line-based')
    expect(result.content).toContain('alpha\r\n')
    expect(result.content).toContain('beta\r\nreplaced\r\ngamma\n')
  })
})

describe('schedule selectors', () => {
  it('accepts cron sent as a plain string (the schema shape)', () => {
    const built = buildSelector({ cron: '*/5 * * * *' })
    if (!('selector' in built)) throw new Error(String((built as { error?: string }).error))
    expect(built.selector).toEqual({ kind: 'cron', expression: '*/5 * * * *' })
  })

  it('still accepts cron wrapped as {expression}', () => {
    const built = buildSelector({ cron: { expression: '0 9 * * 1' } })
    if (!('selector' in built)) throw new Error(String((built as { error?: string }).error))
    expect(built.selector).toEqual({ kind: 'cron', expression: '0 9 * * 1' })
  })

  it('accepts daily sent as a bare "HH:MM" string', () => {
    const built = buildSelector({ daily: '09:30' })
    if (!('selector' in built)) throw new Error(String((built as { error?: string }).error))
    expect(built.selector).toEqual({ kind: 'daily', time: '09:30' })
  })
})

describe('background job kill lifecycle', () => {
  it('reaches a terminal killed status and fires the completion notice', async () => {
    const jobs = new JobRegistry()
    let settleFn!: (status: 'completed' | 'killed' | 'failed' | 'running', code: number | null) => void
    const notices: Array<string | null> = []
    jobs.onSettled((id) => notices.push(jobs.takeNotice(id)))
    jobs.start({
      kind: 'bash',
      label: 'test job',
      ownerAgentId: 'tester',
      sessionId: 'ses_test',
      run: async (controls) => {
        settleFn = controls.settle
      },
      kill: () => {
        // simulate the shell exiting after the kill signal
        setTimeout(() => settleFn('killed', null), 5)
      },
    })
    const killResult = jobs.kill('bash-1', 'tester', 'test')
    expect(killResult.ok).toBe(true)
    await new Promise((r) => setTimeout(r, 30))
    expect(jobs.get('bash-1')?.status).toBe('killed')
    expect(notices[0]).toContain('finished')
  })
})

describe('approval scoping', () => {
  it('rejectAllForSession rejects only that session and leaves others parked', async () => {
    const approvals = new ApprovalManager()
    approvals.setHooks({ onRequest: () => {}, onResolved: () => {}, onRulesChanged: () => {} })
    const a = approvals.request({ sessionId: 'ses_a', agentId: 'x', agentName: 'X', kind: 'shell', title: 'A', detail: '', risk: 'low', tool: 'run_command' })
    const b = approvals.request({ sessionId: 'ses_b', agentId: 'x', agentName: 'X', kind: 'shell', title: 'B', detail: '', risk: 'low', tool: 'run_command' })
    approvals.rejectAllForSession('ses_a')
    expect(await a.wait).toBe('reject')
    const bStillPending = await Promise.race([b.wait.then(() => 'resolved'), new Promise<string>((resolve) => setTimeout(() => resolve('pending'), 20))])
    expect(bStillPending).toBe('pending')
    // b can still be answered normally afterwards.
    expect(approvals.respond(b.id, 'allow')).toBe(true)
    expect(await b.wait).toBe('allow')
  })
})

describe('task board lookups', () => {
  it('claim and update accept the id suffix the list tool renders', () => {
    const board = new TaskBoard(join(ws, 'board.json'), new FileLockManager())
    const task = board.create('Fix the login bug')
    const suffix = task.id.slice(-6)
    expect(board.claim(suffix, 'agent1', 'Agent One').id).toBe(task.id)
    expect(board.update(suffix, { status: 'done' }).status).toBe('done')
  })

  it('matches titles case-insensitively in update', () => {
    const board = new TaskBoard(join(ws, 'board2.json'), new FileLockManager())
    const task = board.create('Ship the release')
    expect(board.update(task.title.toLowerCase(), { status: 'in_progress' }).id).toBe(task.id)
  })

  it('never matches an empty needle', () => {
    const board = new TaskBoard(join(ws, 'board3.json'), new FileLockManager())
    board.create('Only task')
    expect(() => board.claim('', 'agent1', 'A')).toThrow(/Task not found/)
  })
})

describe('mcp qualified names', () => {
  it('sanitize is injective — server/tool pairs cannot collide', () => {
    // These two pairs produced the same qualified name under the old sanitizer.
    const pair1 = `mcp_${sanitize('a.b')}_${sanitize('c')}`
    const pair2 = `mcp_${sanitize('a')}_${sanitize('b_c')}`
    expect(pair1).not.toBe(pair2)
    // Broad check: distinct inputs never map to the same output.
    const inputs = ['a', 'a_b', 'a.b', 'a-b', 'a__b', 'a  b', 'A.B', 'x/y', 'x_y']
    const outputs = inputs.map(sanitize)
    expect(new Set(outputs).size).toBe(outputs.length)
  })
})
