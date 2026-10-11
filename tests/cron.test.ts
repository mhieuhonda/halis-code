import { describe, expect, it } from 'vitest'
import { cronNext, describeCron, parseCron } from '../src/main/harness/util/cron'

describe('parseCron', () => {
  it('parses a simple daily expression', () => {
    const parsed = parseCron('30 9 * * *')
    if ('error' in parsed) throw new Error(parsed.error)
    expect(parsed.fields.minute[30]).toBe(true)
    expect(parsed.fields.hour[9]).toBe(true)
    expect(parsed.fields.domRestricted).toBe(false)
    expect(parsed.fields.dowRestricted).toBe(false)
  })

  it('folds DOW 7 into 0', () => {
    const parsed = parseCron('0 0 * * 7')
    if ('error' in parsed) throw new Error(parsed.error)
    expect(parsed.fields.dow[0]).toBe(true)
  })

  it('supports ranges, steps and lists', () => {
    const parsed = parseCron('0,15,30 8-18/2 * * *')
    if ('error' in parsed) throw new Error(parsed.error)
    expect(parsed.fields.minute.filter(Boolean)).toHaveLength(3)
    expect(parsed.fields.hour[8]).toBe(true)
    expect(parsed.fields.hour[9]).toBe(false)
    expect(parsed.fields.hour[10]).toBe(true)
  })

  it('rejects malformed fields', () => {
    expect('error' in parseCron('61 9 * * *')).toBe(true)
    expect('error' in parseCron('30 9 * *')).toBe(true)
  })
})

describe('cronNext', () => {
  it('finds the next minute occurrence', () => {
    const after = new Date('2026-06-15T09:00:00')
    const result = cronNext('7 9 * * *', after)
    if ('error' in result) throw new Error(result.error)
    expect(result.at.getMinutes()).toBe(7)
    expect(result.at.getHours()).toBe(9)
    expect(result.at.getDate()).toBe(15)
  })

  it('rolls to the next day when today\u2019s time passed', () => {
    const after = new Date('2026-06-15T10:00:00')
    const result = cronNext('30 9 * * *', after)
    if ('error' in result) throw new Error(result.error)
    expect(result.at.getDate()).toBe(16)
  })

  it('respects the DOM/DOW OR rule', () => {
    // After Monday 2026-06-15 12:00 local: cron fires on day-of-month 16
    // (Tuesday) OR Fridays. The Tuesday match comes first.
    const after = new Date('2026-06-15T12:00:00')
    const result = cronNext('0 12 16 * 5', after)
    if ('error' in result) throw new Error(result.error)
    expect(result.at.getDate()).toBe(16)
    // A Friday-only cron picks the coming Friday (the 19th).
    const fridayOnly = cronNext('0 12 * * 5', after)
    if ('error' in fridayOnly) throw new Error(fridayOnly.error)
    expect(fridayOnly.at.getDate()).toBe(19)
  })

  it('rejects absurd expressions', () => {
    const result = cronNext('99 99 * * *', new Date())
    expect('error' in result).toBe(true)
  })
})

describe('describeCron', () => {
  it('renders a readable summary', () => {
    expect(describeCron('30 9 * * *')).toContain('09:30')
    expect(describeCron('not valid')).toBe('not valid')
  })
})
