/**
 * Background job registry. Producers (the shell tool) register jobs; the model inspects them with
 * job_list / job_output / job_kill. Output is kept in a bounded ring per
 * job; a completion notice is queued so the harness can inject it into the
 * agent's next turn (no busy-polling).
 */
import { raceWithAbort } from './util/abort-race'

export type JobStatus = 'running' | 'completed' | 'killed' | 'failed'

export interface JobInfo {
  id: string
  kind: string
  label: string
  ownerAgentId: string
  /** Session the job was started from — completion notices ride back there. */
  sessionId?: string
  status: JobStatus
  exitCode: number | null
  startedAt: number
  finishedAt?: number
  outputBytes: number
  truncated: boolean
}

export interface JobOutput {
  text: string
  job: JobInfo
  stillRunning: boolean
  lossy: boolean
}

interface JobEntry {
  info: JobInfo
  chunks: string[]
  bytes: number
  truncated: boolean
  kill: (reason: string) => void
  settle: (status: JobStatus, exitCode: number | null) => void
  wait: Promise<void>
  /** Consumed completion notices are delivered once. */
  noticePending: boolean
}

const RETAIN_LIVE_BYTES = 256 * 1024
const RETAIN_SETTLED_BYTES = 16 * 1024
const MAX_RUNNING_PER_OWNER = 10

export class JobRegistry {
  private jobs = new Map<string, JobEntry>()
  private seq = 0
  private listeners: Array<(jobId: string) => void> = []

  /** Register for settle notifications (used to inject completion notices). */
  onSettled(listener: (jobId: string) => void): void {
    this.listeners.push(listener)
  }

  list(ownerAgentId?: string): JobInfo[] {
    return [...this.jobs.values()]
      .filter((j) => !ownerAgentId || j.info.ownerAgentId === ownerAgentId)
      .map((j) => ({ ...j.info }))
  }

  get(jobId: string): JobInfo | undefined {
    const job = this.jobs.get(jobId)
    return job ? { ...job.info } : undefined
  }

  /**
   * Start a job. `run` receives control handles and must call `settle`
   * exactly once. Throws when the owner already runs too many jobs.
   */
  start(input: {
    kind: string
    label: string
    ownerAgentId: string
    sessionId?: string
    run: (controls: { setOutput: (chunk: string) => void; settle: (status: JobStatus, exitCode: number | null) => void }) => Promise<void>
    kill: (reason: string) => void
  }): { id: string; wait: Promise<void> } {
    const runningForOwner = [...this.jobs.values()].filter((j) => j.info.ownerAgentId === input.ownerAgentId && j.info.status === 'running').length
    if (runningForOwner >= MAX_RUNNING_PER_OWNER) {
      throw new Error(`Too many background jobs (${MAX_RUNNING_PER_OWNER} max). Collect or kill some with job_output / job_kill first.`)
    }
    this.seq++
    const id = `${input.kind}-${this.seq}`
    const info: JobInfo = {
      id,
      kind: input.kind,
      label: input.label,
      ownerAgentId: input.ownerAgentId,
      sessionId: input.sessionId,
      status: 'running',
      exitCode: null,
      startedAt: Date.now(),
      outputBytes: 0,
      truncated: false,
    }
    let settleFn!: (status: JobStatus, exitCode: number | null) => void
    const wait = new Promise<void>((resolve) => {
      settleFn = (status, exitCode) => {
        if (entry.info.status !== 'running') return
        entry.info.status = status
        entry.info.exitCode = exitCode
        entry.info.finishedAt = Date.now()
        entry.noticePending = true
        this.trimTo(entry, RETAIN_SETTLED_BYTES)
        resolve()
        for (const listener of this.listeners) {
          try {
            listener(id)
          } catch {
            /* listener errors never break the registry */
          }
        }
      }
    })
    const entry: JobEntry = {
      info,
      chunks: [],
      bytes: 0,
      truncated: false,
      kill: (reason: string) => {
        input.kill(reason)
      },
      settle: settleFn,
      wait,
      noticePending: false,
    }
    this.jobs.set(id, entry)

    void input
      .run({
        setOutput: (chunk: string) => {
          if (entry.info.status !== 'running') return
          entry.chunks.push(chunk)
          entry.bytes += Buffer.byteLength(chunk, 'utf8')
          entry.info.outputBytes = entry.bytes
          if (entry.bytes > RETAIN_LIVE_BYTES) this.trimTo(entry, RETAIN_LIVE_BYTES)
        },
        settle: settleFn,
      })
      .catch((err) => {
        try {
          entry.chunks.push(`\n[job error: ${err instanceof Error ? err.message : String(err)}]\n`)
        } catch {
          /* ignore */
        }
        settleFn('failed', null)
      })

    return { id, wait }
  }

