/**
 * Reminders / scheduled prompts — mobile edition of the desktop store.
 * Persisted in IndexedDB; a 15s interval loop fires due reminders exactly
 * once. Selectors and cron support are identical to the desktop app.
 */
import { readJson, writeJson } from './storage'
import { newId } from './util/id'
import { cronNext, describeCron } from './harness/util/cron'

export type ScheduleSelector =
  | { kind: 'after_seconds'; seconds: number }
  | { kind: 'at'; iso: string }
  | { kind: 'every_seconds'; seconds: number }
  | { kind: 'daily'; time: string }
  | { kind: 'weekly'; time: string; weekdays: number[] }
  | { kind: 'cron'; expression: string }

export interface Schedule {
  id: string
  sessionId: string
  title: string
  prompt: string
  selector: ScheduleSelector
  createdBy: string
  createdAt: number
  nextFireAt: number
  lastFiredAt?: number
  fireCount: number
}

const STORE_KEY = 'schedules'
const MIN_EVERY_SECONDS = 60

function parseLocalTime(time: string): { h: number; m: number } | { error: string } {
  const m = time.match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return { error: `Invalid time "${time}" — use HH:MM (24h local).` }
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return { error: `Invalid time "${time}" — hours 0-23, minutes 0-59.` }
  return { h, m: min }
}

export function nextFireFor(selector: ScheduleSelector, from: Date): { at: number } | { error: string } {
  switch (selector.kind) {
    case 'after_seconds':
      return { at: from.getTime() + Math.max(1, selector.seconds) * 1000 }
    case 'at': {
      const t = Date.parse(selector.iso)
      if (Number.isNaN(t)) return { error: `Invalid ISO time: ${selector.iso}` }
      return { at: t }
    }
    case 'every_seconds':
      return { at: from.getTime() + Math.max(MIN_EVERY_SECONDS, selector.seconds) * 1000 }
    case 'daily': {
      const hm = parseLocalTime(selector.time)
      if ('error' in hm) return hm
      const at = new Date(from)
      at.setHours(hm.h, hm.m, 0, 0)
      if (at.getTime() <= from.getTime()) at.setDate(at.getDate() + 1)
      return { at: at.getTime() }
    }
    case 'weekly': {
      const hm = parseLocalTime(selector.time)
      if ('error' in hm) return hm
      if (!selector.weekdays?.length) return { error: 'weekly needs at least one weekday (1=Mon..7=Sun).' }
      for (let dayOffset = 0; dayOffset < 8; dayOffset++) {
        const at = new Date(from)
        at.setDate(at.getDate() + dayOffset)
        at.setHours(hm.h, hm.m, 0, 0)
        const isoDay = at.getDay() === 0 ? 7 : at.getDay()
        if (selector.weekdays.includes(isoDay) && at.getTime() > from.getTime()) return { at: at.getTime() }
      }
      return { error: 'No matching weekday found.' }
    }
    case 'cron': {
      const result = cronNext(selector.expression, from)
      return 'error' in result ? result : { at: result.at.getTime() }
    }
  }
}

export function describeSelector(selector: ScheduleSelector): string {
  switch (selector.kind) {
    case 'after_seconds':
      return `once, in ${selector.seconds}s`
    case 'at':
      return `once, at ${selector.iso}`
    case 'every_seconds':
      return `every ${Math.max(MIN_EVERY_SECONDS, selector.seconds)}s`
    case 'daily':
      return `daily at ${selector.time}`
    case 'weekly':
      return `weekly at ${selector.time} on days ${selector.weekdays.join(',')}`
    case 'cron':
      return `cron: ${describeCron(selector.expression)}`
  }
}

