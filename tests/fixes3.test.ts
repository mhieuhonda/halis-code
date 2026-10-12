/** Regression tests for the third deep-scan sweep (sandbox hardening, loop
 * text accumulation, tool arg coercion, SSRF/quote guards, CRLF patches). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSandbox, SandboxError } from '@main/harness/sandbox'
import { FileLockManager } from '@main/harness/file-locking'
import { TaskBoard } from '@main/harness/task-board'
import { readFileTool, editFileTool } from '@main/harness/tools/fs'
import { grepTool } from '@main/harness/tools/search'
import { createToolRegistry } from '@main/harness/tools/registry'
import type { ToolContext, ToolDef } from '@main/harness/tools'
import { AgentRunner } from '@main/harness/loop'
import type { LlmDispatcher } from '@main/models/llm/client'
import type { LlmStreamEvent, LlmStreamOptions } from '@main/models/llm/types'
import { toOpenAiMessages } from '@main/models/llm/openai'
import { applyPatch, parsePatch } from '@main/harness/util/patch'
import { JobRegistry } from '@main/harness/jobs'
import { KeyVault } from '@main/models/keyvault'
import { quoteAsk, TelegraphError } from '@main/telegraph/client'
import { webFetchTool } from '@main/harness/tools/web'
import { TELEGRAPH_NETWORKS } from '@shared/types'
import { ApprovalManager, defaultSingleAgentPermissions } from '@main/harness/approvals'

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async (host: string) => {
    if (host === 'metadata.internal') return [{ address: '169.254.169.254', family: 4 }]
    if (host === 'lan.internal') return [{ address: '10.0.0.5', family: 4 }]
    return [{ address: '93.184.216.34', family: 4 }]
  }),
}))

let ws: string
let outside: string

beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), 'halis-fix3-ws-'))
  outside = mkdtempSync(join(tmpdir(), 'halis-fix3-out-'))
})

afterEach(() => {
  rmSync(ws, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
  vi.unstubAllGlobals()
})

function makeCtx(wsDir = ws): ToolContext {
  const sandbox = createSandbox(wsDir)
  const locks = new FileLockManager()
  return {
    sandbox,
    locks,
    taskBoard: new TaskBoard(join(wsDir, '.halis', 'task-board.json'), locks),
    approvals: new ApprovalManager(),
    workspace: sandbox.workspace,
    sessionId: 'ses_fix3',
    messageId: 'msg_fix3',
    agentId: 'tester',
    agentName: 'Tester',
    permissions: defaultSingleAgentPermissions(),
    alwaysRules: [],
    autoApproveAll: true,
    telegraph: {
      enabled: true,
      privateKey: '0x' + '1'.repeat(64),
      network: TELEGRAPH_NETWORKS['base-sepolia']!,
      autoApproveUpTo: 0,
      dailyBudgetUsd: 5,
      ledger: {} as ToolContext['telegraph']['ledger'],
    },
    emit: () => {},
    jobs: new JobRegistry(),
    schedules: {} as ToolContext['schedules'],
    mcp: {} as ToolContext['mcp'],
    todos: { get: () => [], replace: () => {} } as unknown as ToolContext['todos'],
    settings: {},
  }
}

/* ------------------------------------------------------------------ */
/* Sandbox: symlinked workspace root                                   */
/* ------------------------------------------------------------------ */

describe('sandbox with a symlinked workspace root', () => {
  it('resolves relative paths through the symlink (previously: every file tool died)', () => {
    writeFileSync(join(ws, 'file.ts'), 'export const x = 1\n')
    const link = join(tmpdir(), `halis-link-${Date.now()}`)
    symlinkSync(ws, link)
    try {
      const sandbox = createSandbox(link)
      expect(sandbox.safePath('file.ts')).toBe(join(ws, 'file.ts'))
    } finally {
      rmSync(link, { force: true })
    }
  })

  it('still rejects traversal from a symlinked root', () => {
    const link = join(tmpdir(), `halis-link-${Date.now()}`)
    symlinkSync(ws, link)
    try {
      const sandbox = createSandbox(link)
      expect(() => sandbox.safePath('../evil.txt')).toThrow(SandboxError)
    } finally {
      rmSync(link, { force: true })
    }
  })
})

/* ------------------------------------------------------------------ */
/* Sandbox: command screening gaps                                     */
/* ------------------------------------------------------------------ */

