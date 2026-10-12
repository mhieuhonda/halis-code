/**
 * Vixie-style 5-field cron parser — modeled on deepseek-harness's
 * schedule domain. Supports star, values, ranges (a-b), steps (star over n
 * and a-b over n), lists, DOW 0-7 (7 folds to 0) and the standard DOM/DOW
 * OR rule when both are restricted. next(date) scans forward for the
 * next match.
 */

export interface CronFields {
  minute: boolean[]
  hour: boolean[]
  dom: boolean[]
  month: boolean[]
  dow: boolean[]
  domRestricted: boolean
  dowRestricted: boolean
}

export function parseCron(expression: string): { fields: CronFields } | { error: string } {
  const parts = expression.trim().split(/\s+/)
  if (parts.length !== 5) return { error: `Cron expression must have 5 fields (minute hour day-of-month month day-of-week), got ${parts.length}.` }
  const minute = parseField(parts[0]!, 0, 59)
  const hour = parseField(parts[1]!, 0, 23)
  const dom = parseField(parts[2]!, 1, 31)
  const month = parseField(parts[3]!, 1, 12)
  const dowRaw = parseField(parts[4]!, 0, 7)
  if ('error' in minute) return minute
  if ('error' in hour) return hour
  if ('error' in dom) return dom
  if ('error' in month) return month
  if ('error' in dowRaw) return dowRaw
  // fold 7 → 0 (Sunday)
  const dow = [...dowRaw.set]
  if (dow[7]) dow[0] = true
  const dowSet = new Array<boolean>(7).fill(false)
  for (let d = 0; d < 7; d++) if (dow[d]) dowSet[d] = true
  return {
    fields: {
      minute: minute.set,
      hour: hour.set,
      dom: dom.set,
      month: month.set,
      dow: dowSet,
      domRestricted: parts[2] !== '*',
      dowRestricted: parts[4] !== '*',
    },
  }
}

function parseField(field: string, min: number, max: number): { set: boolean[] } | { error: string } {
  const set = new Array<boolean>(max - min + 1).fill(false)
  for (const part of field.split(',')) {
    const m = part.match(/^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/)
    if (!m) return { error: `Invalid cron field part: "${part}".` }
    const step = m[2] ? Math.max(1, Number(m[2])) : 1
    let from = min
    let to = max
    if (m[1] !== '*') {
      const range = m[1]!.match(/^(\d+)-(\d+)$/)
      if (range) {
        from = Number(range[1]!)
        to = Number(range[2]!)
      } else {
        from = to = Number(m[1])
      }
    }
    if (from < min || to > max || from > to) return { error: `Cron field value out of range (${min}-${max}): "${part}".` }
    for (let v = from; v <= to; v += step) set[v - min] = true
  }
  return { set }
}

/** Next occurrence strictly after `after` (or an error for absurd horizons). */
export function cronNext(expression: string, after: Date): { at: Date } | { error: string } {
  const parsed = parseCron(expression)
  if ('error' in parsed) return parsed
  const fields = parsed.fields
  const d = new Date(after.getTime())
  d.setSeconds(0, 0)
  d.setMinutes(d.getMinutes() + 1)
  // Search horizon: 2 years is plenty for any sane schedule; deepseek uses 400.
  const horizon = after.getTime() + 2 * 366 * 24 * 3600 * 1000
  while (d.getTime() < horizon) {
    // parseField stores month v at index v-1 (min=1); getMonth() is 0-based,
    // so the lookup index IS getMonth(). The old +1 made every explicit
    // month fire one month early and December unreachable.
    if (!fields.month[d.getMonth()]) {
      // jump to the first day of next month at 00:00
      d.setMonth(d.getMonth() + 1, 1)
      d.setHours(0, 0, 0, 0)
      continue
    }
    const domOk = fields.dom[d.getDate() - 1] ?? false
    const dowOk = fields.dow[d.getDay()] ?? false
    const dayOk = fields.domRestricted && fields.dowRestricted ? domOk || dowOk : fields.domRestricted ? domOk : fields.dowRestricted ? dowOk : true
    if (!dayOk) {
      d.setDate(d.getDate() + 1)
      d.setHours(0, 0, 0, 0)
      continue
    }
    if (!fields.hour[d.getHours()]) {
      d.setHours(d.getHours() + 1, 0, 0, 0)
      continue
    }
    if (!fields.minute[d.getMinutes()]) {
      d.setMinutes(d.getMinutes() + 1, 0, 0)
      continue
    }
    return { at: new Date(d.getTime()) }
  }
  return { error: 'No cron occurrence found within 2 years.' }
}

/** Human-readable summary of a cron expression (for UI). */
export function describeCron(expression: string): string {
  const parsed = parseCron(expression)
  if ('error' in parsed) return expression
  const f = parsed.fields
  const times: string[] = []
  for (let h = 0; h < 24; h++) {
    if (!f.hour[h]) continue
    for (let m = 0; m < 60; m++) {
      if (f.minute[m]) times.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
    }
  }
  if (times.length > 8) return `cron (${expression})`
  const dayPart = f.domRestricted && f.dowRestricted ? 'day-of-month or weekday' : f.domRestricted ? 'day of month' : f.dowRestricted ? 'weekday' : 'every day'
  return `${times.join(', ')} on ${dayPart}`
}
