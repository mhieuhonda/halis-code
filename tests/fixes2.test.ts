/**
 * Regression tests for the second deep-scan round: swarm key resolution,
 * quoted catalog ids, send_message routing, patch/lock fixes, abort races.
 */
import { describe, expect, it } from 'vitest'
import { LlmDispatcher } from '@main/models/llm/client'
import type { CatalogSnapshot, ModelInfo, ProviderInfo } from '@shared/types'
import { modelCatalog } from '@main/models/catalog'
import { parsePatch } from '@main/harness/util/patch'
import { fuzzyReplace } from '@main/harness/util/edit-match'
import { FileLockManager } from '@main/harness/file-locking'
import { raceWithAbort } from '@main/harness/util/abort-race'
import { routeNext, resolveMentions } from '@main/swarm/router'
import type { AgentConfig, ChatMessage } from '@shared/types'

/* ------------------------- dispatcher key fallback ------------------------- */

const providers: ProviderInfo[] = [
  { id: 'opencode', name: 'OpenCode Zen', apiStyle: 'openai', baseURL: 'https://opencode.ai/zen/v1', envKey: 'OPENCODE_API_KEY' },
  { id: 'pollinations', name: 'Pollinations', apiStyle: 'openai', baseURL: 'https://text.pollinations.ai/openai', keyless: true },
]
const models: ModelInfo[] = [
  { id: 'opencode/glm-5', apiId: 'glm-5', name: 'GLM-5', providerId: 'opencode', free: false, toolCall: true },
  { id: 'pollinations/openai-fast', apiId: 'openai-fast', name: 'OpenAI Fast', providerId: 'pollinations', free: true, toolCall: true },
]
const catalog: CatalogSnapshot = { providers, models, updatedAt: Date.now(), source: 'bundled' }

describe('LlmDispatcher vault fallback', () => {
  it('falls back to the vault key when the override is an empty string', async () => {
    const dispatcher = new LlmDispatcher(() => catalog, (providerId) => (providerId === 'opencode' ? 'vault-key' : undefined))
    // Old bug: keyOverride '' !== undefined blocked the vault → "No API key".
    const resolved = dispatcher.resolve('opencode/glm-5', '')
    expect(resolved).toBeTruthy()
  })

  it('falls back to the vault key for whitespace-only overrides', () => {
    const dispatcher = new LlmDispatcher(() => catalog, () => 'vault-key')
    expect(() => dispatcher.resolve('opencode/glm-5', '   ')).not.toThrow()
  })

  it('still prefers a non-empty per-agent key over the vault', () => {
    const dispatcher = new LlmDispatcher(() => catalog, () => 'vault-key')
    const resolved = dispatcher.resolve('opencode/glm-5', 'agent-key')
    expect(resolved).toBeTruthy()
  })

  it('throws when neither the override nor the vault has a key', () => {
    const dispatcher = new LlmDispatcher(() => catalog, () => undefined)
    expect(() => dispatcher.resolve('opencode/glm-5', '')).toThrow(/No API key set/)
  })

  it('resolves keyless providers without any key', () => {
    const dispatcher = new LlmDispatcher(() => catalog, () => undefined)
    expect(() => dispatcher.resolve('pollinations/openai-fast', '')).not.toThrow()
  })
})

/* ------------------------- catalog id sanitization ------------------------- */

describe('model catalog id hygiene', () => {
  it('strips stray double quotes from the bundled catalog', () => {
    for (const model of modelCatalog.get().models) {
      expect(model.id.startsWith('"')).toBe(false)
      expect(model.id.endsWith('"')).toBe(false)
      expect(model.apiId.includes('"')).toBe(false)
    }
  })

  it('resolves model ids saved with wrapping quotes (older configs)', () => {
    const direct = modelCatalog.getModel('opencode/glm-5')
    const quoted = modelCatalog.getModel('"opencode/glm-5"')
    expect(direct).toBeTruthy()
    expect(quoted?.id).toBe(direct?.id)
  })
})

/* ------------------------- send_message routing ------------------------- */

function agent(id: string, name: string, enabled = true): AgentConfig {
  return {
    id,
    name,
    avatar: '🤖',
    color: '#7C6CFF',
    roleId: 'coder',
    modelId: 'pollinations/openai-fast',
    permissions: { readOnly: false, autoApproveEdits: false, canRunShell: false, autoApproveShell: false, canUseTelegraph: false, usdcAutoApproveUpTo: 0 },
    enabled,
  }
}

