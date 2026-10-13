import { describe, expect, it } from 'vitest'
import { JobRegistry } from '../src/main/harness/jobs'
import { buildSelector, nextFireFor } from '../src/main/harness/schedules'
import { compactionCeiling, estimateTokens, looksLikeSummary, planCompaction } from '../src/main/harness/compaction'
import type { ChatMessage, ModelInfo } from '@shared/types'

describe('JobRegistry', () => {
  it('runs a job, streams output, settles', async () => {
    const registry = new JobRegistry()
    const started = registry.start({
      kind: 'bash',
      label: 'test job',
      ownerAgentId: 'agent-1',
      run: async (controls) => {
        controls.setOutput('chunk-1\n')
        controls.setOutput('chunk-2\n')
        controls.settle('completed', 0)
      },
      kill: () => {},
    })
    await started.wait
    const result = await registry.read(started.id, 'agent-1')
    if ('error' in result) throw new Error(result.error)
    expect(result.text).toContain('chunk-1')
    expect(result.stillRunning).toBe(false)
    expect(result.job.exitCode).toBe(0)
    expect(registry.takeNotice(started.id)).toContain('finished [exit code: 0]')
    expect(registry.takeNotice(started.id)).toBeNull()
  })

  it('enforces per-owner limits', () => {
    const registry = new JobRegistry()
    expect(() => {
      for (let i = 0; i < 11; i++) {
        registry.start({
          kind: 'bash',
          label: `job ${i}`,
          ownerAgentId: 'spam',
          run: async () => {},
          kill: () => {},
        })
      }
    }).toThrow(/Too many background jobs/)
  })

  it('keeps ownership boundaries', async () => {
    const registry = new JobRegistry()
    const started = registry.start({
      kind: 'bash',
      label: 'mine',
      ownerAgentId: 'a',
      run: async (controls) => {
        controls.setOutput('out')
        controls.settle('completed', 0)
      },
      kill: () => {},
    })
    const other = await registry.read(started.id, 'b')
    expect('error' in other && other.error).toContain('another agent')
  })

  it('trims oversized output to the live window', async () => {
    const registry = new JobRegistry()
    const started = registry.start({
      kind: 'bash',
      label: 'chatty',
      ownerAgentId: 'a',
      run: async (controls) => {
        for (let i = 0; i < 5000; i++) controls.setOutput(`line ${i} ${'y'.repeat(120)}\n`)
        controls.settle('completed', 0)
      },
      kill: () => {},
    })
    await started.wait
    const result = await registry.read(started.id, 'a')
    if ('error' in result) throw new Error(result.error)
    expect(result.lossy).toBe(true)
    expect(result.text.length).toBeLessThan(600 * 1024)
  })
})

describe('schedule selectors', () => {
  it('requires exactly one selector', () => {
    expect(buildSelector({})).toEqual({ error: expect.stringContaining('Exactly one') })
    const both = buildSelector({ after_seconds: 5, every_seconds: 60 })
    expect('error' in both && both.error).toContain('Only one')
    const ok = buildSelector({ after_seconds: 30 })
    if ('error' in ok) throw new Error(ok.error)
    expect(ok.selector).toEqual({ kind: 'after_seconds', seconds: 30 })
  })

  it('enforces the 60s floor for every_seconds', () => {
    const tooFast = buildSelector({ every_seconds: 10 })
    expect('error' in tooFast && tooFast.error).toContain('60')
    const ok = buildSelector({ every_seconds: 60 })
    if ('error' in ok) throw new Error(ok.error)
    const next = nextFireFor(ok.selector, new Date('2026-01-01T00:00:00'))
    if ('error' in next) throw new Error(next.error)
    expect(next.at - Date.parse('2026-01-01T00:00:00')).toBeGreaterThanOrEqual(60_000)
  })

  it('validates daily/weekly times', () => {
    const badTime = buildSelector({ daily: { time: '25:00' } })
    expect('error' in badTime && badTime.error).toContain('Invalid time')
    const weekly = buildSelector({ weekly: { time: '09:00', weekdays: [1, 5] } })
    if ('error' in weekly) throw new Error(weekly.error)
    expect(weekly.selector.kind).toBe('weekly')
  })
})

describe('compaction planning', () => {
  const model: ModelInfo = {
    id: 'test/model',
    apiId: 'model',
    name: 'Test Model',
    providerId: 'test',
    free: true,
    toolCall: true,
    contextWindow: 8000,
  }

  it('skips small sessions', () => {
    const messages: ChatMessage[] = [{ id: 'm1', sessionId: 's', mode: 'agent', from: 'user', fromName: 'u', to: [], mentions: [], role: 'user', content: 'tiny', createdAt: 0 }]
    const plan = planCompaction(messages, model)
    expect(plan.needed).toBe(false)
  })

  it('splits into older + recent at a user boundary', () => {
    const big = 'x'.repeat(6000) // ~1500 tokens each
    const messages: ChatMessage[] = []
    for (let i = 0; i < 12; i++) {
      messages.push({ id: `u${i}`, sessionId: 's', mode: 'agent', from: 'user', fromName: 'u', to: [], mentions: [], role: 'user', content: `turn ${i} ${big}`, createdAt: i })
      messages.push({ id: `a${i}`, sessionId: 's', mode: 'agent', from: 'halis', fromName: 'h', to: [], mentions: [], role: 'assistant', content: `reply ${i} ${big}`, createdAt: i })
    }
    const plan = planCompaction(messages, model)
    expect(plan.needed).toBe(true)
    expect(plan.older.length).toBeGreaterThan(0)
    expect(plan.recent[0]?.role).toBe('user')
    expect(plan.older.length + plan.recent.length).toBe(messages.length)
  })

  it('computes the compaction ceiling', () => {
    expect(compactionCeiling(128_000)).toBe(112_000)
    expect(compactionCeiling(20_000)).toBe(18_000)
    expect(estimateTokens([{ content: 'a'.repeat(400) }])).toBe(100)
  })

  it('validates summary shape', () => {
    expect(looksLikeSummary('## Objective\nx\n## Work State\ny')).toBe(true)
    expect(looksLikeSummary('just text')).toBe(false)
  })
})