/** Validate + normalize raw tool args into a selector (exactly one allowed). */
export function buildSelector(args: Record<string, unknown>): { selector: ScheduleSelector } | { error: string } {
  const provided: string[] = []
  for (const key of ['after_seconds', 'at', 'every_seconds', 'daily', 'weekly', 'cron']) {
    if (args[key] !== undefined && args[key] !== null) provided.push(key)
  }
  if (provided.length === 0) {
    return { error: 'Exactly one schedule selector is required: after_seconds | at | every_seconds | daily | weekly | cron.' }
  }
  if (provided.length > 1) {
    return { error: `Only one schedule selector may be used — got: ${provided.join(', ')}.` }
  }
  const key = provided[0]!
  if (key === 'after_seconds') {
    const seconds = Number(args[key])
    if (!Number.isFinite(seconds) || seconds <= 0) return { error: 'after_seconds must be a positive number of seconds.' }
    return { selector: { kind: 'after_seconds', seconds } }
  }
  if (key === 'at') {
    const iso = String(args[key])
    if (Number.isNaN(Date.parse(iso))) return { error: `Invalid ISO datetime: ${iso}` }
    return { selector: { kind: 'at', iso } }
  }
  if (key === 'every_seconds') {
    const seconds = Number(args[key])
    if (!Number.isFinite(seconds) || seconds < MIN_EVERY_SECONDS) return { error: `every_seconds must be ≥ ${MIN_EVERY_SECONDS}.` }
    return { selector: { kind: 'every_seconds', seconds } }
  }
  if (key === 'daily') {
    const time = String(typeof args[key] === 'string' ? args[key] : (args[key] as { time?: string })?.time ?? '')
    const check = parseLocalTime(time)
    if ('error' in check) return check
    return { selector: { kind: 'daily', time } }
  }
  if (key === 'weekly') {
    const raw = args[key] as { time?: string; weekdays?: number[] }
    const time = String(raw?.time ?? '')
    const check = parseLocalTime(time)
    if ('error' in check) return check
    const weekdays = (raw?.weekdays ?? []).map(Number)
    if (!weekdays.length || weekdays.some((d) => d < 1 || d > 7)) return { error: 'weekdays must be numbers 1=Mon..7=Sun.' }
    return { selector: { kind: 'weekly', time, weekdays } }
  }
  const rawCron = args[key]
  const expression = String(typeof rawCron === 'string' ? rawCron : (rawCron as { expression?: string })?.expression ?? '')
  return { selector: { kind: 'cron', expression } }
}

export interface ScheduleHooks {
  onFire: (schedule: Schedule) => void
  onChanged: (schedules: Schedule[]) => void
}

export class ScheduleStore {
  private schedules: Schedule[] = []
  private timer: ReturnType<typeof setInterval> | null = null
  private hooks: ScheduleHooks | null = null
  private firing = false

  async init(): Promise<void> {
    const parsed = await readJson<unknown>(STORE_KEY, [])
    this.schedules = Array.isArray(parsed) ? (parsed as Schedule[]) : []
    this.ensureTimer()
  }

  setHooks(hooks: ScheduleHooks): void {
    this.hooks = hooks
  }

  private async persist(): Promise<void> {
    await writeJson(STORE_KEY, this.schedules)
    this.hooks?.onChanged(this.all())
  }

  all(): Schedule[] {
    return [...this.schedules].sort((a, b) => a.nextFireAt - b.nextFireAt)
  }

  forSession(sessionId: string): Schedule[] {
    return this.all().filter((s) => s.sessionId === sessionId)
  }

  async create(input: { sessionId: string; title: string; prompt: string; selector: ScheduleSelector; createdBy: string }): Promise<{ schedule: Schedule } | { error: string }> {
    const title = input.title.trim().slice(0, 120)
    if (!title) return { error: 'A schedule needs a short title.' }
    if (!input.prompt.trim()) return { error: 'A schedule needs a prompt to deliver.' }
    const first = nextFireFor(input.selector, new Date())
    if ('error' in first) return first
    const schedule: Schedule = {
      id: newId('sch'),
      sessionId: input.sessionId,
      title,
      prompt: input.prompt.trim(),
      selector: input.selector,
      createdBy: input.createdBy,
      createdAt: Date.now(),
      nextFireAt: first.at,
      fireCount: 0,
    }
    this.schedules.push(schedule)
    await this.persist()
    this.ensureTimer()
    return { schedule }
  }

  async remove(id: string, sessionId?: string): Promise<{ ok: boolean; message: string }> {
    const idx = this.schedules.findIndex((s) => s.id === id && (!sessionId || s.sessionId === sessionId))
    if (idx < 0) return { ok: false, message: 'Schedule not found.' }
    const removed = this.schedules[idx]!
    this.schedules.splice(idx, 1)
    await this.persist()
    return { ok: true, message: `Removed reminder "${removed.title}".` }
  }

  /** Timer loop — checks every 15 s; fires due reminders exactly once. */
  ensureTimer(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.tick(), 15_000)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private async tick(): Promise<void> {
    if (this.firing) return
    this.firing = true
    try {
      const now = Date.now()
      for (const schedule of this.all()) {
        if (schedule.nextFireAt > now) continue
        schedule.lastFiredAt = now
        schedule.fireCount++
        const next = nextFireFor(schedule.selector, new Date(now + 1000))
        if ('error' in next) {
          this.schedules = this.schedules.filter((s) => s.id !== schedule.id)
        } else if (schedule.selector.kind === 'after_seconds' || schedule.selector.kind === 'at') {
          this.schedules = this.schedules.filter((s) => s.id !== schedule.id)
        } else {
          schedule.nextFireAt = next.at
        }
        await this.persist()
        try {
          this.hooks?.onFire(schedule)
        } catch (err) {
          console.warn('[halis] schedule fire failed:', err)
        }
      }
    } finally {
      this.firing = false
    }
  }
}
