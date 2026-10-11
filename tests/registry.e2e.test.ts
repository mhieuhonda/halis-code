import { describe, expect, it } from 'vitest'
import { createToolRegistry } from '../src/main/harness/tools/registry'
import { createSandbox } from '../src/main/harness/sandbox'
import { FileLockManager } from '../src/main/harness/file-locking'
import { TaskBoard } from '../src/main/harness/task-board'
import { JobRegistry } from '../src/main/harness/jobs'
import { ScheduleStore } from '../src/main/harness/schedules'
import { McpManager } from '../src/main/harness/mcp'
import { TodoStore, type ToolContext } from '../src/main/harness/tools'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function makeCtx(workspace: string): ToolContext {
  const sandbox = createSandbox(workspace)
  const locks = new FileLockManager()
  const taskBoard = new TaskBoard(join(workspace, 'task-board.json'), locks)
  const emit = () => {}
  return {
    sandbox,
    locks,
    taskBoard,
    approvals: {} as ToolContext['approvals'],
    workspace,
    sessionId: 's1',
    messageId: 'm1',
    agentId: 'a1',
    agentName: 'A',
    permissions: { readOnly: false, autoApproveEdits: true, canRunShell: true, autoApproveShell: true, canUseTelegraph: false, usdcAutoApproveUpTo: 0 },
    alwaysRules: [],
    autoApproveAll: false,
    telegraph: { network: {} as never, autoApproveUpTo: 0, dailyBudgetUsd: 0, ledger: {} as never },
    emit,
    jobs: new JobRegistry(),
    schedules: new ScheduleStore(mkdtempSync(join(tmpdir(), 'halis-sch-'))),
    mcp: new McpManager(),
    todos: new TodoStore('s1', emit),
    settings: {},
  }
}

describe('tool registry end to end', () => {
  it('registers the full ported toolset', () => {
    const registry = createToolRegistry()
    const names = registry.listFor(false).map((t) => t.name)
    for (const expected of ['read_file', 'write_file', 'edit_file', 'multi_edit', 'delete_file', 'read_image', 'apply_patch', 'glob', 'grep', 'run_command', 'web_fetch', 'web_search', 'todo_write', 'ask_user', 'job_list', 'job_output', 'job_kill', 'schedule_create', 'schedule_list', 'schedule_delete', 'git_status', 'git_diff', 'git_log', 'git_commit', 'delegate_task', 'skill', 'task_board_create', 'telegraph_ask']) {
      expect(names, expected).toContain(expected)
    }
    // send_message is swarm-only.
    expect(registry.listFor(true).map((t) => t.name)).toContain('send_message')
  })

  it('writes, reads, multi-edits and patches files inside the workspace', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'halis-e2e-'))
    const ctx = makeCtx(ws)
    const registry = createToolRegistry()

    const write = await registry.get('write_file')!.execute({ path: 'hello.txt', content: 'alpha\nbeta\ngamma\n' }, ctx)
    expect(write.output).toContain('Created')

    const read = await registry.get('read_file')!.execute({ path: 'hello.txt' }, ctx)
    expect(read.output).toContain('1: alpha')

    const multi = await registry.get('multi_edit')!.execute({ path: 'hello.txt', edits: [{ old_string: 'alpha', new_string: 'ALPHA' }, { old_string: 'gamma', new_string: 'GAMMA' }] }, ctx)
    expect(multi.output).toContain('Applied 2 edit(s)')

    const edit = await registry.get('edit_file')!.execute({ path: 'hello.txt', old_string: 'ALPHA\nbeta', new_string: 'ALPHA\nbeta2' }, ctx)
    expect(edit.output).toContain('Edited')

    const patch = await registry.get('apply_patch')!.execute({ patch: '*** Begin Patch\n*** Add File: patch.txt\n+patched\n*** End Patch' }, ctx)
    expect(patch.output).toContain('Applied to')

    const fail = await registry.get('multi_edit')!.execute({ path: 'hello.txt', edits: [{ old_string: 'not-there', new_string: 'x' }, { old_string: 'ALPHA', new_string: 'Z' }] }, ctx)
    expect(fail.output).toContain('NOTHING was written')
  })

  it('manages todos and schedules', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'halis-e2e2-'))
    const ctx = makeCtx(ws)
    const registry = createToolRegistry()
    const todo = await registry.get('todo_write')!.execute({ todos: [{ content: 'step 1', status: 'completed' }, { content: 'step 2', status: 'in_progress' }] }, ctx)
    expect(todo.output).toContain('0 pending, 1 in progress, 1 completed')
    expect(ctx.todos.get()).toHaveLength(2)

    const schedule = await registry.get('schedule_create')!.execute({ title: 'check later', prompt: 'look at the logs', after_seconds: 90 }, ctx)
    expect(schedule.output).toContain('Reminder')
    const list = await registry.get('schedule_list')!.execute({}, ctx)
    expect(list.output).toContain('check later')
  })

  it('blocks workspace escapes and runs shell commands', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'halis-e2e3-'))
    const ctx = makeCtx(ws)
    const registry = createToolRegistry()
    await expect(registry.get('read_file')!.execute({ path: '../../etc/passwd' }, ctx)).rejects.toThrow(/outside the workspace/)
    const shell = await registry.get('run_command')!.execute({ command: 'echo hello-shell' }, ctx)
    expect(shell.output).toContain('hello-shell')
  })
})