  private trimTo(entry: JobEntry, retainBytes: number): void {
    if (entry.bytes <= retainBytes) return
    let drop = entry.bytes - retainBytes
    while (entry.chunks.length && drop > 0) {
      const first = entry.chunks[0]!
      const size = Buffer.byteLength(first, 'utf8')
      if (size <= drop) {
        entry.chunks.shift()
        drop -= size
        entry.bytes -= size
      } else {
        const buf = Buffer.from(first, 'utf8')
        entry.chunks[0] = buf.subarray(drop).toString('utf8')
        entry.bytes -= drop
        drop = 0
      }
    }
    entry.truncated = true
    entry.info.truncated = true
  }

  /** Read accumulated output; optionally wait (bounded) for the job to settle. */
  async read(jobId: string, ownerAgentId: string, wait?: boolean, timeoutMs?: number, signal?: AbortSignal): Promise<JobOutput | { error: string }> {
    const job = this.jobs.get(jobId)
    if (!job) return { error: `Unknown job: ${jobId}. Use job_list to see current jobs.` }
    if (job.info.ownerAgentId !== ownerAgentId) return { error: `Job ${jobId} belongs to another agent.` }

    if (wait && job.info.status === 'running') {
      // NaN from a malformed "timeout_ms": "five minutes" would make the
      // wait fire instantly — clamp a finite fallback instead.
      const requested = Number(timeoutMs ?? 30_000)
      const budget = Math.min(Math.max(Number.isFinite(requested) ? requested : 30_000, 1000), 600_000)
      // The timer must die with the wait: when job.wait settles early the
      // bare setTimeout keeps running for the whole budget (up to 10 min) —
      // dozens of dangling timers per chatty turn.
      let timer: NodeJS.Timeout | undefined
      const budgetPromise = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, budget)
        if (typeof timer.unref === 'function') timer.unref()
      })
      try {
        // A Stop press must settle the wait immediately, not park the turn for
        // the full budget while every other agent has already finished.
        await raceWithAbort(Promise.race([job.wait, budgetPromise]), signal)
      } finally {
        if (timer) clearTimeout(timer)
      }
    }

    const text = job.chunks.join('')
    return {
      text: text || (job.info.status === 'running' ? '(no output yet)' : '(no output)'),
      job: { ...job.info },
      stillRunning: job.info.status === 'running',
      lossy: job.truncated,
    }
  }

  /** Kill a running job; returns a status line for the model. */
  kill(jobId: string, ownerAgentId: string, reason?: string): { ok: boolean; message: string } {
    const job = this.jobs.get(jobId)
    if (!job) return { ok: false, message: `Unknown job: ${jobId}.` }
    if (job.info.ownerAgentId !== ownerAgentId) return { ok: false, message: `Job ${jobId} belongs to another agent.` }
    if (job.info.status !== 'running') return { ok: false, message: `Job ${jobId} already ${job.info.status}.` }
    // Do NOT pre-set the status here: settle() only accepts transitions from
    // 'running', so a placeholder state (e.g. 'stopping') would make the
    // real settle call a no-op and the job would never reach a terminal
    // status — its completion notice would be lost. The kill handler in the
    // producing tool settles the job as 'killed' when the process exits.
    try {
      job.kill(reason ?? 'killed by agent')
    } catch (err) {
      return { ok: false, message: `Kill failed: ${err instanceof Error ? err.message : String(err)}` }
    }
    return { ok: true, message: `Cancellation requested for ${jobId}. Read its final output with job_output.` }
  }

  /** Consume a pending completion notice (delivered at most once). */
  takeNotice(jobId: string): string | null {
    const job = this.jobs.get(jobId)
    if (!job || !job.noticePending) return null
    job.noticePending = false
    const exit = job.info.exitCode !== null ? `exit code: ${job.info.exitCode}` : job.info.status
    return `Background job ${job.info.id} (${job.info.label}) finished [${exit}]. Read its full output with job_output.`
  }

  /** Drop settled jobs older than the retention window. */
  sweep(maxAgeMs = 60 * 60 * 1000): void {
    const cutoff = Date.now() - maxAgeMs
    for (const [id, job] of this.jobs) {
      if (job.info.status !== 'running' && (job.info.finishedAt ?? 0) < cutoff) this.jobs.delete(id)
    }
  }
}