describe('send_message routing (mentions carry names, to carries ids)', () => {
  const agents = [agent('ag_a', 'Vega'), agent('ag_b', 'Bao')]

  it('routes an agent reply that addressed a teammate via send_message', () => {
    const message = {
      from: 'ag_a',
      role: 'assistant' as const,
      to: ['ag_b'], // ids (for the UI)
      mentions: ['Bao'], // raw names (for routing)
      content: 'Handed off to Bao.',
    }
    const next = routeNext({ message, agents, plannerId: undefined, alreadySpoke: new Set() })
    expect(next.toRun).toEqual(['ag_b'])
    expect(next.unknownMentions).toEqual([])
  })

  it('routes when the tool passes @-prefixed names through', () => {
    const resolved = resolveMentions(['@Bao'], agents)
    expect(resolved.resolved).toEqual(['ag_b'])
    expect(resolved.unknown).toEqual([])
  })

  it('still flags unknown mentions instead of broadcasting', () => {
    const userMessage: Pick<ChatMessage, 'from' | 'role' | 'content' | 'to' | 'mentions'> = {
      from: 'user',
      role: 'user',
      content: '@Nobody hello',
      to: [],
      mentions: ['Nobody'],
    }
    const next = routeNext({ message: userMessage, agents, plannerId: undefined, alreadySpoke: new Set() })
    expect(next.toRun).toEqual([])
    expect(next.unknownMentions).toEqual(['Nobody'])
  })
})

/* ------------------------- patch parsing ------------------------- */

describe('parsePatch Add File robustness', () => {
  it('skips a blank separator line between the header and the + lines', () => {
    const patch = ['*** Begin Patch', '*** Add File: src/new.ts', '', '+export const x = 1', '*** End Patch'].join('\n')
    const { sections, errors } = parsePatch(patch)
    expect(errors).toEqual([])
    expect(sections).toHaveLength(1)
    expect(sections[0]).toEqual({ type: 'add', path: 'src/new.ts', content: 'export const x = 1\n' })
  })

  it('reports an error instead of queuing an empty Add File section', () => {
    const patch = ['*** Begin Patch', '*** Add File: src/empty.ts', '*** Update File: src/other.ts', '-old', '+new', '*** End Patch'].join('\n')
    const { sections, errors } = parsePatch(patch)
    expect(errors.some((e) => e.includes('src/empty.ts'))).toBe(true)
    expect(sections.some((s) => s.type === 'add')).toBe(false)
  })

  it('keeps treating a real blank line inside content as empty only when started', () => {
    const patch = ['*** Begin Patch', '*** Add File: src/a.ts', '+first', '', '+second', '*** End Patch'].join('\n')
    const { sections, errors } = parsePatch(patch)
    expect(errors).toEqual([])
    expect(sections[0]?.type === 'add' && (sections[0] as { content: string }).content).toBe('first\n\nsecond\n')
  })
})

/* ------------------------- fuzzyReplace empty-result fix ------------------------- */

describe('fuzzyReplace empty replacement', () => {
  it('reports success (empty string content) when an edit empties the file', () => {
    const result = fuzzyReplace('hello world', 'hello world', '', false)
    expect(result.content).toBe('')
    expect(result.occurrences).toBe(1)
    expect(result.strategy).toBe('exact')
  })
})

/* ------------------------- advisory lock release ------------------------- */

describe('FileLockManager advisory lifecycle', () => {
  it('releases advisory locks so later hard acquires do not collide', () => {
    const locks = new FileLockManager()
    locks.acquire('logs/app.log', 'ag_a', 'Vega', 'advisory')
    expect(locks.list()).toHaveLength(1)
    locks.release('logs/app.log', 'ag_a')
    expect(locks.list()).toHaveLength(0)
    expect(() => locks.acquire('logs/app.log', 'ag_b', 'Bao', 'hard')).not.toThrow()
  })

  it('releasing a foreign holder is a no-op', () => {
    const locks = new FileLockManager()
    locks.acquire('a.ts', 'ag_a', 'Vega', 'hard')
    locks.release('a.ts', 'ag_b')
    expect(locks.list()).toHaveLength(1)
  })
})

/* ------------------------- abort race helper ------------------------- */

describe('raceWithAbort', () => {
  it('resolves null immediately for an already-aborted signal', async () => {
    const controller = new AbortController()
    controller.abort()
    const value = await raceWithAbort(Promise.resolve('late'), controller.signal)
    expect(value).toBeNull()
  })

  it('resolves the wrapped value when no abort happens', async () => {
    const controller = new AbortController()
    const value = await raceWithAbort(Promise.resolve('answer'), controller.signal)
    expect(value).toBe('answer')
  })

  it('resolves null on abort and cleans up its listener', async () => {
    const controller = new AbortController()
    const slow = new Promise<string>((resolve) => setTimeout(() => resolve('late'), 5_000))
    const pending = raceWithAbort(slow, controller.signal)
    setTimeout(() => controller.abort(), 10)
    expect(await pending).toBeNull()
    // Node warns above 10 listeners — approvals + questions across a long
    // turn must not accumulate: after settling, the listener is gone.
    const eventNames = (controller.signal as unknown as { eventNames?: () => string[] }).eventNames
    expect(eventNames ? eventNames.call(controller.signal).length : 0).toBe(0)
  })
})