describe('sandbox blocklist gaps', () => {
  it('blocks rm -rf /* (glob over every top-level entry)', () => {
    const sandbox = createSandbox(ws)
    expect(() => sandbox.screenCommand('rm -rf /*')).toThrow(/filesystem root/)
  })

  it('blocks rm -rf $HOME', () => {
    const sandbox = createSandbox(ws)
    expect(() => sandbox.screenCommand('rm -rf $HOME')).toThrow(/home directory/)
  })

  it('blocks cd escapes with a chained command', () => {
    const sandbox = createSandbox(ws)
    expect(() => sandbox.screenCommand('cd .. && cat ../../secret')).toThrow(/inside the workspace/)
    expect(() => sandbox.screenCommand('cd / && ls')).toThrow(/inside the workspace/)
    expect(() => sandbox.screenCommand(`cd ${ws} && ls`)).not.toThrow()
  })
})

/* ------------------------------------------------------------------ */
/* grep: symlink re-jail                                               */
/* ------------------------------------------------------------------ */

describe('grep through a symlink pointing outside the workspace', () => {
  it('never reads the target of an escaping symlink', async () => {
    writeFileSync(join(outside, 'secret.txt'), 'TOPSECRETLEAK\n')
    symlinkSync(join(outside, 'secret.txt'), join(ws, 'leak.txt'))
    const result = await grepTool.execute({ pattern: 'LEAK' }, makeCtx())
    // The pattern echo may name the needle; a MATCH LINE (file:line: …) must
    // never appear for the symlinked file.
    expect(result.output).not.toMatch(/leak\.txt:\d+/)
    expect(result.output).toMatch(/No matches/)

    // And the same file via read_file must stay blocked too.
    await expect(readFileTool.execute({ path: 'leak.txt' }, makeCtx())).rejects.toThrow(SandboxError)
  })
})

/* ------------------------------------------------------------------ */
/* web_fetch SSRF guards                                               */
/* ------------------------------------------------------------------ */

describe('web_fetch SSRF guards', () => {
  it('accepts normal domains whose DNS resolves publicly', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('plain ok', { status: 200, headers: { 'content-type': 'text/plain' } })))
    const result = await webFetchTool.execute({ url: 'https://example.com/x' }, makeCtx())
    expect(result.output).toContain('plain ok')
  })

  it('refuses a domain that resolves to the cloud metadata address', async () => {
    const fetchSpy = vi.fn(async () => new Response('leak', { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)
    await expect(webFetchTool.execute({ url: 'http://metadata.internal/token' }, makeCtx())).rejects.toThrow(/private address/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('refuses literal private IPv4/IPv6 without any fetch', async () => {
    const fetchSpy = vi.fn(async () => new Response('x', { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)
    await expect(webFetchTool.execute({ url: 'http://10.1.2.3/x' }, makeCtx())).rejects.toThrow(/private|loopback/)
    await expect(webFetchTool.execute({ url: 'http://[fd12::1]/x' }, makeCtx())).rejects.toThrow()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

/* ------------------------------------------------------------------ */
/* grep with a path arg on a depth-changing workspace symlink          */
/* ------------------------------------------------------------------ */

describe('grep path narrowing on a depth-changing workspace symlink', () => {
  it('finds matches when the workspace is reached through a differently-deep link', async () => {
    mkdirSync(join(ws, 'src'), { recursive: true })
    writeFileSync(join(ws, 'src', 'x.ts'), 'NEEDLEHERE\n')
    // Link at a DIFFERENT depth than the real root: relative(link, target)
    // produces ../ hops that, re-resolved against the real root, landed
    // outside the jail and silently skipped every file.
    const deep = mkdtempSync(join(tmpdir(), 'halis-deep-'))
    mkdirSync(join(deep, 'a', 'b'), { recursive: true })
    const link = join(deep, 'a', 'b', 'link')
    symlinkSync(ws, link)
    try {
      const ctx = makeCtx(link)
      const result = await grepTool.execute({ pattern: 'NEEDLEHERE', path: 'src' }, ctx)
      expect(result.output).toMatch(/x\.ts:1: NEEDLEHERE/)
      const noPath = await grepTool.execute({ pattern: 'NEEDLEHERE' }, ctx)
      expect(noPath.output).toMatch(/x\.ts:1:/)
    } finally {
      rmSync(deep, { recursive: true, force: true })
    }
  })
})

/* ------------------------------------------------------------------ */
/* read_file / edit_file robustness                                    */
/* ------------------------------------------------------------------ */

describe('read_file argument hardening', () => {
  it('non-numeric offset falls back to line 1 instead of an empty slice', async () => {
    writeFileSync(join(ws, 'lines.txt'), 'one\ntwo\nthree\n')
    const result = await readFileTool.execute({ path: 'lines.txt', offset: 'line 2' }, makeCtx())
    expect(result.output).toContain('one')
    expect(result.output).not.toMatch(/^$/)
  })

  it('refuses to edit files over the 8 MB cap with a friendly message', async () => {
    const big = Buffer.alloc(8 * 1024 * 1024 + 1024, 65) // 'AAAA…' > cap
    writeFileSync(join(ws, 'big.txt'), big)
    const result = await editFileTool.execute({ path: 'big.txt', old_string: 'A', new_string: 'B' }, makeCtx())
    expect(result.output).toMatch(/File too large to edit/)
  })
})

/* ------------------------------------------------------------------ */
/* Agent loop: multi-step text + stringified booleans                  */
/* ------------------------------------------------------------------ */

describe('AgentRunner multi-step turns', () => {
  it('keeps EVERY step narration in the final text', async () => {
    const seenArgs: Array<Record<string, unknown>> = []
    const tool: ToolDef = {
      name: 'capture_tool',
      description: 'captures args',
      parameters: { type: 'object', properties: {} },
      kind: 'other',
      readOnly: true,
      execute: async (args) => {
        seenArgs.push(args)
        return { output: 'ok' }
      },
    }
    const registry = createToolRegistry()
    registry.register(tool)
    let call = 0
    const dispatcher = {
      stream: async (_modelId: string, _request: unknown, options: LlmStreamOptions) => {
        call++
        if (call === 1) {
          options.onEvent({ type: 'text', delta: 'Let me check. ' } satisfies LlmStreamEvent)
          return {
            text: 'Let me check. ',
            reasoning: '',
            toolCalls: [{ id: 'call_1', name: 'capture_tool', arguments: '{"replace_all": "false", "path": "x.txt"}' }],
            usage: { inputTokens: 10, outputTokens: 5 },
            finishReason: 'tool_calls' as const,
          }
        }
        options.onEvent({ type: 'text', delta: 'All done.' } satisfies LlmStreamEvent)
        return { text: 'All done.', reasoning: '', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 }, finishReason: 'stop' as const }
      },
    } as unknown as LlmDispatcher

    const runner = new AgentRunner(dispatcher, registry)
    const result = await runner.runTurn(
      {
        sessionId: 'ses_fix3',
        messageId: 'msg_fix3',
        modelId: 'test/model',
        systemPrompt: 'sys',
        history: [],
        swarm: false,
        maxSteps: 4,
        toolContext: makeCtx(),
      },
      () => {},
    )

    // Both steps' narration must survive into the final message content.
    expect(result.text).toContain('Let me check. ')
    expect(result.text).toContain('All done.')
    // Stringified booleans are coerced before the tool sees them.
    expect(seenArgs[0]?.replace_all).toBe(false)
    expect(seenArgs[0]?.path).toBe('x.txt')
  })
})

/* ------------------------------------------------------------------ */
/* OpenAI-compat: tool-result images                                   */
/* ------------------------------------------------------------------ */

describe('toOpenAiMessages with tool-result images', () => {
  it('attaches images as a synthetic user turn after the tool message', () => {
    const out = toOpenAiMessages([
      { role: 'assistant', content: '', toolCalls: [{ id: 'call_9', name: 'read_image', arguments: '{}' }] },
      {
        role: 'tool',
        toolCallId: 'call_9',
        toolName: 'read_image',
        content: 'Image loaded.',
        images: [{ mime: 'image/png', dataUri: 'data:image/png;base64,QUJD' }],
      },
    ])
    const toolMsg = out.find((m) => m.role === 'tool')
    expect(toolMsg).toBeTruthy()
    const synthetic = out[out.length - 1]!
    expect(synthetic.role).toBe('user')
    const parts = synthetic.content as Array<Record<string, unknown>>
    expect(parts.some((p) => p.type === 'image_url' && (p.image_url as { url: string }).url === 'data:image/png;base64,QUJD')).toBe(true)
  })
})

/* ------------------------------------------------------------------ */
/* applyPatch: CRLF + trailing newline preservation                    */
/* ------------------------------------------------------------------ */

describe('applyPatch line-ending preservation', () => {
  it('keeps CRLF endings and the trailing newline', () => {
    const { sections } = parsePatch('*** Begin Patch\n*** Update File: crlf.txt\n@@\n-old line\n+new line\n*** End Patch\n')
    let written = ''
    applyPatch({
      sections,
      read: (p) => (p === 'crlf.txt' ? { exists: true, content: 'alpha\r\nold line\r\n' } : { exists: false, content: '' }),
      write: (p, content) => {
        if (p === 'crlf.txt') written = content ?? ''
      },
    })
    expect(written).toBe('alpha\r\nnew line\r\n')
  })

  it('does not force a trailing newline onto files that had none', () => {
    const { sections } = parsePatch('*** Begin Patch\n*** Update File: noend.txt\n@@\n-old\n+new\n*** End Patch\n')
    let written = ''
    applyPatch({
      sections,
      read: (p) => (p === 'noend.txt' ? { exists: true, content: 'keep\nold' } : { exists: false, content: '' }),
      write: (p, content) => {
        if (p === 'noend.txt') written = content ?? ''
      },
    })
    expect(written).toBe('keep\nnew')
  })
})

/* ------------------------------------------------------------------ */
/* Jobs sweep                                                          */
/* ------------------------------------------------------------------ */

describe('JobRegistry.sweep', () => {
  it('drops settled jobs past the retention window', async () => {
    const jobs = new JobRegistry()
    const started = jobs.start({
      kind: 'bash',
      label: 'old job',
      ownerAgentId: 'tester',
      run: async (controls) => controls.settle('completed', 0),
      kill: () => {},
    })
    await started.wait
    expect(jobs.get(started.id)).toBeTruthy()
    jobs.sweep(-1) // cutoff in the future: everything is "older"
    expect(jobs.get(started.id)).toBeUndefined()
  })
})

/* ------------------------------------------------------------------ */
/* KeyVault atomic persistence                                         */
/* ------------------------------------------------------------------ */

describe('KeyVault atomic writes', () => {
  it('persists keys without leaving tmp files behind', () => {
    const vaultFile = join(ws, 'keys.bin')
    const vault = new KeyVault(vaultFile)
    vault.set('openai', 'sk-test-123')
    expect(vault.get('openai')).toBe('sk-test-123')
    expect(readdirSync(ws).filter((f) => f.endsWith('.tmp'))).toEqual([])

    const reloaded = new KeyVault(vaultFile)
    expect(reloaded.get('openai')).toBe('sk-test-123')
  })
})

/* ------------------------------------------------------------------ */
/* Telegraph quote guard                                               */
/* ------------------------------------------------------------------ */

describe('quoteAsk blind-price guard', () => {
  const network = TELEGRAPH_NETWORKS['base-sepolia']!

  it('refuses to quote an unparseable 402 challenge instead of returning $0.00', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 402, headers: { 'payment-required': '!!!not-json!!!' } })),
    )
    await expect(quoteAsk({ network, query: 'q' })).rejects.toThrow(TelegraphError)
  })

  it('refuses a 402 whose accepts entry carries no amount', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('', {
            status: 402,
            headers: { 'payment-required': Buffer.from(JSON.stringify({ accepts: [{ network: 'eip155:84532', payTo: '0x1' }] })).toString('base64') },
          }),
      ),
    )
    await expect(quoteAsk({ network, query: 'q' })).rejects.toThrow(TelegraphError)
  })

  it('still quotes a well-formed challenge and treats 2xx as free', async () => {
    const challenge = Buffer.from(
      JSON.stringify({ accepts: [{ network: 'eip155:84532', amount: '10000', payTo: '0xpay' }] }),
    ).toString('base64')
    let n = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        n++
        return n === 1
          ? new Response('', { status: 402, headers: { 'payment-required': challenge } })
          : new Response('{"ok":true}', { status: 200 })
      }),
    )
    await expect(quoteAsk({ network, query: 'q' })).resolves.toEqual({ amountUsd: 0.01, payTo: '0xpay', network: 'eip155:84532' })
    await expect(quoteAsk({ network, query: 'q2' })).resolves.toEqual({ amountUsd: 0, payTo: '', network: network.caip2 })
  })
})

/* ------------------------------------------------------------------ */
/* fs tool state-file guard sanity (unchanged behavior)                */
/* ------------------------------------------------------------------ */

describe('read_file directory behavior stays intact', () => {
  it('still tells the model to use list_dir for directories', async () => {
    mkdirSync(join(ws, 'dir'))
    const result = await readFileTool.execute({ path: 'dir' }, makeCtx())
    expect(result.output).toMatch(/directory/i)
  })
})
